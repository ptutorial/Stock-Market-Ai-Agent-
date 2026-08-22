import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRouter, createRoutingCandidates } from '../dist/router.js';

const adapter = { name: 'gemini', generate() {}, stream() {}, discoverModels() {}, healthCheck() {} };
const account = (id, priority = 0) => ({ id, provider: 'gemini', credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'], priority });
const model = (id = 'm1') => ({ id, provider: 'gemini', capabilities: ['chat'], available: true });
const state = (overrides = {}) => ({ requests: 0, tokens: 0, failures: 0, health: 'healthy', ...overrides });

test('filters disabled, cooling down and incompatible candidates', () => {
  const router = new ModelRouter({ clock: () => 1000 });
  const candidates = [
    { account: account('ok', 10), state: state(), adapter, model: model(), score: 0 },
    { account: { ...account('disabled'), enabled: false }, state: state(), adapter, model: model(), score: 0 },
    { account: account('cooldown'), state: state({ cooldownUntil: 2000 }), adapter, model: model(), score: 0 },
    { account: account('vision'), state: state(), adapter, model: { ...model(), capabilities: ['vision'] }, score: 0 },
  ];
  assert.equal(router.select(candidates).account.id, 'ok');
});

test('selects highest priority', () => {
  const router = new ModelRouter();
  const candidates = [
    { account: account('low', 1), state: state(), adapter, model: model(), score: 0 },
    { account: account('high', 100), state: state(), adapter, model: model(), score: 0 },
  ];
  assert.equal(router.select(candidates).account.id, 'high');
});

test('round robin cycles through eligible candidates', () => {
  const router = new ModelRouter({ strategy: 'round_robin' });
  const candidates = [1, 2].map((id) => ({ account: account(String(id)), state: state(), adapter, model: model(), score: 0 }));
  assert.equal(router.select(candidates).account.id, '1');
  assert.equal(router.select(candidates).account.id, '2');
  assert.equal(router.select(candidates).account.id, '1');
});

test('creates candidates from account, state, adapter and model maps', () => {
  const accounts = [account('a1'), account('a2')];
  const candidates = createRoutingCandidates(
    accounts,
    new Map([['a1', state()], ['a2', state()]]),
    new Map([['gemini', adapter]]),
    new Map([['a1', [model('m1')]], ['a2', [model('m2')]]]),
  );
  assert.equal(candidates.length, 2);
});
