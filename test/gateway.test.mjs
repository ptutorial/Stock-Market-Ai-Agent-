import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../dist/gateway.js';

class FakeAdapter {
  name = 'groq';
  calls = [];
  async generate(account, request, model, credential, requestId) {
    this.calls.push({ account: account.id, credential, model });
    if (credential === 'bad') throw new Error('503 provider unavailable');
    return { text: 'ok', provider: this.name, accountId: account.id, model, usage: { totalTokens: 3 }, requestId, latencyMs: 1 };
  }
  async *stream() { yield { text: 'ok', done: true }; }
  async discoverModels() { return ['test-model']; }
  async healthCheck() { return true; }
}

const account = (id, credentialRef, priority) => ({ id, provider: 'groq', credentialRef, models: ['test-model'], capabilities: ['chat'], priority });

class FakeCredentials {
  constructor(values) { this.values = values; }
  async get(ref) { return this.values[ref]; }
}

test('uses the highest-priority healthy account', async () => {
  const adapter = new FakeAdapter();
  const gateway = new LLMGateway({ adapters: [adapter], accounts: [account('a1', 'A1', 10), account('a2', 'A2', 1)] }, new FakeCredentials({ A1: 'good', A2: 'good' }));
  const result = await gateway.generate('general', 'hello');
  assert.equal(result.accountId, 'a1');
});

test('falls back to another account after a retryable failure', async () => {
  const adapter = new FakeAdapter();
  const gateway = new LLMGateway({ adapters: [adapter], accounts: [account('a1', 'A1', 10), account('a2', 'A2', 1)], maxRetries: 0, cooldownMs: 1 }, new FakeCredentials({ A1: 'bad', A2: 'good' }));
  const result = await gateway.generate('general', 'hello');
  assert.equal(result.accountId, 'a2');
});
