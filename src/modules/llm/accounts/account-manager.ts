import type { AccountConfig, AccountHealth, AccountState, ProviderName } from '../../../domain.js';
import { flattenAccounts, loadConfigFromEnvironment, type GatewayConfigFile } from '../../../config.js';

export interface AccountSnapshot { account: AccountConfig; state: AccountState; }

/** Dynamic account discovery and lightweight account-pool operations. */
export class LLMAccountManager {
  private readonly accounts: AccountConfig[];
  private readonly states = new Map<string, AccountState>();
  private cursor = new Map<ProviderName, number>();

  constructor(config: GatewayConfigFile = loadConfigFromEnvironment()) {
    this.accounts = flattenAccounts(config);
    for (const account of this.accounts) this.states.set(account.id, { requests: 0, tokens: 0, failures: 0, health: account.enabled === false ? 'disabled' : 'healthy' });
  }

  all(): AccountConfig[] { return [...this.accounts]; }
  forProvider(provider: ProviderName): AccountConfig[] { return this.accounts.filter((account) => account.provider === provider); }
  state(accountId: string): AccountState | undefined { const value = this.states.get(accountId); return value ? { ...value } : undefined; }
  snapshot(): AccountSnapshot[] { return this.accounts.map((account) => ({ account, state: this.state(account.id)! })); }

  next(provider: ProviderName): AccountConfig | undefined {
    const accounts = this.forProvider(provider).filter((account) => account.enabled !== false && this.available(account.id));
    if (!accounts.length) return undefined;
    const index = (this.cursor.get(provider) ?? 0) % accounts.length;
    this.cursor.set(provider, index + 1);
    return accounts[index];
  }

  markSuccess(accountId: string, tokens = 0): void {
    this.update(accountId, (state) => ({ ...state, requests: state.requests + 1, tokens: state.tokens + Math.max(0, tokens), failures: 0, cooldownUntil: undefined, lastUsedAt: Date.now(), lastSuccessAt: Date.now(), health: 'healthy' }));
  }

  markFailure(accountId: string, health: AccountHealth = 'degraded', cooldownMs = 30_000): void {
    const now = Date.now();
    this.update(accountId, (state) => ({ ...state, failures: state.failures + 1, lastFailureAt: now, cooldownUntil: now + Math.max(0, cooldownMs), health }));
  }

  available(accountId: string): boolean {
    const state = this.states.get(accountId);
    return !!state && state.health !== 'disabled' && state.health !== 'authentication_failure' && (state.cooldownUntil ?? 0) <= Date.now();
  }

  private update(accountId: string, updater: (state: AccountState) => AccountState): void {
    const current = this.states.get(accountId);
    if (current) this.states.set(accountId, updater(current));
  }
}

export function createLLMAccountManager(env: NodeJS.ProcessEnv = process.env): LLMAccountManager {
  return new LLMAccountManager(loadConfigFromEnvironment(env));
}
