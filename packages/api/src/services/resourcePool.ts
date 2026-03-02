/**
 * Resource Pool Service - Manages parallel task execution resources
 *
 * Enables Ollama tasks and Claude tasks to execute simultaneously since they
 * use different resources (local GPU vs cloud API). This improves throughput
 * by ~40-60% for mixed-complexity batches.
 *
 * Resource Types:
 * - ollama: Single local Ollama instance (1 slot)
 * - remote_ollama: Remote Ollama on powerful server (optional, configurable slots)
 * - claude: Cloud API with rate limiting (2 slots - rate limiter handles throttling)
 */

import type { Server as SocketIOServer } from 'socket.io';

export type ResourceType = 'ollama' | 'remote_ollama' | 'claude' | 'grok';

// Remote Ollama configuration from environment
const REMOTE_OLLAMA_URL = process.env.REMOTE_OLLAMA_URL || '';
const REMOTE_OLLAMA_MIN_COMPLEXITY = parseInt(process.env.REMOTE_OLLAMA_MIN_COMPLEXITY || '7', 10);
const REMOTE_OLLAMA_MAX_COMPLEXITY = parseInt(process.env.REMOTE_OLLAMA_MAX_COMPLEXITY || '9', 10);
const REMOTE_OLLAMA_SLOTS = parseInt(process.env.REMOTE_OLLAMA_SLOTS || '1', 10);

export function isRemoteOllamaEnabled(): boolean {
  return REMOTE_OLLAMA_URL.length > 0;
}

// ---------------------------------------------------------------------------
// Remote Ollama Model Map — maps complexity ranges to specific models
// Format: "7-8:qwen2.5-coder:32k,9:qwen2.5-coder:70b"
// ---------------------------------------------------------------------------

interface ModelMapEntry {
  min: number;
  max: number;
  model: string;
}

function parseModelMap(mapStr: string): ModelMapEntry[] {
  if (!mapStr) return [];

  return mapStr.split(',').map((entry) => {
    const [range, ...modelParts] = entry.trim().split(':');
    // Model name may contain colons (e.g., "qwen2.5-coder:32k"), so rejoin
    const model = modelParts.join(':');
    if (!model) return null;

    const rangeParts = range.split('-');
    const min = parseInt(rangeParts[0], 10);
    const max = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : min;

    if (isNaN(min) || isNaN(max)) return null;
    return { min, max, model };
  }).filter((e): e is ModelMapEntry => e !== null);
}

const REMOTE_MODEL_MAP = parseModelMap(process.env.REMOTE_OLLAMA_MODEL_MAP || '');

/**
 * Resolve the remote Ollama model for a given complexity.
 * Uses REMOTE_OLLAMA_MODEL_MAP if set, otherwise falls back to REMOTE_OLLAMA_MODEL.
 */
export function getRemoteModelForComplexity(complexity: number): string {
  for (const entry of REMOTE_MODEL_MAP) {
    if (complexity >= entry.min && complexity <= entry.max) {
      return entry.model;
    }
  }
  // Fallback to single model env var
  return process.env.REMOTE_OLLAMA_MODEL || 'qwen2.5-coder:70b';
}

export interface ResourceStatus {
  type: ResourceType;
  maxSlots: number;
  activeSlots: number;
  activeTasks: string[];
}

export class ResourcePoolService {
  private static instance: ResourcePoolService;
  private io: SocketIOServer | null = null;

  // Active tasks per resource type
  private activeTasks: Map<ResourceType, Set<string>> = new Map([
    ['ollama', new Set()],
    ['claude', new Set()],
  ]);

  // Configurable limits per resource type
  private limits: Record<string, number> = {
    ollama: 1, // Single Ollama instance
    claude: 2, // Can run 2 Claude tasks (rate limiter handles throttling)
  };

  private constructor() {
    // Conditionally init remote_ollama pool if configured
    if (isRemoteOllamaEnabled()) {
      this.activeTasks.set('remote_ollama', new Set());
      this.limits['remote_ollama'] = REMOTE_OLLAMA_SLOTS;
      console.log(`[ResourcePool] Remote Ollama enabled: ${REMOTE_OLLAMA_URL} (${REMOTE_OLLAMA_SLOTS} slots, C${REMOTE_OLLAMA_MIN_COMPLEXITY}-C${REMOTE_OLLAMA_MAX_COMPLEXITY})`);

      // Validate remote models on startup (non-blocking)
      this.validateRemoteModels().catch((err) => {
        console.error('[ResourcePool] Remote model validation failed:', err);
      });
    }

    // Conditionally init grok pool if XAI_API_KEY is set
    if (process.env.XAI_API_KEY) {
      this.activeTasks.set('grok', new Set());
      this.limits['grok'] = 2;
      console.log('[ResourcePool] Grok (xAI) enabled: 2 slots');
    }
  }

  /**
   * Validate that remote Ollama has all models configured in REMOTE_OLLAMA_MODEL_MAP.
   * Logs warnings for missing models. Non-blocking — failures don't prevent startup.
   */
  private async validateRemoteModels(): Promise<void> {
    if (!REMOTE_OLLAMA_URL || REMOTE_MODEL_MAP.length === 0) return;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${REMOTE_OLLAMA_URL}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[ResourcePool] Remote Ollama health check failed: HTTP ${response.status}`);
        return;
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      const availableModels = (data.models || []).map((m) => m.name);

      for (const entry of REMOTE_MODEL_MAP) {
        const found = availableModels.some((m) => m.startsWith(entry.model) || m === entry.model);
        if (found) {
          console.log(`[ResourcePool] Remote model ${entry.model} (C${entry.min}-${entry.max}): ✓ available`);
        } else {
          console.warn(`[ResourcePool] ⚠️  Remote model ${entry.model} (C${entry.min}-${entry.max}): NOT FOUND on ${REMOTE_OLLAMA_URL}`);
          console.warn(`[ResourcePool]    Run: ollama pull ${entry.model}`);
        }
      }
    } catch (err) {
      console.warn(`[ResourcePool] Could not validate remote models: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ResourcePoolService {
    if (!ResourcePoolService.instance) {
      ResourcePoolService.instance = new ResourcePoolService();
    }
    return ResourcePoolService.instance;
  }

  /**
   * Initialize with Socket.IO for event emission
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Check if a resource slot is available
   */
  canAcquire(type: ResourceType): boolean {
    const active = this.activeTasks.get(type);
    if (!active) return false;
    return active.size < this.limits[type];
  }

  /**
   * Acquire a resource slot for a task
   * Returns true if acquired, false if no slots available
   */
  acquire(type: ResourceType, taskId: string): boolean {
    if (!this.canAcquire(type)) {
      return false;
    }

    const active = this.activeTasks.get(type);
    if (!active) return false;

    active.add(taskId);

    // Emit resource acquired event
    this.emitResourceEvent('resource_acquired', {
      type,
      taskId,
      activeSlots: active.size,
      maxSlots: this.limits[type],
    });

    console.log(`[ResourcePool] Acquired ${type} slot for task ${taskId.substring(0, 8)} (${active.size}/${this.limits[type]})`);
    return true;
  }

  /**
   * Release a resource slot when task completes
   */
  release(taskId: string): void {
    // Check both resource types since we may not know which one was used
    for (const [type, tasks] of this.activeTasks.entries()) {
      if (tasks.has(taskId)) {
        tasks.delete(taskId);

        // Emit resource released event
        this.emitResourceEvent('resource_released', {
          type,
          taskId,
          activeSlots: tasks.size,
          maxSlots: this.limits[type],
        });

        console.log(`[ResourcePool] Released ${type} slot for task ${taskId.substring(0, 8)} (${tasks.size}/${this.limits[type]})`);
        return;
      }
    }
  }

  /**
   * Determine which resource type a task needs based on whether it uses Claude
   */
  getResourceForTask(useClaude: boolean): ResourceType {
    return useClaude ? 'claude' : 'ollama';
  }

  /**
   * Get resource type based on complexity (for routing decisions)
   * C1-C6 use local Ollama, C7-C9 use remote Ollama (if enabled), C10 uses Claude
   */
  getResourceForComplexity(complexity: number): ResourceType {
    if (complexity >= 10) return 'claude';
    if (isRemoteOllamaEnabled() && complexity >= REMOTE_OLLAMA_MIN_COMPLEXITY && complexity <= REMOTE_OLLAMA_MAX_COMPLEXITY) {
      return 'remote_ollama';
    }
    return 'ollama';
  }

  /**
   * Check if a task is currently holding a resource
   */
  hasResource(taskId: string): boolean {
    for (const tasks of this.activeTasks.values()) {
      if (tasks.has(taskId)) return true;
    }
    return false;
  }

  /**
   * Get which resource type a task is using
   */
  getTaskResource(taskId: string): ResourceType | null {
    for (const [type, tasks] of this.activeTasks.entries()) {
      if (tasks.has(taskId)) return type;
    }
    return null;
  }

  /**
   * Get current status of all resource pools
   */
  getStatus(): ResourceStatus[] {
    return Array.from(this.activeTasks.entries()).map(([type, tasks]) => ({
      type,
      maxSlots: this.limits[type],
      activeSlots: tasks.size,
      activeTasks: Array.from(tasks),
    }));
  }

  /**
   * Get status for a specific resource type
   */
  getResourceStatus(type: ResourceType): ResourceStatus {
    const tasks = this.activeTasks.get(type) || new Set();
    return {
      type,
      maxSlots: this.limits[type],
      activeSlots: tasks.size,
      activeTasks: Array.from(tasks),
    };
  }

  /**
   * Update resource limits (for testing or configuration)
   */
  setLimit(type: ResourceType, limit: number): void {
    if (limit < 1) {
      throw new Error('Resource limit must be at least 1');
    }
    this.limits[type] = limit;
    console.log(`[ResourcePool] Set ${type} limit to ${limit}`);
  }

  /**
   * Get current limits
   */
  getLimits(): Record<string, number> {
    return { ...this.limits };
  }

  /**
   * Clear all active tasks (for testing or reset)
   */
  clear(): void {
    for (const tasks of this.activeTasks.values()) {
      tasks.clear();
    }
    console.log('[ResourcePool] Cleared all active tasks');
  }

  /**
   * Emit resource event via Socket.IO
   */
  private emitResourceEvent(
    event: 'resource_acquired' | 'resource_released',
    payload: {
      type: ResourceType;
      taskId: string;
      activeSlots: number;
      maxSlots: number;
    }
  ): void {
    if (this.io) {
      this.io.emit(event, {
        type: event,
        payload,
        timestamp: new Date(),
      });
    }
  }
}
