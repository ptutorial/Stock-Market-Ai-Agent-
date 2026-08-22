import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryStateStore } from '../dist/state.js';

test('serializes concurrent reservations for one account', async () => {
  const store = new InMemoryStateStore();
  const limits = { rpm: 1, tpm: 100 };
  const results = await Promise.all(Array.from({ length: 20 }, () => store.reserve('a1', 10, limits, 0)));
  assert.equal(results.filter(Boolean).length, 1);
});

test('allows quota again after minute window rolls', async () => {
  const store = new InMemoryStateStore();
  const limits = { rpm: 1 };
  assert.equal(await store.reserve('a1', 0, limits, 0), true);
  assert.equal(await store.reserve('a1', 0, limits, 30_000), false);
  assert.equal(await store.reserve('a1', 0, limits, 60_001), true);
});

test('reservation counters are separate from account usage state', async () => {
  const store = new InMemoryStateStore();
  await store.set('a1', { requests: 0, tokens: 0, failures: 0, health: 'healthy' });
  assert.equal(await store.reserve('a1', 25, { rpm: 2, tpm: 100 }, 0), true);
  const state = await store.get('a1');
  const quota = await store.getQuotaUsage('a1', 0);
  assert.equal(state?.requests, 0);
  assert.equal(state?.tokens, 0);
  assert.deepEqual(quota, { minuteRequests: 1, dayRequests: 1, minuteTokens: 25, dayTokens: 25 });
});

test('persists and updates account state', async () => {
  const store = new InMemoryStateStore();
  await store.set('a1', { requests: 2, tokens: 20, failures: 0, health: 'healthy' });
  const state = await store.update('a1', (current) => ({ ...current, failures: 1 }));
  assert.equal(state.requests, 2);
  assert.equal(state.failures, 1);
});
