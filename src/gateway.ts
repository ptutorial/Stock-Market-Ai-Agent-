import { randomUUID } from 'node:crypto';
import { GatewayError, normalizeError } from './errors.js';
import type {
  AccountConfig,
  AccountState,
  Capability,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ProviderAdapter,
  RoutingStrategy,
  StreamChunk,
  TaskType,
} from './domain.js';

export interface CredentialStore {
  get(credentialRef: string): Promise<string>;
}

export interface UsageSink {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export class EnvironmentCredentialStore implements CredentialStore {
  async get(credentialRef: string): Promise<string> {
    const value = process.env[credentialRef];
    if (!value) {
      throw new GatewayError('AuthenticationError', `Credential ${credentialRef} is not configured`);
    }
    return value;
  }
}

export class InMemoryUsageSink implements UsageSink {
  readonly events: Record<string, unknown>[] = [];

  record(event: Record<string, unknown>): void {
    this.events.push(event);
  }
}

export interface GatewayConfig {
  accounts: AccountConfig[];
  adapters: ProviderAdapter[];
  strategy?: RoutingStrategy;
  fallbackProviders?: string[];
  maxRetries?: number;
  cooldownMs?: number;
}

interface Candidate {
  account: AccountConfig;
  state: AccountState;
  adapter: ProviderAdapter;
  model: ModelInfo;
  score: number;
}

export class LLMGateway {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly states = new Map<string, AccountState>();
  private readonly roundRobinCursor = new Map<string, number>();
  private readonly credentialStore: CredentialStore;
  private readonly usage: UsageSink;
  private readonly config: Required<Pick<GatewayConfig, 'maxRetries' | 'cooldownMs'>>;

  constructor(
    private readonly cfg: GatewayConfig,
    credentialStore: CredentialStore = new EnvironmentCredentialStore(),
    usage: UsageSink = new InMemoryUsageSink(),
  ) {
    this.credentialStore = credentialStore;
    this.usage = usage;
    this.config = {
      maxRetries: cfg.maxRetries ?? 2,
      cooldownMs: cfg.cooldownMs ?? 30_000,
    };

    for (const adapter of cfg.adapters) this.adapters.set(adapter.name, adapter);
    for (const account of cfg.accounts) {
      this.states.set(account.id, {
        requests: 0,
        tokens: 0,
        failures: 0,
        health: account.enabled === false ? 'disabled' : 'healthy',
      });
    }
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
          const started = Date.now();
          const result = await candidate.adapter.generate(candidate.account, request, candidate.model, credential, requestId);
          this.markSuccess(candidate.account.id, result.usage.totalTokens ?? 0);
          await this.usage.record({ requestId, provider: candidate.account.provider, accountId: candidate.account.id, model: result.model, latencyMs: Date.now() - started, success: true, usage: result.usage });
          return result;
        } catch (error) {
          const normalized = normalizeError(error);
          lastError = normalized;
          this.markFailure(candidate.account.id, normalized);
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
      const candidate = candidates[0];
      if (!candidate) throw new GatewayError('ProviderUnavailableError', 'No eligible provider/account/model is available');
      const credential = await self.credentialStore.get(candidate.account.credentialRef);
      const requestId = randomUUID();
      try {
        for await (const chunk of candidate.adapter.stream(candidate.account, request, candidate.model, credential, requestId)) yield chunk;
        self.markSuccess(candidate.account.id, 0);
      } catch (error) {
        self.markFailure(candidate.account.id, normalizeError(error));
        throw error;
      }
    })();
  }

  private async selectCandidates(request: GenerateRequest): Promise<Candidate[]> {
    const required: Capability[] = request.options?.capabilities ?? ['chat'];
    const providerOrder = this.cfg.fallbackProviders ?? [...this.adapters.keys()];
    const result: Candidate[] = [];

    for (const provider of providerOrder) {
      const adapter = this.adapters.get(provider);
      if (!adapter) continue;
      for (const account of this.cfg.accounts.filter((item) => item.provider === provider)) {
        const state = this.states.get(account.id);
        if (!state || account.enabled === false || state.health === 'disabled') continue;
        if ((state.cooldownUntil ?? 0) > Date.now()) continue;
        if (!required.every((capability) => account.capabilities.includes(capability))) continue;
        const models = request.options?.model ? account.models.filter((model) => model === request.options?.model) : account.models;
        if (!models.length) continue;
        const credential = await this.credentialStore.get(account.credentialRef);
        const discovered = await adapter.discoverModels(account, credential);
        for (const model of discovered) {
          if (!models.includes(model.id)) continue;
          if (!required.every((capability) => model.capabilities.includes(capability))) continue;
          result.push({ account, state, adapter, model, score: this.score(account, state) });
        }
      }
    }
    return result.sort((a, b) => b.score - a.score);
  }

  private score(account: AccountConfig, state: AccountState): number {
    switch (this.cfg.strategy ?? 'priority') {
      case 'lowest_utilization': return -(state.requests + state.tokens / 1000);
      case 'least_recently_used': return -(state.lastUsedAt ?? 0);
      case 'fastest': return account.priority ?? 0;
      case 'cheapest': return -((account.costPerMillionInput ?? 0) + (account.costPerMillionOutput ?? 0));
      case 'round_robin': {
        const accounts = this.cfg.accounts.filter((item) => item.provider === account.provider);
        const cursor = this.roundRobinCursor.get(account.provider) ?? 0;
        const index = accounts.findIndex((item) => item.id === account.id);
        return -((index - cursor + accounts.length) % Math.max(1, accounts.length));
      }
      default: return account.priority ?? 0;
    }
  }

  private markSuccess(id: string, tokens: number): void {
    const state = this.states.get(id);
    if (!state) return;
    const now = Date.now();
    state.requests += 1;
    state.tokens += tokens;
    state.lastUsedAt = now;
    state.lastSuccessAt = now;
    state.failures = 0;
    state.cooldownUntil = undefined;
    state.health = 'healthy';
  }

  private markFailure(id: string, error: GatewayError): void {
    const state = this.states.get(id);
    if (!state) return;
    state.lastFailureAt = Date.now();
    state.failures += 1;
    state.health = error.category === 'RateLimitError' ? 'rate_limited' : error.category === 'AuthenticationError' ? 'authentication_failure' : 'degraded';
    state.cooldownUntil = Date.now() + (error.retryAfterMs ?? this.config.cooldownMs);
  }

  private async backoff(attempt: number, retryAfterMs?: number): Promise<void> {
    const delay = retryAfterMs ?? Math.min(10_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
