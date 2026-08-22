import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRegistry } from '../dist/model-registry.js';

test('caches discovered models until TTL expires', async () => {
  let calls = 0;
  const adapter = {
    name: 'gemini',
    async discoverModels(account) {
      calls += 1;
      return account.models.map((id) => ({ id, provider: 'gemini', capabilities: ['chat', 'streaming'], available: true }));
    },
    async generate() { throw new Error('unused'); },
    async *stream() { yield { text: '' }; },
    async healthCheck() { return true; },
  };
  const account = {
    id: 'a1', provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat', 'streaming'],
  };
  const registry = new ModelRegistry({ ttlMs: 60_000 });
  await registry.discover(account, adapter, 'secret');
  await registry.discover(account, adapter, 'secret');
  assert.equal(calls, 1);
});

test('force refresh and invalidate bypass cache', async () => {
  let calls = 0;
  const adapter = {
    name: 'gemini',
    async discoverModels() { calls += 1; return [{ id: 'm1', provider: 'gemini', capabilities: ['chat'] }]; },
    async generate() { throw new Error('unused'); },
    async *stream() { yield { text: '' }; },
    async healthCheck() { return true; },
  };
  const account = { id: 'a1', provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'] };
  const registry = new ModelRegistry({ ttlMs: 60_000 });
  await registry.discover(account, adapter, 'secret');
  await registry.discover(account, adapter, 'secret', true);
  registry.invalidate('a1');
  await registry.discover(account, adapter, 'secret');
  assert.equal(calls, 3);
});

test('filters discovered capabilities to account capabilities', async () => {
  const adapter = {
    name: 'gemini',
    async discoverModels() { return [{ id: 'm1', provider: 'gemini', capabilities: ['chat', 'streaming', 'vision'] }]; },
    async generate() { throw new Error('unused'); },
    async *stream() { yield { text: '' }; },
    async healthCheck() { return true; },
  };
  const account = { id: 'a1', provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'] };
  const models = await new ModelRegistry().discover(account, adapter, 'secret');
  assert.deepEqual(models[0].capabilities, ['chat']);
});
