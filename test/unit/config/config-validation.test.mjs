import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGatewayConfig } from '../../../dist/config-validation.js';

const adapter = (name = 'gemini') => ({ name, generate: async () => { throw new Error('unused'); }, stream: async function* () {}, discoverModels: async () => [], healthCheck: async () => true });
const account = (overrides = {}) => ({ id: 'gemini-1', provider: 'gemini', credentialRef: 'GEMINI_KEY_1', models: ['model-a'], capabilities: ['chat'], ...overrides });

test('accepts a valid multi-account provider configuration', () => { assert.doesNotThrow(() => validateGatewayConfig({ accounts: [account(), account({ id: 'gemini-2', credentialRef: 'GEMINI_KEY_2' })], adapters: [adapter()] })); });
test('rejects duplicate account ids', () => { assert.throws(() => validateGatewayConfig({ accounts: [account(), account()], adapters: [adapter()] }), /Duplicate account id/); });
test('rejects accounts without an adapter', () => { assert.throws(() => validateGatewayConfig({ accounts: [account({ provider: 'groq' })], adapters: [adapter()] }), /without an adapter/); });
test('rejects accounts without models', () => { assert.throws(() => validateGatewayConfig({ accounts: [account({ models: [] })], adapters: [adapter()] }), /no configured models/); });
test('rejects invalid quota limits', () => { assert.throws(() => validateGatewayConfig({ accounts: [account({ limits: { rpm: -1 } })], adapters: [adapter()] }), /invalid quota limit/); });
