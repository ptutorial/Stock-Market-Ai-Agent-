import { randomUUID } from 'node:crypto';
import { GatewayError, normalizeError } from './errors.js';
import type { AccountConfig, AccountState, Capability, GenerateRequest, GenerateResult, ModelInfo, ProviderAdapter, RoutingStrategy, StreamChunk, TaskType } from './domain.js';
import { InMemoryStateStore } from './state.js';
import type { StateStore } from './state.js';
import { ModelRegistry } from './model-registry.js';
import { ModelRouter } from './router.js';

export interface CredentialStore { get(credentialRef: string): Promise<string>; }
export interface UsageSink { record(event: Record<string, unknown>): Promise<void> | void; }
export class EnvironmentCredentialStore implements CredentialStore {
  async get(credentialRef: string): Promise<string> {
    const value = process.env[credentialRef];
    if (!value) throw new GatewayError('AuthenticationError', `Credential ${credentialRef} is not configured`);
    return value;
  }
}
export class InMemoryUsageSink implements UsageSink {
  readonly events: Record<string, unknown>[] = [];
  record(event: Record<string, unknown>): void { this.events.push(event); }
}
export interface GatewayConfig {
  accounts: AccountConfig[];
  adapters: ProviderAdapter[];
  strategy?: RoutingStrategy;
  fallbackProviders?: string[];
  maxRetries?: number;
  cooldownMs?: number;
  stateStore?: StateStore;
  modelRegistry?: ModelRegistry;
}
interface Candidate { account: AccountConfig; state: AccountState; adapter: ProviderAdapter; model: ModelInfo; score: number; }

export class LLMGateway {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly stateStore: StateStore;
  private readonly modelRegistry: ModelRegistry;
  private readonly credentialStore: CredentialStore;
  private readonly usage: UsageSink;
  private readonly router: ModelRouter;
  private readonly config: Required<Pick<GatewayConfig, 'maxRetries' | 'cooldownMs'>>;

  constructor(private readonly cfg: GatewayConfig, credentialStore: CredentialStore = new EnvironmentCredentialStore(), usage: UsageSink = new InMemoryUsageSink()) {
    this.credentialStore = credentialStore;
    this.usage = usage;
    this.stateStore = cfg.stateStore ?? new InMemoryStateStore();
    this.modelRegistry = cfg.modelRegistry ?? new ModelRegistry();
    this.router = new ModelRouter({ strategy: cfg.strategy ?? 'priority' });
    this.config = { maxRetries: cfg.maxRetries ?? 2, cooldownMs: cfg.cooldownMs ?? 30_000 };
    for (const adapter of cfg.adapters) this.adapters.set(adapter.name, adapter);
    for (const account of cfg.accounts) void this.stateStore.set(account.id, { requests: 0, tokens: 0, failures: 0, health: account.enabled === false ? 'disabled' : 'healthy' });
  }

  async generate(task: TaskType, prompt: string, options: GenerateRequest['options'] = {}): Promise<GenerateResult> {
    const request: GenerateRequest = { prompt, options: { ...options, task: options.task ?? task } };
    const candidates = await this.selectCandidates(request);
    if (!candidates.length) throw new GatewayError('ProviderUnavailableError', 'No eligible provider/account/model is available');
    const requestId = randomUUID();
    let lastError: GatewayError | undefined;
    for (const candidate of candidates) {
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          const credential = await this.credentialStore.get(candidate.account.credentialRef);
          const reserved = await this.stateStore.reserve(candidate.account.id, this.estimatedTokens(request), candidate.account.limits ?? {});
          if (!reserved) {
            lastError = new GatewayError('RateLimitError', `Account ${candidate.account.id} quota is exhausted`, true);
            await this.markFailure(candidate.account.id, lastError);
            break;
          }
          const started = Date.now();
          const result = await candidate.adapter.generate(candidate.account, request, candidate.model, credential, requestId);
          await this.markSuccess(candidate.account.id, result.usage.totalTokens ?? 0, Date.now() - started);
          await this.usage.record({ requestId, provider: candidate.account.provider, accountId: candidate.account.id, model: result.model, latencyMs: Date.now() - started, success: true, usage: result.usage });
          return result;
        } catch (error) {
          const normalized = normalizeError(error);
          lastError = normalized;
          await this.markFailure(candidate.account.id, normalized);
          await this.usage.record({ requestId, provider: candidate.account.provider, accountId: candidate.account.id, model: candidate.model.id, success: false, errorCategory: normalized.category, retry: attempt < this.config.maxRetries && normalized.retryable });
          if (!normalized.retryable || attempt === this.config.maxRetries) break;
          await this.backoff(attempt, normalized.retryAfterMs);
        }
      }
    }
    throw lastError ?? new GatewayError('ProviderUnavailableError', 'All eligible providers failed');
  }

  stream(task: TaskType, prompt: string, options: GenerateRequest['options'] = {}): AsyncIterable<StreamChunk> {
    const self = this;
    return (async function* () {
      const request: GenerateRequest = { prompt, options: { ...options, task: options.task ?? task } };
      const candidates = await self.selectCandidates(request);
      if (!candidates.length) throw new GatewayError('ProviderUnavailableError', 'No eligible provider/account/model is available');
      const requestId = randomUUID();
      let startedDelivery = false;
      let lastError: GatewayError | undefined;
      for (const candidate of candidates) {
        try {
          const credential = await self.credentialStore.get(candidate.account.credentialRef);
          const reserved = await self.stateStore.reserve(candidate.account.id, self.estimatedTokens(request), candidate.account.limits ?? {});
          if (!reserved) { lastError = new GatewayError('RateLimitError', `Account ${candidate.account.id} quota is exhausted`, true); await self.markFailure(candidate.account.id, lastError); continue; }
          const started = Date.now();
          let finalUsage = 0;
          for await (const chunk of candidate.adapter.stream(candidate.account, request, candidate.model, credential, requestId)) {
            startedDelivery = true;
            finalUsage = chunk.usage?.totalTokens ?? finalUsage;
            yield chunk;
          }
          await self.markSuccess(candidate.account.id, finalUsage, Date.now() - started);
          await self.usage.record({ requestId, provider: candidate.account.provider, accountId: candidate.account.id, model: candidate.model.id, latencyMs: Date.now() - started, success: true, usage: { totalTokens: finalUsage } });
          return;
        } catch (error) {
          const normalized = normalizeError(error);
          lastError = normalized;
          await self.markFailure(candidate.account.id, normalized);
          await self.usage.record({ requestId, provider: candidate.account.provider, accountId: candidate.account.id, model: candidate.model.id, success: false, errorCategory: normalized.category, streaming: true });
          if (startedDelivery) throw error;
        }
      }
      throw lastError ?? new GatewayError('ProviderUnavailableError', 'All eligible streaming providers failed');
    })();
  }

  private async selectCandidates(request: GenerateRequest): Promise<Candidate[]> {
    const options = request.options ?? {};
    const required: Capability[] = options.capabilities ?? ['chat'];
    const providerOrder = this.cfg.fallbackProviders ?? [...this.adapters.keys()];
    const result: Candidate[] = [];
    for (const provider of providerOrder) {
      const adapter = this.adapters.get(provider);
      if (!adapter) continue;
      for (const account of this.cfg.accounts.filter((item) => item.provider === provider && item.enabled !== false)) {
        const state = await this.stateStore.get(account.id) ?? { requests: 0, tokens: 0, failures: 0, health: 'healthy' as const };
        if (state.health === 'disabled' || state.health === 'authentication_failure' || (state.cooldownUntil ?? 0) > Date.now()) continue;
        if (!required.every((capability) => account.capabilities.includes(capability))) continue;
        const models = options.model ? account.models.filter((model) => model === options.model) : account.models;
        if (!models.length) continue;
        let credential: string;
        try { credential = await this.credentialStore.get(account.credentialRef); } catch (error) { await this.markFailure(account.id, normalizeError(error)); continue; }
        let discovered: ModelInfo[];
        try { discovered = await this.modelRegistry.discover(account, adapter, credential); } catch (error) { await this.markFailure(account.id, normalizeError(error)); continue; }
        for (const model of discovered) {
          if (!models.includes(model.id) || model.available === false) continue;
          if (!required.every((capability) => model.capabilities.includes(capability))) continue;
          result.push({ account, state, adapter, model, score: 0 });
        }
      }
    }
    return this.router.rank(result, { task: options.task, capabilities: required, model: options.model });
  }

  private estimatedTokens(request: GenerateRequest): number {
    const options = request.options ?? {};
    const input = request.messages?.reduce((sum, message) => sum + Math.ceil(message.content.length / 4), 0) ?? Math.ceil(request.prompt.length / 4);
    return input + Math.max(0, options.maxTokens ?? 0);
  }

  private async markSuccess(id: string, tokens: number, latencyMs?: number): Promise<void> {
    await this.stateStore.update(id, (current) => {
      const state = current ?? { requests: 0, tokens: 0, failures: 0, health: 'healthy' as const };
      const now = Date.now();
      const previousLatency = Number(state.metadata?.latencyMs);
      const smoothedLatency = Number.isFinite(previousLatency) && previousLatency > 0 && latencyMs !== undefined ? previousLatency * 0.7 + latencyMs * 0.3 : latencyMs;
      return { ...state, tokens: state.tokens + tokens, lastUsedAt: now, lastSuccessAt: now, failures: 0, cooldownUntil: undefined, health: 'healthy', metadata: { ...state.metadata, ...(smoothedLatency !== undefined ? { latencyMs: smoothedLatency } : {}) } };
    });
  }

  private async markFailure(id: string, error: GatewayError): Promise<void> {
    await this.stateStore.update(id, (current) => {
      const state = current ?? { requests: 0, tokens: 0, failures: 0, health: 'healthy' as const };
      const now = Date.now();
      const failures = state.failures + 1;
      return { ...state, lastFailureAt: now, failures, health: error.category === 'RateLimitError' ? 'rate_limited' : error.category === 'AuthenticationError' ? 'authentication_failure' : 'degraded', cooldownUntil: now + (error.retryAfterMs ?? this.config.cooldownMs) };
    });
  }

  private async backoff(attempt: number, retryAfterMs?: number): Promise<void> {
    const delay = retryAfterMs ?? Math.min(10_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
