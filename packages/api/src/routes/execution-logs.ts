import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../types/index.js';
import { ExecutionLogService } from '../services/executionLogService.js';
import { costAggregator } from '../services/costAggregator.js';
import { emitCostUpdate, emitExecutionLogCreated } from '../websocket/handler.js';
import { budgetService } from '../services/budgetService.js';
import type { Prisma } from '@prisma/client';

export const executionLogsRouter: RouterType = Router();

const createLogSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string(), // Agent IDs are not UUIDs (e.g., "qa-01", "coder-01")
  step: z.number().int().min(0),
  thought: z.string().optional(),
  action: z.string().min(1),
  actionInput: z.any(), // Use z.any() for JSON - will be validated as Prisma.InputJsonValue
  observation: z.string(),
  durationMs: z.number().int().min(0).optional(),
  isLoop: z.boolean().optional(),
  errorTrace: z.string().optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  modelUsed: z.string().optional(),
});

// Get recent execution logs (all agents/tasks)
executionLogsRouter.get('/', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

  const logs = await prisma.executionLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: Math.min(limit, 200), // Cap at 200
  });

  // Return in chronological order (oldest first)
  res.json(logs.reverse());
}));

// Create new execution log
executionLogsRouter.post('/', asyncHandler(async (req, res) => {
  const logService = new ExecutionLogService(prisma);
  const input = createLogSchema.parse(req.body);

  const log = await logService.createLog({
    ...input,
    actionInput: input.actionInput as Prisma.InputJsonValue,
  });

  // Record usage in budget service
  if (log.inputTokens || log.outputTokens) {
    budgetService.recordUsage(
      log.inputTokens || 0,
      log.outputTokens || 0,
      log.modelUsed || ''
    );
  }

  const io = req.app.get('io') as SocketIOServer;
  if (io) {
    // Fan out the new log row to live UI panels (replaces 10s polling).
    emitExecutionLogCreated(io, log);

    // Emit cost update via the O(1) in-memory accumulator
    // (was: full-table scan + reduce on every insert — O(n²) over a session)
    if (log.inputTokens || log.outputTokens) {
      costAggregator.addLog(log);
      emitCostUpdate(io, costAggregator.snapshot());
    }
  }

  res.status(201).json(log);
}));

// Get logs for a specific task (paginated by step cursor)
executionLogsRouter.get('/task/:taskId', asyncHandler(async (req, res) => {
  const logService = new ExecutionLogService(prisma);
  const afterStep = req.query.afterStep !== undefined
    ? parseInt(req.query.afterStep as string)
    : undefined;
  const limit = req.query.limit !== undefined
    ? parseInt(req.query.limit as string)
    : undefined;

  const result = await logService.getTaskLogs(req.params.taskId, { afterStep, limit });
  res.json(result);
}));

// Get all logs for a specific agent
executionLogsRouter.get('/agent/:agentId', asyncHandler(async (req, res) => {
  const logService = new ExecutionLogService(prisma);
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const logs = await logService.getAgentLogs(req.params.agentId, limit);

  res.json(logs);
}));

// Get loop detection logs for a task
executionLogsRouter.get('/task/:taskId/loops', asyncHandler(async (req, res) => {
  const logService = new ExecutionLogService(prisma);
  const logs = await logService.getLoopLogs(req.params.taskId);

  res.json(logs);
}));

// Delete all logs for a task (cleanup)
executionLogsRouter.delete('/task/:taskId', asyncHandler(async (req, res) => {
  const logService = new ExecutionLogService(prisma);
  const result = await logService.deleteTaskLogs(req.params.taskId);

  res.json({ deleted: result.count });
}));
