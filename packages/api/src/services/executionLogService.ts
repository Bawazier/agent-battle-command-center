import type { PrismaClient, Prisma } from '@prisma/client';

export interface CreateExecutionLogInput {
  taskId: string;
  agentId: string;
  step: number;
  thought?: string;
  action: string;
  actionInput: Prisma.InputJsonValue;
  observation: string;
  durationMs?: number;
  isLoop?: boolean;
  errorTrace?: string;
}

export class ExecutionLogService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new execution log entry
   */
  async createLog(input: CreateExecutionLogInput) {
    return await this.prisma.executionLog.create({
      data: {
        taskId: input.taskId,
        agentId: input.agentId,
        step: input.step,
        thought: input.thought,
        action: input.action,
        actionInput: input.actionInput,
        observation: input.observation,
        durationMs: input.durationMs,
        isLoop: input.isLoop || false,
        errorTrace: input.errorTrace,
      },
    });
  }

  /**
   * Get execution logs for a task, paginated by step (ascending cursor).
   *
   * Response envelope: { items, nextCursor }. Callers pass afterStep=<lastCursor>
   * to fetch the next page; nextCursor is null when the page is the last one.
   */
  async getTaskLogs(taskId: string, opts: { afterStep?: number; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 500));
    const items = await this.prisma.executionLog.findMany({
      where: {
        taskId,
        ...(opts.afterStep !== undefined && { step: { gt: opts.afterStep } }),
      },
      orderBy: { step: 'asc' },
      take: limit + 1, // probe for "has more"
      include: {
        agent: {
          include: {
            agentType: true,
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1].step : null;
    return { items: page, nextCursor };
  }

  /**
   * Get all execution logs for an agent
   */
  async getAgentLogs(agentId: string, limit: number = 100) {
    return await this.prisma.executionLog.findMany({
      where: { agentId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        task: true,
      },
    });
  }

  /**
   * Get execution logs with loop detection
   */
  async getLoopLogs(taskId: string) {
    return await this.prisma.executionLog.findMany({
      where: {
        taskId,
        isLoop: true,
      },
      orderBy: { step: 'asc' },
    });
  }

  /**
   * Delete execution logs for a task (cleanup)
   */
  async deleteTaskLogs(taskId: string) {
    return await this.prisma.executionLog.deleteMany({
      where: { taskId },
    });
  }
}
