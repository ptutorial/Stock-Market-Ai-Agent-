import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBackoff, isRetryable, selectFallback, withRetry } from '../dist/retry.js';
import { GatewayError } from '../dist/errors.js';

test('classifies retryable and non-retryable failures', () => {
  assert.equal(isRetryable(new GatewayError('RateLimitError', 'limited', true)), true);
  assert.equal(isRetryable(new GatewayError('AuthenticationError', 'auth', true)), false);
  assert.equal(isRetryable(new GatewayError('InvalidRequestError', 'bad', false)), false);
});

test('Retry-After takes precedence over exponential backoff', () => {
  assert.equal(calculateBackoff(2, { baseDelayMs: 100, maxDelayMs: 1000 }, 2500), 2500);
});

test('backoff is bounded and deterministic with zero jitter', () => {
  assert.equal(calculateBackoff(5, { baseDelayMs: 100, maxDelayMs: 500, jitter: 0 }, undefined, () => 0.5), 500);
});

test('retries transient failures and stops after success', async () => {
  let calls = 0;
  const waits = [];
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new GatewayError('ProviderUnavailableError', 'down', true);
    return 'ok';
  }, { maxAttempts: 3, sleep: async (ms) => waits.push(ms), jitter: 0 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 500]);
});

test('does not retry authentication failures', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => {
    calls += 1;
    throw new GatewayError('AuthenticationError', 'bad key', false);
  }, { maxAttempts: 5, sleep: async () => {} }));
  assert.equal(calls, 1);
});

test('fallback preserves required capabilities', () => {
  assert.equal(selectFallback([
    { candidate: 'vision', capabilities: ['chat', 'vision'] },
    { candidate: 'chat', capabilities: ['chat'] },
  ], ['vision']), 'vision');
  assert.equal(selectFallback([
    { candidate: 'chat', capabilities: ['chat'] },
  ], ['vision']), undefined);
});
