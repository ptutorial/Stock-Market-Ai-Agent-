import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../dist/gateway.js';
import { ModelRegistry } from '../dist/model-registry.js';
import { InMemoryStateStore } from '../dist/state.js';

class FakeAdapter {
  constructor(name = 'groq') { this.name = name; this.calls = []; this.discoveries = 0; }
  async generate(account, request, model, credential, requestId) {
    this.calls.push({ account: account.id, credential, model: model.id });
    if (credential === 'bad') throw new Error('503 provider unavailable');
    return { text: 'ok', provider: this.name, accountId: account.id, model: model.id, usage: { totalTokens: 3 }, requestId, latencyMs: 1 };
  }
  async *stream() { yield { text: 'ok', done: true }; }
  async discoverModels(account) { this.discoveries += 1; return [{ id: 'test-model', provider: this.name, capabilities: account.capabilities, available: true }]; }
  async healthCheck() { return true; }
}

const account = (id, credentialRef, priority, limits, provider = 'groq') => ({ id, provider, credentialRef, models: ['test-model'], capabilities: ['chat'], priority, limits });
class FakeCredentials {
  constructor(values) { this.values = values; }
  async get(ref) { const value = this.values[ref]; if (!value) throw new Error(`missing ${ref}`); return value; }
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

test('caches model discovery per account', async () => {
  const adapter = new FakeAdapter();
  const registry = new ModelRegistry({ ttlMs: 60_000 });
  const gateway = new LLMGateway({ adapters: [adapter], accounts: [account('a1', 'A1', 10)], modelRegistry: registry }, new FakeCredentials({ A1: 'good' }));
  await gateway.generate('general', 'hello');
  await gateway.generate('general', 'hello');
  assert.equal(adapter.discoveries, 1);
});

test('enforces independent per-account request quotas', async () => {
  const adapter = new FakeAdapter();
  const stateStore = new InMemoryStateStore();
  const gateway = new LLMGateway({ adapters: [adapter], strategy: 'priority', maxRetries: 0, accounts: [account('a1', 'A1', 10, { rpm: 1 }), account('a2', 'A2', 1, { rpm: 1 })], stateStore }, new FakeCredentials({ A1: 'good', A2: 'good' }));
  const first = await gateway.generate('general', 'hello');
  const second = await gateway.generate('general', 'hello');
  assert.equal(first.accountId, 'a1');
  assert.equal(second.accountId, 'a2');
});

test('credential failure does not consume the account quota', async () => {
  const adapter = new FakeAdapter();
  const stateStore = new InMemoryStateStore();
  const gateway = new LLMGateway({ adapters: [adapter], accounts: [account('a1', 'A1', 10, { rpm: 1 })], stateStore }, new FakeCredentials({ A1: undefined }));
  await assert.rejects(() => gateway.generate('general', 'hello'));
  const state = await stateStore.get('a1');
  assert.equal(state?.requests, 0);
});

test('supports two independent Gemini accounts with deterministic provider ordering', async () => {
  const adapter = new FakeAdapter('gemini');
  const stateStore = new InMemoryStateStore();
  const gateway = new LLMGateway({
    adapters: [adapter],
    providerOrder: ['gemini'],
    strategy: 'priority',
    maxRetries: 0,
    accounts: [account('gemini-primary', 'G1', 10, { rpm: 1 }, 'gemini'), account('gemini-secondary', 'G2', 1, { rpm: 1 }, 'gemini')],
    stateStore,
  }, new FakeCredentials({ G1: 'good-primary', G2: 'good-secondary' }));
  const first = await gateway.generate('general', 'hello');
  const second = await gateway.generate('general', 'hello');
  assert.equal(first.accountId, 'gemini-primary');
  assert.equal(second.accountId, 'gemini-secondary');
  assert.deepEqual(adapter.calls.map((call) => call.account), ['gemini-primary', 'gemini-secondary']);
});
