/**
 * Scheduler Service - Runs periodic tasks
 *
 * Currently handles:
 * - Training data export (daily at 2 AM or configurable interval)
 *
 * Uses simple setInterval instead of cron for zero dependencies.
 */

import type { PrismaClient } from '@prisma/client';
import { TrainingDataService } from './trainingDataService.js';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('Scheduler');

export interface SchedulerConfig {
  trainingExportEnabled: boolean;
  trainingExportIntervalHours: number;
  trainingExportPath: string;
  trainingExportRetentionDays: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  trainingExportEnabled: true,
  trainingExportIntervalHours: 24, // Daily
  trainingExportPath: '/app/workspace/training-exports',
  trainingExportRetentionDays: 30,
};

export class SchedulerService {
  private config: SchedulerConfig;
  private trainingDataService: TrainingDataService;
  private exportTimer: NodeJS.Timeout | null = null;
  private lastExportTime: Date | null = null;

  constructor(
    private prisma: PrismaClient,
    config?: Partial<SchedulerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trainingDataService = new TrainingDataService(prisma);

    // Override with environment variables
    if (process.env.TRAINING_EXPORT_ENABLED === 'false') {
      this.config.trainingExportEnabled = false;
    }
    if (process.env.TRAINING_EXPORT_INTERVAL_HOURS) {
      this.config.trainingExportIntervalHours = parseInt(process.env.TRAINING_EXPORT_INTERVAL_HOURS, 10);
    }
    if (process.env.TRAINING_EXPORT_PATH) {
      this.config.trainingExportPath = process.env.TRAINING_EXPORT_PATH;
    }
  }

  /**
   * Start all scheduled tasks
   */
  start(): void {
    log.info('Starting scheduled tasks');

    if (this.config.trainingExportEnabled) {
      this.startTrainingExport();
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop(): void {
    log.info('Stopping scheduled tasks');

    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }
  }

  /**
   * Start training data export scheduler
   */
  private startTrainingExport(): void {
    const intervalMs = this.config.trainingExportIntervalHours * 60 * 60 * 1000;

    log.info('Training export scheduled', { intervalHours: this.config.trainingExportIntervalHours });
    log.info('Export path configured', { exportPath: this.config.trainingExportPath });

    // Run immediately on startup (after a short delay)
    setTimeout(() => {
      this.runTrainingExport().catch(err => {
        log.error('Initial training export failed', { error: String(err) });
      });
    }, 10000); // 10 second delay on startup

    // Then run on interval
    this.exportTimer = setInterval(() => {
      this.runTrainingExport().catch(err => {
        log.error('Scheduled training export failed', { error: String(err) });
      });
    }, intervalMs);
  }

  /**
   * Run training data export
   */
  async runTrainingExport(): Promise<{ success: boolean; path?: string; count?: number; error?: string }> {
    try {
      log.info('Starting training data export...');

      // Ensure export directory exists
      await fs.mkdir(this.config.trainingExportPath, { recursive: true });

      // Get training data
      const data = await this.trainingDataService.getTrainingData({
        isGoodExample: true, // Only export high-quality examples
      });

      if (data.length === 0) {
        log.info('No training data to export');
        return { success: true, count: 0 };
      }

      // Convert to JSONL format (OpenAI/Anthropic fine-tuning compatible)
      const jsonlContent = data.map((entry: {
        taskId?: string;
        taskDescription?: string;
        taskType?: string;
        complexity?: number;
        claudeOutput?: unknown;
        localOutput?: unknown;
        claudeSuccess?: boolean;
        localSuccess?: boolean;
        qualityScore?: number;
        isGoodExample?: boolean;
      }) => {
        const messages = [
          {
            role: 'system',
            content: 'You are an expert software engineer. Complete the given coding task.',
          },
          {
            role: 'user',
            content: `Task: ${entry.taskDescription}\nType: ${entry.taskType}\nComplexity: ${entry.complexity}/10`,
          },
          {
            role: 'assistant',
            content: JSON.stringify(entry.claudeOutput || entry.localOutput || {}),
          },
        ];

        return JSON.stringify({
          messages,
          metadata: {
            taskId: entry.taskId,
            complexity: entry.complexity,
            success: entry.claudeSuccess ?? entry.localSuccess,
            qualityScore: entry.qualityScore,
            isGoodExample: entry.isGoodExample,
          },
        });
      }).join('\n');

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `training-data-${timestamp}.jsonl`;
      const filepath = path.join(this.config.trainingExportPath, filename);

      // Write file
      await fs.writeFile(filepath, jsonlContent, 'utf-8');

      this.lastExportTime = new Date();

      log.info('Exported training examples', { count: data.length, filename });

      // Clean up old exports
      await this.cleanupOldExports();

      return { success: true, path: filepath, count: data.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Training export failed', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Clean up exports older than retention period
   */
  private async cleanupOldExports(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.trainingExportPath);
      const now = Date.now();
      const retentionMs = this.config.trainingExportRetentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.startsWith('training-data-')) continue;

        const filepath = path.join(this.config.trainingExportPath, file);
        const stats = await fs.stat(filepath);

        if (now - stats.mtime.getTime() > retentionMs) {
          await fs.unlink(filepath);
          log.info('Deleted old export', { file });
        }
      }
    } catch (error) {
      log.error('Cleanup failed', { error: String(error) });
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    trainingExport: {
      enabled: boolean;
      intervalHours: number;
      lastExport: Date | null;
      exportPath: string;
    };
  } {
    return {
      trainingExport: {
        enabled: this.config.trainingExportEnabled,
        intervalHours: this.config.trainingExportIntervalHours,
        lastExport: this.lastExportTime,
        exportPath: this.config.trainingExportPath,
      },
    };
  }

  /**
   * Manually trigger training export
   */
  async triggerExport(): Promise<{ success: boolean; path?: string; count?: number; error?: string }> {
    return this.runTrainingExport();
  }
}
