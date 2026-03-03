import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { TaskQueueService } from './taskQueue.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('HumanEscalation');

export class HumanEscalationService {
  private checkInterval: NodeJS.Timeout | null = null;
  private checkIntervalMs = 60 * 1000; // Check every minute

  constructor(
    private prisma: PrismaClient,
    private io: SocketIOServer,
    private taskQueue: TaskQueueService
  ) {}

  startChecker(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkTimeouts().catch((err) => log.error('Timeout check failed', { error: err instanceof Error ? err.message : String(err) }));
    }, this.checkIntervalMs);

    log.info('Human escalation checker started');
  }

  stopChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      log.info('Human escalation checker stopped');
    }
  }

  private async checkTimeouts(): Promise<void> {
    // Find tasks that have been waiting for human input too long
    const timedOutTasks = await this.prisma.task.findMany({
      where: {
        status: 'needs_human',
        needsHumanAt: {
          lt: new Date(Date.now() - config.humanTimeoutMinutes * 60 * 1000),
        },
        escalatedToAgentId: null,
      },
      include: {
        assignedAgent: {
          include: { agentType: true },
        },
      },
    });

    for (const task of timedOutTasks) {
      await this.escalateTask(task.id);
    }
  }

  async escalateTask(taskId: string): Promise<boolean> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedAgent: {
          include: { agentType: true },
        },
      },
    });

    if (!task) return false;

    // Find a more capable agent (for now, just find another idle agent)
    const escalationAgent = await this.prisma.agent.findFirst({
      where: {
        id: { not: task.assignedAgentId ?? undefined },
        status: 'idle',
      },
      include: { agentType: true },
    });

    if (!escalationAgent) {
      // No agent available for escalation
      this.io.emit('alert', {
        type: 'escalation',
        severity: 'error',
        title: 'Escalation Failed',
        message: `No agent available to escalate task "${task.title}"`,
        taskId,
        createdAt: new Date(),
      });
      return false;
    }

    // Transfer task to new agent
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        escalatedToAgentId: escalationAgent.id,
        assignedAgentId: escalationAgent.id,
        status: 'assigned',
        needsHumanAt: null,
      },
    });

    // Update old agent
    if (task.assignedAgentId) {
      await this.prisma.agent.update({
        where: { id: task.assignedAgentId },
        data: {
          status: 'idle',
          currentTaskId: null,
        },
      });
    }

    // Update new agent
    await this.prisma.agent.update({
      where: { id: escalationAgent.id },
      data: {
        status: 'busy',
        currentTaskId: taskId,
      },
    });

    // Emit alert
    this.io.emit('alert', {
      type: 'escalation',
      severity: 'warning',
      title: 'Task Escalated',
      message: `Task "${task.title}" escalated from ${task.assignedAgent?.name || 'unknown'} to ${escalationAgent.name}`,
      taskId,
      agentId: escalationAgent.id,
      createdAt: new Date(),
    });

    log.info('Task escalated', { taskId, agentId: escalationAgent.id });
    return true;
  }

  async getRemainingTime(taskId: string): Promise<number | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.status !== 'needs_human' || !task.needsHumanAt) {
      return null;
    }

    const timeoutAt = new Date(task.needsHumanAt.getTime() + task.humanTimeoutMinutes * 60 * 1000);
    const remaining = timeoutAt.getTime() - Date.now();

    return Math.max(0, remaining);
  }
}
