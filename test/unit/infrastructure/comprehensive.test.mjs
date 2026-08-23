import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayError, HealthMonitor, InMemoryMetrics, InMemoryUsageStore, enrichUsage, isRetryable, recordRequest, redactObject, selectFallback, validateCredentialRef, validateOutboundUrl, withRetry } from '../../../dist/index.js';

test('public API exposes phase 9-12 building blocks', () => {
  for (const value of [HealthMonitor, InMemoryMetrics, InMemoryUsageStore, enrichUsage, isRetryable, recordRequest, redactObject, selectFallback, validateCredentialRef, validateOutboundUrl, withRetry]) assert.equal(typeof value, 'function');
});

test('usage flows into observability without request content', async () => {
  const usage = enrichUsage({ inputTokens: 100, outputTokens: 50 }, { inputCostPerMillion: 2, outputCostPerMillion: 4 });
  const store = new InMemoryUsageStore();
  await store.record({ requestId: 'r1', accountId: 'a1', provider: 'p1', model: 'm1', timestamp: 100, usage });
  const totals = await store.totals();
  assert.equal(totals.totalTokens, 150);
  assert.equal(totals.estimatedCost, 0.0004);
  const metrics = new InMemoryMetrics();
  recordRequest(metrics, { requestId: 'r1', provider: 'p1', accountId: 'a1', model: 'm1', operation: 'generate', startedAt: 100, latencyMs: 20, success: true, totalTokens: totals.totalTokens, estimatedCost: totals.estimatedCost });
  assert.equal(metrics.snapshot().events[0].requestId, 'r1');
  assert.equal(metrics.snapshot().events[0].prompt, undefined);
});

test('retry and fallback preserve failure boundaries', async () => {
  let attempts = 0;
  const result = await withRetry(async () => { attempts += 1; if (attempts < 2) throw new GatewayError('ProviderUnavailableError', 'temporary failure', true); return 'ok'; }, { maxAttempts: 2, sleep: async () => {} });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.equal(selectFallback([{ candidate: 'unsupported', capabilities: ['text'] }, { candidate: 'usable', capabilities: ['text', 'vision'] }], ['vision']), 'usable');
  assert.equal(selectFallback([{ candidate: 'blocked', available: false, capabilities: ['text'] }], ['text']), undefined);
});

test('health quarantine prevents unhealthy accounts from routing', () => {
  let now = 1000;
  const monitor = new HealthMonitor(() => now);
  const initial = { requests: 0, tokens: 0, failures: 0, health: 'healthy' };
  const state = monitor.recordFailure('a1', initial, new GatewayError('RateLimitError', 'limited', true, 5000));
  assert.equal(monitor.isEligible(state), false);
  now = 6000;
  assert.equal(monitor.isEligible(state), true);
});

test('security controls reject unsafe outbound access and redact secrets', () => {
  assert.equal(validateCredentialRef('env:PROVIDER_KEY'), 'env:PROVIDER_KEY');
  assert.deepEqual(redactObject({ authorization: 'Bearer secret', nested: { token: 'secret', safe: 'value' } }), { authorization: '[REDACTED]', nested: { token: '[REDACTED]', safe: 'value' } });
  assert.equal(validateOutboundUrl('https://api.example.com/v1', ['api.example.com']).protocol, 'https:');
  assert.throws(() => validateOutboundUrl('http://api.example.com/v1', ['api.example.com']));
});

test('authentication errors are never retryable', () => {
  assert.equal(isRetryable(new GatewayError('AuthenticationError', 'invalid credentials', true)), false);
  assert.equal(isRetryable(new GatewayError('RateLimitError', 'limited', true)), true);
});
