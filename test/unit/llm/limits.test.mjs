import assert from 'node:assert/strict';
import test from 'node:test';
import { RateLimitTracker } from '../../../dist/limits.js';
const account = (limits) => ({ id: 'a1', provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'], limits });
const state = { requests: 0, tokens: 0, failures: 0, health: 'healthy' };
test('enforces RPM and TPM limits', () => { let now = 0; const tracker = new RateLimitTracker(() => now); const a = account({ rpm: 2, tpm: 100 }); assert.equal(tracker.canAccept(a, state, 50), true); tracker.record('a1', 50); assert.equal(tracker.canAccept(a, state, 50), true); tracker.record('a1', 50); assert.equal(tracker.canAccept(a, state, 1), false); now = 60_001; assert.equal(tracker.canAccept(a, state, 50), true); });
test('enforces daily request limit', () => { let now = 0; const tracker = new RateLimitTracker(() => now); const a = account({ rpd: 1 }); tracker.record('a1'); assert.equal(tracker.canAccept(a, state), false); now = 86_400_001; assert.equal(tracker.canAccept(a, state), true); });
test('applies Retry-After cooldown', () => { let now = 1000; const tracker = new RateLimitTracker(() => now); tracker.applyRetryAfter('a1', 5000); assert.equal(tracker.canAccept(account({}), state), true); assert.equal(tracker.cooldownUntil('a1'), 6000); now = 6000; assert.equal(tracker.cooldownUntil('a1'), undefined); });
test('parses common rate-limit headers', () => { const tracker = new RateLimitTracker(() => 1000); const headers = new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': '10', 'retry-after': '2' }); assert.deepEqual(tracker.parseHeaders(headers), { limit: 60, remaining: 10, resetAt: 10_000, retryAfterMs: 2000 }); });
