import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../types/index.js';
import type { Server as SocketIOServer } from 'socket.io';
import type { CodeReviewService } from '../services/codeReviewService.js';
import { createLogger } from '../logger.js';

const log = createLogger('CodeReviewRoute');

export const codeReviewsRouter: RouterType = Router();

// Get review schedule status (tiered review counters)
codeReviewsRouter.get('/schedule', asyncHandler(async (req, res) => {
  const codeReviewService = req.app.get('codeReviewService') as CodeReviewService;

  if (!codeReviewService) {
    res.status(503).json({ error: 'Code review service not available' });
    return;
  }

  const status = codeReviewService.getScheduleStatus();
  const isEnabled = codeReviewService.isEnabled();

  res.json({
    enabled: isEnabled,
    schedule: {
      ollamaReviewInterval: parseInt(process.env.OLLAMA_REVIEW_INTERVAL || '5', 10),
      opusReviewInterval: parseInt(process.env.OPUS_REVIEW_INTERVAL || '10', 10),
      opusMinComplexity: 5,
      qualityThreshold: parseInt(process.env.REVIEW_QUALITY_THRESHOLD || '6', 10),
    },
    counters: status,
  });
}));

// Reset review counters (for testing)
codeReviewsRouter.post('/schedule/reset', asyncHandler(async (req, res) => {
  const codeReviewService = req.app.get('codeReviewService') as CodeReviewService;

  if (!codeReviewService) {
    res.status(503).json({ error: 'Code review service not available' });
    return;
  }

  codeReviewService.resetCounters();

  res.json({ success: true, message: 'Review counters reset' });
}));

// Get code review for a task
codeReviewsRouter.get('/task/:taskId', asyncHandler(async (req, res) => {
  const review = await prisma.codeReview.findFirst({
    where: { taskId: req.params.taskId },
    orderBy: { createdAt: 'desc' },
  });

  if (!review) {
    res.status(404).json({ error: 'No code review found for this task' });
    return;
  }

  res.json(review);
}));

// Get all code reviews (with pagination)
codeReviewsRouter.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string;

  const where = status ? { status } : {};

  const [reviews, total] = await Promise.all([
    prisma.codeReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.codeReview.count({ where }),
  ]);

  res.json({ reviews, total, limit, offset });
}));

// Create a code review
codeReviewsRouter.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    taskId: z.string().uuid(),
    reviewerId: z.string().optional(),
    reviewerModel: z.string().optional(),
    initialComplexity: z.number(),
    opusComplexity: z.number().optional(),
    findings: z.array(z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      category: z.string(),
      description: z.string(),
      location: z.string().optional(),
      suggestion: z.string().optional(),
    })).default([]),
    summary: z.string().optional(),
    codeQualityScore: z.number().min(0).max(10).optional(),
    status: z.enum(['pending', 'approved', 'needs_fixes', 'rejected']).default('pending'),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalCost: z.number().optional(),
  });

  const data = schema.parse(req.body);

  const review = await prisma.codeReview.create({
    data: {
      ...data,
      totalCost: data.totalCost ? data.totalCost : undefined,
    },
  });

  // Emit code review started event for audio feedback
  const io = req.app.get('io') as SocketIOServer;
  io.emit('code_review_started', {
    type: 'code_review_started',
    payload: {
      taskId: data.taskId,
      reviewId: review.id,
      reviewerId: data.reviewerId,
      reviewerModel: data.reviewerModel,
    },
    timestamp: new Date(),
  });

  res.status(201).json(review);
}));

// Update a code review (for fix tracking)
codeReviewsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const schema = z.object({
    status: z.enum(['pending', 'approved', 'needs_fixes', 'rejected']).optional(),
    fixAttempts: z.number().optional(),
    fixedByAgentId: z.string().optional(),
    fixedByModel: z.string().optional(),
    findings: z.array(z.any()).optional(),
    summary: z.string().optional(),
    codeQualityScore: z.number().min(0).max(10).optional(),
    opusComplexity: z.number().optional(),
  });

  const data = schema.parse(req.body);

  const review = await prisma.codeReview.update({
    where: { id: req.params.id },
    data,
  });

  res.json(review);
}));

// Trigger a code review for a task (calls Opus to review)
codeReviewsRouter.post('/trigger/:taskId', asyncHandler(async (req, res) => {
  const codeReviewService = req.app.get('codeReviewService') as CodeReviewService;

  if (!codeReviewService) {
    res.status(503).json({ error: 'Code review service not available' });
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
  });

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.status !== 'completed') {
    res.status(400).json({ error: 'Can only review completed tasks' });
    return;
  }

  // Trigger the review asynchronously
  codeReviewService.triggerReview(req.params.taskId, null).catch((error) => {
    log.error('Code review failed', { error: String(error) });
  });

  res.json({
    success: true,
    message: 'Code review triggered',
    taskId: req.params.taskId,
  });
}));

// Get review stats summary
codeReviewsRouter.get('/stats', asyncHandler(async (req, res) => {
  const [
    total,
    approved,
    needsFixes,
    avgQualityScore,
    totalCost,
  ] = await Promise.all([
    prisma.codeReview.count(),
    prisma.codeReview.count({ where: { status: 'approved' } }),
    prisma.codeReview.count({ where: { status: 'needs_fixes' } }),
    prisma.codeReview.aggregate({ _avg: { codeQualityScore: true } }),
    prisma.codeReview.aggregate({ _sum: { totalCost: true } }),
  ]);

  res.json({
    total,
    approved,
    needsFixes,
    approvalRate: total > 0 ? (approved / total * 100).toFixed(1) : 0,
    avgQualityScore: avgQualityScore._avg.codeQualityScore?.toFixed(1) || 'N/A',
    totalCost: totalCost._sum.totalCost?.toString() || '0',
  });
}));
