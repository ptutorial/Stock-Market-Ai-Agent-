export type AccountStatus = 'healthy' | 'cooldown' | 'disabled';

export interface LLMAccount {
  id: string;
  provider: string;
  credential: string;
  status: AccountStatus;
  cooldownUntil?: number;
  consecutiveFailures: number;
  requests: number;
  successes: number;
  failures: number;
  lastUsedAt?: number;
}

export interface AccountPoolOptions {
  now?: () => number;
  cooldownMs?: number;
}

export class LLMAccountPool {
  private readonly accounts = new Map<string, LLMAccount>();
  private readonly cursor = new Map<string, number>();
  private readonly now: () => number;
  private readonly cooldownMs: number;

  constructor(options: AccountPoolOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  add(account: Omit<LLMAccount, 'status' | 'consecutiveFailures' | 'requests' | 'successes' | 'failures'>): void {
    this.accounts.set(account.id, { ...account, status: 'healthy', consecutiveFailures: 0, requests: 0, successes: 0, failures: 0 });
  }

  addFromEnvironment(provider: string, env: NodeJS.ProcessEnv = process.env): number {
    const prefix = `${provider.toUpperCase()}_API_KEY_`;
    let count = 0;
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith(prefix) || !value?.trim()) continue;
      const suffix = key.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      this.add({ id: `${provider}:${suffix}`, provider, credential: value.trim() });
      count++;
    }
    return count;
  }

  select(provider: string): LLMAccount | undefined {
    const now = this.now();
    const candidates = [...this.accounts.values()].filter((a) => a.provider === provider && a.status !== 'disabled' && (!a.cooldownUntil || a.cooldownUntil <= now));
    if (!candidates.length) return undefined;
    const index = this.cursor.get(provider) ?? 0;
    const account = candidates[index % candidates.length];
    this.cursor.set(provider, (index + 1) % candidates.length);
    account.status = 'healthy';
    account.lastUsedAt = now;
    account.requests++;
    return account;
  }

  success(id: string): void {
    const account = this.accounts.get(id); if (!account) return;
    account.successes++; account.consecutiveFailures = 0; account.status = 'healthy'; account.cooldownUntil = undefined;
  }

  failure(id: string, cooldownMs = this.cooldownMs): void {
    const account = this.accounts.get(id); if (!account) return;
    account.failures++; account.consecutiveFailures++; account.status = 'cooldown'; account.cooldownUntil = this.now() + cooldownMs;
  }

  disable(id: string): void { const account = this.accounts.get(id); if (account) account.status = 'disabled'; }
  enable(id: string): void { const account = this.accounts.get(id); if (account) { account.status = 'healthy'; account.cooldownUntil = undefined; } }
  get(id: string): LLMAccount | undefined { return this.accounts.get(id); }
  list(provider?: string): LLMAccount[] { return [...this.accounts.values()].filter((a) => !provider || a.provider === provider).map((a) => ({ ...a })); }
}
