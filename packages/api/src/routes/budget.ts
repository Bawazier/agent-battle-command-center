/**
 * Budget API Routes
 *
 * Endpoints for budget tracking and configuration.
 */

import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import { asyncHandler } from "../types/index.js";
import { budgetService } from "../services/budgetService.js";
import { Parser } from "@json2csv/plainjs/index.js";

export const budgetRouter: RouterType = Router();

// Get current budget status
budgetRouter.get('/status', asyncHandler(async (req, res) => {
  const status = budgetService.getStatus();
  const costPerTask = budgetService.getCostPerTaskMetrics();

  res.json({
    ...status,
    costPerTask,
    // Format for display
    display: {
      dailySpent: `$${(status.dailySpentCents / 100).toFixed(2)}`,
      dailyLimit: `$${(status.dailyLimitCents / 100).toFixed(2)}`,
      allTimeSpent: `$${(status.allTimeSpentCents / 100).toFixed(2)}`,
      avgCostPerTask: `$${(costPerTask.avgCostCents / 100).toFixed(4)}`,
      todayAvgCost: `$${(costPerTask.todayAvg / 100).toFixed(4)}`,
    },
  });
}));

// Get budget configuration
budgetRouter.get('/config', asyncHandler(async (req, res) => {
  const config = budgetService.getConfig();

  res.json({
    ...config,
    dailyLimitDollars: config.dailyLimitCents / 100,
  });
}));

// Update budget configuration
budgetRouter.patch('/config', asyncHandler(async (req, res) => {
  const schema = z.object({
    dailyLimitCents: z.number().min(0).optional(),
    dailyLimitDollars: z.number().min(0).optional(), // Convenience field
    warningThreshold: z.number().min(0).max(1).optional(),
    enabled: z.boolean().optional(),
  });

  const data = schema.parse(req.body);

  // Convert dollars to cents if provided
  if (data.dailyLimitDollars !== undefined) {
    data.dailyLimitCents = Math.round(data.dailyLimitDollars * 100);
    delete data.dailyLimitDollars;
  }

  budgetService.setConfig(data);

  res.json({
    message: 'Budget configuration updated',
    config: budgetService.getConfig(),
  });
}));

// Reset daily budget (rate-limited: once per 5 minutes to prevent abuse)
let lastBudgetResetTime = 0;
const BUDGET_RESET_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

budgetRouter.post('/reset', asyncHandler(async (req, res) => {
  const now = Date.now();
  if (now - lastBudgetResetTime < BUDGET_RESET_COOLDOWN_MS) {
    const remainingSec = Math.ceil((BUDGET_RESET_COOLDOWN_MS - (now - lastBudgetResetTime)) / 1000);
    res.status(429).json({
      error: 'Too many resets',
      message: `Budget reset is rate-limited. Try again in ${remainingSec}s.`,
    });
    return;
  }

  lastBudgetResetTime = now;
  budgetService.resetDaily();

  res.json({
    message: 'Daily budget reset',
    status: budgetService.getStatus(),
  });
}));

// Get spending history
budgetRouter.get('/history', asyncHandler(async (req, res) => {
  const schema = z.object({
    days: z.coerce.number().min(1).max(90).default(7),
  });

  const { days } = schema.parse(req.query);
  const history = budgetService.getHistory(days);

  res.json({
    history,
    summary: {
      totalDays: history.length,
      totalSpentCents: history.reduce((sum, d) => sum + d.spentCents, 0),
      totalTasks: history.reduce((sum, d) => sum + d.taskCount, 0),
    },
  });
}));

// Check if Claude is blocked (for quick checks from task router)
budgetRouter.get('/claude-blocked', asyncHandler(async (req, res) => {
  res.json({
    blocked: budgetService.isClaudeBlocked(),
    status: budgetService.getStatus(),
  });
}));

// Export budget history (for reporting/debugging)
// Example: GET /api/budget/export?range=week&format=csv
// Range: today, week, month, all (last 90 days)
budgetRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      range: z.enum(["today", "week", "month", "all"]).default("today"),
      format: z.enum(["csv", "json", "jsonl"]).default("csv"),
    });

    const { range, format } = schema.parse(req.query);
    const daysMap: Record<string, number> = { today: 1, week: 7, month: 30, all: 90 };
    const days = daysMap[range];
    const history = budgetService.getHistory(days);

    let output: string;
    if (format === "csv") {
      output = new Parser().parse(history);
    } else if (format === "json") {
      output = JSON.stringify(history, null, 2);
    } else if (format === "jsonl") {
      output = history.map((row) => JSON.stringify(row)).join("\n");
    } else {
      throw new Error(`Unknown format: ${format}`);
    }

    res.setHeader(
      "Content-Type",
      format === "csv" ? "text/csv; charset=utf-8" : "application/json",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="budget-export.${format}"`,
    );
    res.setHeader("X-Export-Format", format);

    res.send(output);
  }),
);
