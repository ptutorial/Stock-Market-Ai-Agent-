import type { AccountConfig, ModelInfo, Usage } from './domain.js';

export interface UsageRecord {
  requestId: string;
  accountId: string;
  provider: string;
  model: string;
  timestamp: number;
  latencyMs?: number;
  usage: Usage;
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: string;
}

export interface UsageStore {
  record(record: UsageRecord): Promise<void>;
  totals(filter?: { accountId?: string; provider?: string; model?: string; from?: number; to?: number }): Promise<UsageTotals>;
}

export function normalizeUsage(usage: Usage = {}): Usage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return { ...usage, inputTokens, outputTokens, totalTokens: usage.totalTokens ?? inputTokens + outputTokens };
}

export function estimateCost(usage: Usage, model: ModelInfo, account?: AccountConfig): number {
  const inputRate = model.inputCostPerMillion ?? account?.costPerMillionInput ?? 0;
  const outputRate = model.outputCostPerMillion ?? account?.costPerMillionOutput ?? 0;
  return ((usage.inputTokens ?? 0) * inputRate + (usage.outputTokens ?? 0) * outputRate) / 1_000_000;
}

export function enrichUsage(usage: Usage, model: ModelInfo, account?: AccountConfig): Usage {
  const normalized = normalizeUsage(usage);
  return { ...normalized, estimatedCost: normalized.estimatedCost ?? estimateCost(normalized, model, account), currency: normalized.currency ?? 'USD' };
}

export class InMemoryUsageStore implements UsageStore {
  private readonly records: UsageRecord[] = [];

  async record(record: UsageRecord): Promise<void> { this.records.push({ ...record, usage: normalizeUsage(record.usage) }); }

  async totals(filter: { accountId?: string; provider?: string; model?: string; from?: number; to?: number } = {}): Promise<UsageTotals> {
    const rows = this.records.filter((record) =>
      (!filter.accountId || record.accountId === filter.accountId) &&
      (!filter.provider || record.provider === filter.provider) &&
      (!filter.model || record.model === filter.model) &&
      (filter.from === undefined || record.timestamp >= filter.from) &&
      (filter.to === undefined || record.timestamp <= filter.to));
    return rows.reduce<UsageTotals>((total, record) => {
      total.requests += 1;
      total.inputTokens += record.usage.inputTokens ?? 0;
      total.outputTokens += record.usage.outputTokens ?? 0;
      total.totalTokens += record.usage.totalTokens ?? 0;
      total.estimatedCost += record.usage.estimatedCost ?? 0;
      total.currency = record.usage.currency ?? total.currency;
      return total;
    }, { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, currency: 'USD' });
  }
}

export function createUsageRecord(
  result: { provider: string; accountId: string; model: string; usage: Usage; requestId: string; latencyMs: number },
  model: ModelInfo,
  account?: AccountConfig,
  timestamp = Date.now(),
): UsageRecord {
  return { requestId: result.requestId, accountId: result.accountId, provider: result.provider, model: result.model, timestamp, latencyMs: result.latencyMs, usage: enrichUsage(result.usage, model, account) };
}
