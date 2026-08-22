import { performance } from 'node:perf_hooks';
import { LLMGateway } from '../dist/gateway.js';
import { InMemoryStateStore } from '../dist/state.js';

const total = Number(process.env.LOAD_REQUESTS ?? 1000);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 50);
const maxP95Ms = Number(process.env.LOAD_MAX_P95_MS ?? 250);

if (!Number.isInteger(total) || total < 1) throw new Error('LOAD_REQUESTS must be a positive integer');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > total) throw new Error('LOAD_CONCURRENCY must be between 1 and LOAD_REQUESTS');
if (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0) throw new Error('LOAD_MAX_P95_MS must be positive');

class LoadAdapter {
  name = 'groq';
  calls = 0;

  async generate(account, request, model, credential, requestId) {
    this.calls += 1;
    return {
      text: 'ok',
      provider: this.name,
      accountId: account.id,
      model: model.id,
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      requestId,
      latencyMs: 0,
    };
  }

  async *stream() {}

  async discoverModels(account) {
    return [{ id: 'load-model', provider: this.name, capabilities: account.capabilities, available: true }];
  }

  async healthCheck() { return true; }
}

const account = {
  id: 'load-account',
  provider: 'groq',
  credentialRef: 'LOAD_KEY',
  models: ['load-model'],
  capabilities: ['chat'],
  priority: 1,
  limits: { rpm: total + 10, tpm: total * 10 + 10 },
};

const adapter = new LoadAdapter();
const stateStore = new InMemoryStateStore();
const gateway = new LLMGateway(
  { adapters: [adapter], accounts: [account], strategy: 'round_robin', maxRetries: 0, stateStore },
  { async get(ref) { if (ref !== 'LOAD_KEY') throw new Error('missing credential'); return 'synthetic-load-credential'; } },
);

const durations = [];
let completed = 0;
let failed = 0;

const started = performance.now();
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const requestStarted = performance.now();
    try {
      const result = await gateway.generate('general', `load-${index}`);
      if (result.text !== 'ok') throw new Error('unexpected response');
      completed += 1;
      durations.push(performance.now() - requestStarted);
    } catch (error) {
      failed += 1;
      console.error(`load request ${index} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedMs = performance.now() - started;
durations.sort((a, b) => a - b);
const percentile = (p) => durations[Math.min(durations.length - 1, Math.ceil((p / 100) * durations.length) - 1)] ?? 0;
const p95Ms = percentile(95);
const throughput = completed / (elapsedMs / 1000);
const state = await stateStore.get(account.id);

console.log(JSON.stringify({
  total,
  concurrency,
  completed,
  failed,
  providerCalls: adapter.calls,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  throughputRps: Number(throughput.toFixed(2)),
  p95Ms: Number(p95Ms.toFixed(2)),
  stateRequests: state?.requests ?? 0,
  stateTokens: state?.tokens ?? 0,
}, null, 2));

if (failed !== 0) process.exitCode = 1;
if (completed !== total) process.exitCode = 1;
if (adapter.calls !== total) process.exitCode = 1;
if ((state?.requests ?? 0) !== total) process.exitCode = 1;
if (p95Ms > maxP95Ms) {
  console.error(`p95 latency ${p95Ms.toFixed(2)}ms exceeded ${maxP95Ms}ms`);
  process.exitCode = 1;
}
