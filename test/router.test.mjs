import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRouter, createRoutingCandidates } from '../dist/router.js';

const adapter = { name: 'gemini', generate() {}, stream() {}, discoverModels() {}, healthCheck() {} };
const account = (id, priority = 0, provider = 'gemini') => ({ id, provider, credentialRef: 'KEY', models: ['m1'], capabilities: ['chat'], priority });
const model = (id = 'm1') => ({ id, provider: 'gemini', capabilities: ['chat'], available: true });
const state = (overrides = {}) => ({ requests: 0, tokens: 0, failures: 0, health: 'healthy', ...overrides });
const candidate = (id, overrides = {}) => ({ account: account(id, overrides.priority ?? 0, overrides.provider ?? 'gemini'), state: state(overrides.state), adapter, model: model(), score: 0 });

test('filters disabled, cooling down and incompatible candidates', () => {
  const router = new ModelRouter({ clock: () => 1000 });
  const candidates = [candidate('ok', { priority: 10 }), { ...candidate('disabled'), account: { ...account('disabled'), enabled: false } }, { ...candidate('cooldown'), state: state({ cooldownUntil: 2000 }) }, { ...candidate('vision'), model: { ...model(), capabilities: ['vision'] } }];
  assert.equal(router.select(candidates).account.id, 'ok');
});

test('selects highest priority', () => {
  const router = new ModelRouter();
  assert.equal(router.select([candidate('low', { priority: 1 }), candidate('high', { priority: 100 })]).account.id, 'high');
});

test('round robin cycles through eligible candidates', () => {
  const router = new ModelRouter({ strategy: 'round_robin' });
  const candidates = [candidate('1'), candidate('2')];
  assert.equal(router.select(candidates).account.id, '1');
  assert.equal(router.select(candidates).account.id, '2');
  assert.equal(router.select(candidates).account.id, '1');
});

test('fastest prefers lower observed latency', () => {
  const router = new ModelRouter({ strategy: 'fastest' });
  assert.equal(router.select([candidate('slow', { state: { metadata: { latencyMs: 1000 } } }), candidate('fast', { state: { metadata: { latencyMs: 100 } } })]).account.id, 'fast');
});

test('least recently used prefers the longest idle account', () => {
  const router = new ModelRouter({ strategy: 'least_recently_used', clock: () => 10_000 });
  assert.equal(router.select([candidate('recent', { state: { lastUsedAt: 9_500 } }), candidate('idle', { state: { lastUsedAt: 1_000 } })]).account.id, 'idle');
});

test('lowest utilization prefers the lower current quota utilization', () => {
  const router = new ModelRouter({ strategy: 'lowest_utilization' });
  assert.equal(router.select([candidate('high', { state: { metadata: { minuteRequestUtilization: 0.8, minuteTokenUtilization: 0.8 } } }), candidate('low', { state: { metadata: { minuteRequestUtilization: 0.1, minuteTokenUtilization: 0.1 } } })]).account.id, 'low');
});

test('provider order is used as deterministic fallback tie-breaker', () => {
  const router = new ModelRouter({ strategy: 'priority' });
  const ranked = router.rank([candidate('gemini-1', { provider: 'gemini' }), candidate('groq-1', { provider: 'groq' })], { providerOrder: ['groq', 'gemini'] });
  assert.deepEqual(ranked.map((item) => item.account.id), ['groq-1', 'gemini-1']);
});

test('creates candidates from account, state, adapter and model maps', () => {
  const accounts = [account('a1'), account('a2')];
  const candidates = createRoutingCandidates(accounts, new Map([['a1', state()], ['a2', state()]]), new Map([['gemini', adapter]]), new Map([['a1', [model('m1')]], ['a2', [model('m2')]]]));
  assert.equal(candidates.length, 2);
});
