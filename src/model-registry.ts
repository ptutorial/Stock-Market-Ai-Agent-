import type { AccountConfig, Capability, ModelInfo, ProviderAdapter } from './domain.js';

export interface ModelRegistryOptions {
  ttlMs?: number;
}

interface CacheEntry {
  expiresAt: number;
  models: ModelInfo[];
}

export class ModelRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(options: ModelRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  async discover(
    account: AccountConfig,
    adapter: ProviderAdapter,
    credential: string,
    forceRefresh = false,
  ): Promise<ModelInfo[]> {
    const cached = this.cache.get(account.id);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.models;

    const models = await adapter.discoverModels(account, credential);
    const normalized = models.map((model) => this.normalize(model, account));
    this.cache.set(account.id, { models: normalized, expiresAt: Date.now() + this.ttlMs });
    return normalized;
  }

  invalidate(accountId?: string): void {
    if (accountId) this.cache.delete(accountId);
    else this.cache.clear();
  }

  get(accountId: string): ModelInfo[] | undefined {
    const entry = this.cache.get(accountId);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.models;
  }

  private normalize(model: ModelInfo, account: AccountConfig): ModelInfo {
    const capabilities: Capability[] = [...new Set(
      model.capabilities.filter((capability) => account.capabilities.includes(capability)),
    )];
    return {
      ...model,
      provider: account.provider,
      capabilities,
      available: model.available !== false,
      metadata: { ...model.metadata, accountId: account.id },
    };
  }
}
