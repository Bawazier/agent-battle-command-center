/**
 * Training Data API Routes
 *
 * Endpoints for managing training dataset collection and export
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { TrainingDataService } from '../services/trainingDataService.js';
import { createLogger } from '../logger.js';

const log = createLogger('TrainingDataRoute');

const router: RouterType = Router();
const prisma = new PrismaClient();
const trainingDataService = new TrainingDataService(prisma);

/**
 * GET /api/training-data
 * Get all training data with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      taskType: req.query.taskType as string | undefined,
      minComplexity: req.query.minComplexity ? Number(req.query.minComplexity) : undefined,
      maxComplexity: req.query.maxComplexity ? Number(req.query.maxComplexity) : undefined,
      isGoodExample: req.query.isGoodExample ? req.query.isGoodExample === 'true' : undefined,
      humanReviewed: req.query.humanReviewed ? req.query.humanReviewed === 'true' : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };

    const data = await trainingDataService.getTrainingData(filters);
    res.json(data);
  } catch (error) {
    log.error('Failed to fetch training data', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch training data' });
  }
});

/**
 * GET /api/training-data/stats
 * Get statistics about collected training data
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await trainingDataService.getStats();
    res.json(stats);
  } catch (error) {
    log.error('Failed to fetch training data stats', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch training data stats' });
  }
});

/**
 * GET /api/training-data/export
 * Export training data in JSONL format for fine-tuning
 *
 * Query params:
 * - taskType: Filter by task type
 * - minComplexity: Minimum complexity score (0-10)
 * - isGoodExample: Only export high-quality examples
 */
router.get('/export', async (req, res) => {
  try {
    const filters = {
      taskType: req.query.taskType as string | undefined,
      minComplexity: req.query.minComplexity ? Number(req.query.minComplexity) : undefined,
      isGoodExample: req.query.isGoodExample ? req.query.isGoodExample === 'true' : undefined,
    };

    const jsonl = await trainingDataService.exportToJSONL(filters);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', 'attachment; filename="training-data.jsonl"');
    res.send(jsonl);
  } catch (error) {
    log.error('Failed to export training data', { error: String(error) });
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

/**
 * GET /api/training-data/:id
 * Get a specific training data entry
 */
router.get('/:id', async (req, res) => {
  try {
    const dataset = await prisma.trainingDataset.findUnique({
      where: { id: req.params.id },
    });

    if (!dataset) {
      return res.status(404).json({ error: 'Training data not found' });
    }

    res.json(dataset);
  } catch (error) {
    log.error('Failed to fetch training data entry', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch training data entry' });
  }
});

const reviewSchema = z.object({
  notes: z.string().optional(),
});

/**
 * POST /api/training-data/:id/review
 * Mark a training example for human review
 */
router.post('/:id/review', async (req, res) => {
  try {
    const data = reviewSchema.parse(req.body);
    await trainingDataService.markForReview(req.params.id, data.notes);
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to mark for review', { error: String(error) });
    res.status(500).json({ error: 'Failed to mark for review' });
  }
});

const updateTrainingDataSchema = z.object({
  isGoodExample: z.boolean().optional(),
  humanReviewed: z.boolean().optional(),
  reviewNotes: z.string().optional(),
});

/**
 * PATCH /api/training-data/:id
 * Update training data metadata
 */
router.patch('/:id', async (req, res) => {
  try {
    const data = updateTrainingDataSchema.parse(req.body);

    const updated = await prisma.trainingDataset.update({
      where: { id: req.params.id },
      data: {
        ...(data.isGoodExample !== undefined && { isGoodExample: data.isGoodExample }),
        ...(data.humanReviewed !== undefined && { humanReviewed: data.humanReviewed }),
        ...(data.reviewNotes !== undefined && { reviewNotes: data.reviewNotes }),
      },
    });

    res.json(updated);
  } catch (error) {
    log.error('Failed to update training data', { error: String(error) });
    res.status(500).json({ error: 'Failed to update training data' });
  }
});

/**
 * DELETE /api/training-data/:id
 * Delete a training data entry
 */
router.delete('/:id', async (req, res) => {
  try {
    await prisma.trainingDataset.delete({
      where: { id: req.params.id },
    });
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete training data', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete training data' });
  }
});

/**
 * GET /api/training-data/scheduler/status
 * Get scheduler status for training exports
 */
router.get('/scheduler/status', (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    if (!scheduler) {
      res.status(500).json({ error: 'Scheduler not initialized' });
      return;
    }
    res.json(scheduler.getStatus());
  } catch (error) {
    log.error('Failed to get scheduler status', { error: String(error) });
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

/**
 * POST /api/training-data/scheduler/export
 * Manually trigger a training data export
 */
router.post('/scheduler/export', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    if (!scheduler) {
      res.status(500).json({ error: 'Scheduler not initialized' });
      return;
    }
    const result = await scheduler.triggerExport();
    res.json(result);
  } catch (error) {
    log.error('Failed to trigger export', { error: String(error) });
    res.status(500).json({ error: 'Failed to trigger export' });
  }
});

export default router;
