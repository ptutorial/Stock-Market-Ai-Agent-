import { performance } from 'node:perf_hooks';
import { LLMGateway } from '../dist/gateway.js';
import { InMemoryStateStore } from '../dist/state.js';
const accounts = ['fair-a', 'fair-b', 'fair-c'].map((id, i) => ({ id, provider: 'groq', credentialRef: `KEY_${i}`, models: ['fair-model'], capabilities: ['chat'], priority: 1, limits: { rpm: 10000, tpm: 100000 } }));
class Adapter { name = 'groq'; calls = new Map(); async generate(account, request, model, credential, requestId) { this.calls.set(account.id, (this.calls.get(account.id) ?? 0) + 1); return { text: 'ok', provider: 'groq', accountId: account.id, model: model.id, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, requestId, latencyMs: 0 }; } async *stream() {} async discoverModels(account) { return [{ id: 'fair-model', provider: 'groq', capabilities: account.capabilities, available: true }]; } async healthCheck() { return true; } }
const adapter = new Adapter();
const stateStore = new InMemoryStateStore();
const gateway = new LLMGateway({ accounts, adapters: [adapter], strategy: 'round_robin', maxRetries: 0, stateStore }, { async get(ref) { return ref; } });
const total = Number(process.env.FAIRNESS_REQUESTS ?? 300);
const started = performance.now();
await Promise.all(Array.from({ length: total }, (_, i) => gateway.generate('general', `fair-${i}`)));
const counts = Object.fromEntries(accounts.map((a) => [a.id, adapter.calls.get(a.id) ?? 0]));
const values = Object.values(counts); const spread = Math.max(...values) - Math.min(...values); const minExpected = Math.floor(total / accounts.length); const maxExpected = Math.ceil(total / accounts.length);
console.log(JSON.stringify({ total, counts, spread, expectedRange: [minExpected, maxExpected], elapsedMs: Number((performance.now() - started).toFixed(2)) }, null, 2));
if (values.some((v) => v < minExpected || v > maxExpected)) process.exitCode = 1;
