import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryUsageStore, createUsageRecord, estimateCost, enrichUsage, normalizeUsage } from '../dist/usage.js';

test('normalizes token usage', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 5 }), { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('estimates model cost from per-million token rates', () => {
  const usage = { inputTokens: 1000, outputTokens: 500 };
  const model = { id: 'm1', provider: 'gemini', capabilities: [], inputCostPerMillion: 2, outputCostPerMillion: 4 };
  assert.equal(estimateCost(usage, model), 0.004);
});

test('account pricing is fallback when model pricing is unavailable', () => {
  const usage = enrichUsage({ inputTokens: 1000, outputTokens: 500 }, { id: 'm1', provider: 'gemini', capabilities: [] }, { id: 'a1', provider: 'gemini', credentialRef: 'x', models: [], capabilities: [], costPerMillionInput: 2, costPerMillionOutput: 4 });
  assert.equal(usage.estimatedCost, 0.004);
  assert.equal(usage.currency, 'USD');
});

test('aggregates usage by filters', async () => {
  const store = new InMemoryUsageStore();
  const model = { id: 'm1', provider: 'gemini', capabilities: [], inputCostPerMillion: 2, outputCostPerMillion: 4 };
  await store.record(createUsageRecord({ requestId: 'r1', accountId: 'a1', provider: 'gemini', model: 'm1', usage: { inputTokens: 1000, outputTokens: 500 }, latencyMs: 100 }, model, undefined, 100));
  await store.record(createUsageRecord({ requestId: 'r2', accountId: 'a2', provider: 'gemini', model: 'm1', usage: { inputTokens: 2000, outputTokens: 1000 }, latencyMs: 200 }, model, undefined, 200));
  const totals = await store.totals({ accountId: 'a1' });
  assert.deepEqual(totals, { requests: 1, inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCost: 0.004, currency: 'USD' });
});
