import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from 'redis';
import { AtomicRedisStateStore } from '../dist/redis.js';

const redisUrl = process.env.REDIS_URL;

test('Redis quota reservation remains atomic under concurrency', { skip: !redisUrl }, async () => {
  const client = createClient({ url: redisUrl });
  await client.connect();
  const store = new AtomicRedisStateStore(client);
  const accountId = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.reserve(accountId, 10, { rpm: 3, tpm: 100 }, Date.now())));
    assert.equal(results.filter(Boolean).length, 3);
    const quota = await store.getQuotaUsage(accountId);
    assert.equal(quota.minuteRequests, 3);
    assert.equal(quota.minuteTokens, 30);
    const state = await store.get(accountId);
    assert.equal(state, undefined);
  } finally {
    await client.quit();
  }
});
