/**
 * Training Data Collection Service
 *
 * Automatically captures Claude executions for future local model fine-tuning.
 * Stores complete context, execution logs, and success metrics.
 */

import type { PrismaClient, Task, Agent } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { TaskRouter } from './taskRouter.js';
import { createLogger } from '../logger.js';

const log = createLogger('TrainingData');

export interface TrainingDataInput {
  taskId: string;
  taskDescription: string;
  taskType: string;
  expectedOutput?: string;
  agentId: string;
  output: any;
  logs: any[];
  success: boolean;
  tokens?: number;
  durationMs?: number;
  usedClaude: boolean;
}

export interface TrainingDataExport {
  taskDescription: string;
  taskType: string;
  complexity: number;
  claudeOutput: any;
  claudeSuccess: boolean;
  localOutput?: any;
  localSuccess?: boolean;
  isDifferent?: boolean;
  qualityScore?: number;
  isGoodExample: boolean;
  createdAt: Date;
}

export class TrainingDataService {
  private taskRouter: TaskRouter;

  constructor(private prisma: PrismaClient) {
    this.taskRouter = new TaskRouter(prisma);
  }

  /**
   * Capture execution for training dataset
   * Automatically called after any task execution
   */
  async captureExecution(input: TrainingDataInput): Promise<void> {
    try {
      // Get task details
      const task = await this.prisma.task.findUnique({
        where: { id: input.taskId },
      });

      if (!task) {
        log.warn('Task not found - cannot capture training data', { taskId: input.taskId });
        return;
      }

      // Calculate complexity
      const complexity = this.taskRouter.calculateComplexity(task);

      // Get agent info
      const agent = await this.prisma.agent.findUnique({
        where: { id: input.agentId },
        include: { agentType: true },
      });

      if (!agent) {
        log.warn('Agent not found - cannot capture training data', { agentId: input.agentId });
        return;
      }

      // Determine if this is Claude or local execution
      const isClaudeExecution = input.usedClaude;
      const isCTOAgent = agent.agentType.name === 'cto';

      // Find existing dataset entry for this task
      let existing = await this.prisma.trainingDataset.findFirst({
        where: { taskId: input.taskId },
      });

      if (existing) {
        // Update existing entry
        if (isClaudeExecution || isCTOAgent) {
          // Update Claude execution data
          await this.prisma.trainingDataset.update({
            where: { id: existing.id },
            data: {
              claudeAgentId: input.agentId,
              claudeOutput: input.output,
              claudeLogs: input.logs,
              claudeSuccess: input.success,
              claudeTokens: input.tokens,
              claudeDurationMs: input.durationMs,
              updatedAt: new Date(),
            },
          });
        } else {
          // Update local execution data
          await this.prisma.trainingDataset.update({
            where: { id: existing.id },
            data: {
              localAgentId: input.agentId,
              localOutput: input.output,
              localLogs: input.logs,
              localSuccess: input.success,
              localTokens: input.tokens,
              localDurationMs: input.durationMs,
              updatedAt: new Date(),
            },
          });

          // If we now have both Claude and local results, analyze differences
          if (existing.claudeOutput) {
            await this.analyzeDifferences(existing.id);
          }
        }
      } else {
        // Create new entry
        const data: any = {
          taskId: input.taskId,
          taskDescription: input.taskDescription,
          taskType: input.taskType,
          expectedOutput: input.expectedOutput,
          complexity,
        };

        if (isClaudeExecution || isCTOAgent) {
          // Claude execution
          data.claudeAgentId = input.agentId;
          data.claudeOutput = input.output;
          data.claudeLogs = input.logs;
          data.claudeSuccess = input.success;
          data.claudeTokens = input.tokens;
          data.claudeDurationMs = input.durationMs;
        } else {
          // Local execution
          data.localAgentId = input.agentId;
          data.localOutput = input.output;
          data.localLogs = input.logs;
          data.localSuccess = input.success;
          data.localTokens = input.tokens;
          data.localDurationMs = input.durationMs;
        }

        await this.prisma.trainingDataset.create({ data });
      }

      log.info('✅ Captured execution for task', { type: isClaudeExecution ? 'Claude' : 'local', taskId: input.taskId });
    } catch (error) {
      log.error('Failed to capture training data', { error: error instanceof Error ? error.message : String(error) });
      // Don't throw - we don't want to break task execution
    }
  }

  /**
   * Analyze differences between Claude and local execution
   */
  private async analyzeDifferences(datasetId: string): Promise<void> {
    const dataset = await this.prisma.trainingDataset.findUnique({
      where: { id: datasetId },
    });

    if (!dataset || !dataset.claudeOutput || !dataset.localOutput) {
      return;
    }

    // Compare success rates
    const isDifferent = dataset.claudeSuccess !== dataset.localSuccess;

    // Calculate quality score (0-1)
    // Higher if Claude succeeded and local failed
    let qualityScore = 0.5;
    if (dataset.claudeSuccess && !dataset.localSuccess) {
      qualityScore = 0.9; // Good training example - shows where local needs improvement
    } else if (!dataset.claudeSuccess && dataset.localSuccess) {
      qualityScore = 0.3; // Interesting case - local succeeded where Claude failed
    } else if (dataset.claudeSuccess && dataset.localSuccess) {
      qualityScore = 0.6; // Both succeeded - validate consistency
    } else {
      qualityScore = 0.2; // Both failed - less useful for training
    }

    // Mark as good example if Claude succeeded and (local failed OR complexity > 7)
    const isGoodExample =
      dataset.claudeSuccess === true &&
      (dataset.localSuccess === false || dataset.complexity > 7);

    await this.prisma.trainingDataset.update({
      where: { id: datasetId },
      data: {
        isDifferent,
        qualityScore,
        isGoodExample,
      },
    });
  }

  /**
   * Get all training data with filters
   */
  async getTrainingData(filters?: {
    taskType?: string;
    minComplexity?: number;
    maxComplexity?: number;
    isGoodExample?: boolean;
    humanReviewed?: boolean;
    limit?: number;
  }): Promise<any[]> {
    const where: any = {};

    if (filters?.taskType) {
      where.taskType = filters.taskType;
    }

    if (filters?.minComplexity !== undefined || filters?.maxComplexity !== undefined) {
      where.complexity = {};
      if (filters.minComplexity !== undefined) {
        where.complexity.gte = filters.minComplexity;
      }
      if (filters.maxComplexity !== undefined) {
        where.complexity.lte = filters.maxComplexity;
      }
    }

    if (filters?.isGoodExample !== undefined) {
      where.isGoodExample = filters.isGoodExample;
    }

    if (filters?.humanReviewed !== undefined) {
      where.humanReviewed = filters.humanReviewed;
    }

    return this.prisma.trainingDataset.findMany({
      where,
      orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }],
      take: filters?.limit || 100,
    });
  }

  /**
   * Export training data in JSONL format (OpenAI fine-tuning compatible)
   */
  async exportToJSONL(filters?: {
    taskType?: string;
    minComplexity?: number;
    isGoodExample?: boolean;
  }): Promise<string> {
    const datasets = await this.getTrainingData({
      ...filters,
      humanReviewed: false, // Include all for now
      limit: 1000,
    });

    // Convert to JSONL format (one JSON object per line)
    const jsonlLines = datasets
      .filter((d) => d.claudeOutput) // Only export entries with Claude data
      .map((dataset) => {
        // Format for OpenAI/Anthropic fine-tuning
        const entry = {
          messages: [
            {
              role: 'system',
              content:
                'You are an expert software engineer assistant. Complete tasks accurately and verify your work.',
            },
            {
              role: 'user',
              content: `Task: ${dataset.taskDescription}\nType: ${dataset.taskType}\nComplexity: ${dataset.complexity}/10`,
            },
            {
              role: 'assistant',
              content: JSON.stringify(dataset.claudeOutput),
            },
          ],
          metadata: {
            taskId: dataset.taskId,
            complexity: dataset.complexity,
            success: dataset.claudeSuccess,
            qualityScore: dataset.qualityScore,
            isGoodExample: dataset.isGoodExample,
          },
        };
        return JSON.stringify(entry);
      });

    return jsonlLines.join('\n');
  }

  /**
   * Mark a training example for human review
   */
  async markForReview(datasetId: string, notes?: string): Promise<void> {
    await this.prisma.trainingDataset.update({
      where: { id: datasetId },
      data: {
        humanReviewed: true,
        reviewNotes: notes,
      },
    });
  }

  /**
   * Get statistics about collected training data
   */
  async getStats(): Promise<{
    total: number;
    claudeExecutions: number;
    localExecutions: number;
    comparisonPairs: number;
    goodExamples: number;
    avgComplexity: number;
    avgQualityScore: number;
  }> {
    const total = await this.prisma.trainingDataset.count();
    const claudeExecutions = await this.prisma.trainingDataset.count({
      where: { claudeOutput: { not: Prisma.JsonNull } },
    });
    const localExecutions = await this.prisma.trainingDataset.count({
      where: { localOutput: { not: Prisma.JsonNull } },
    });
    const comparisonPairs = await this.prisma.trainingDataset.count({
      where: {
        AND: [{ claudeOutput: { not: Prisma.JsonNull } }, { localOutput: { not: Prisma.JsonNull } }],
      },
    });
    const goodExamples = await this.prisma.trainingDataset.count({
      where: { isGoodExample: true },
    });

    // Get averages
    const datasets = await this.prisma.trainingDataset.findMany({
      select: { complexity: true, qualityScore: true },
    });

    const avgComplexity =
      datasets.reduce((sum, d) => sum + d.complexity, 0) / (datasets.length || 1);
    const avgQualityScore =
      datasets.reduce((sum, d) => sum + (d.qualityScore || 0), 0) / (datasets.length || 1);

    return {
      total,
      claudeExecutions,
      localExecutions,
      comparisonPairs,
      goodExamples,
      avgComplexity,
      avgQualityScore,
    };
  }
}
