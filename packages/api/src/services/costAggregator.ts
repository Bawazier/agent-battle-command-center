import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getModelRate, getModelTier, type ModelTier } from './costCalculator.js';

type TierTotals = Record<ModelTier, number>;

function emptyTierTotals(): TierTotals {
  return { free: 0, remote: 0, grok: 0, haiku: 0, sonnet: 0, opus: 0 };
}

function costOf(inputTokens: number, outputTokens: number, model: string | null): number {
  if (inputTokens === 0 && outputTokens === 0) return 0;
  const rates = getModelRate(model);
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

/**
 * In-memory rolling totals for execution log costs.
 *
 * Hydrated once from the database at boot, then incremented O(1) per log
 * insert. Replaces the previous full-table scan + reduce that ran on every
 * POST /api/execution-logs and made each subsequent insert slower.
 */
export class CostAggregator {
  private hydrated = false;
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private byModelTier: TierTotals = emptyTierTotals();

  constructor(private readonly prisma: PrismaClient) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const groups = await this.prisma.executionLog.groupBy({
      by: ['modelUsed'],
      _sum: { inputTokens: true, outputTokens: true },
    });
    for (const g of groups) {
      const input = g._sum.inputTokens ?? 0;
      const output = g._sum.outputTokens ?? 0;
      const cost = costOf(input, output, g.modelUsed);
      this.totalCost += cost;
      this.totalInputTokens += input;
      this.totalOutputTokens += output;
      this.byModelTier[getModelTier(g.modelUsed)] += cost;
    }
    this.hydrated = true;
  }

  addLog(log: { inputTokens?: number | null; outputTokens?: number | null; modelUsed?: string | null }): void {
    // No-op until hydrated to avoid emitting a snapshot that's missing historical
    // totals — would briefly show lower-than-actual cost on a dashboard mount
    // that races against bootup.
    if (!this.hydrated) return;
    const input = log.inputTokens ?? 0;
    const output = log.outputTokens ?? 0;
    if (input === 0 && output === 0) return;
    const cost = costOf(input, output, log.modelUsed ?? null);
    this.totalCost += cost;
    this.totalInputTokens += input;
    this.totalOutputTokens += output;
    this.byModelTier[getModelTier(log.modelUsed ?? null)] += cost;
  }

  snapshot() {
    return {
      totalCost: this.totalCost,
      byModelTier: { ...this.byModelTier },
      totalTokens: {
        input: this.totalInputTokens,
        output: this.totalOutputTokens,
        total: this.totalInputTokens + this.totalOutputTokens,
      },
    };
  }
}

/** Singleton instance, hydrated once at server bootstrap. */
export const costAggregator = new CostAggregator(prisma);
