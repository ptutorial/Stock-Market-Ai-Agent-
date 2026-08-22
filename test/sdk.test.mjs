import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClientBuilder } from '../dist/sdk.js';

const account = { id: 'a1', provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'] };
const adapter = {
  name: 'gemini',
  discoverModels: async () => [{ id: 'm1', provider: 'gemini', capabilities: ['chat'] }],
  healthCheck: async () => true,
  generate: async (_account, _request, model, _credential, requestId) => ({ text: 'ok', provider: 'gemini', accountId: 'a1', model: model.id, usage: { totalTokens: 2 }, requestId, latencyMs: 1 }),
  stream: async function* () { yield { text: 'ok', done: true }; },
};
const credentials = { get: async () => 'secret' };

test('builder validates required configuration', () => {
  assert.throws(() => new GatewayClientBuilder().build(), /account is required/);
  assert.throws(() => new GatewayClientBuilder().addAccount(account).build(), /adapter is required/);
});

test('builder creates a typed client that generates through the gateway', async () => {
  const client = new GatewayClientBuilder().addAccount(account).addAdapter(adapter).credentialStore(credentials).maxRetries(1).build();
  const result = await client.generate({ task: 'general', prompt: 'hello' });
  assert.equal(result.text, 'ok');
  assert.equal(result.model, 'm1');
});

test('client exposes streaming API', async () => {
  const client = new GatewayClientBuilder().addAccount(account).addAdapter(adapter).credentialStore(credentials).build();
  const chunks = [];
  for await (const chunk of client.stream({ task: 'general', prompt: 'hello' })) chunks.push(chunk);
  assert.equal(chunks[0].text, 'ok');
});
