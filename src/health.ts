import type { AccountConfig, AccountHealth, AccountState, ProviderAdapter } from './domain.js';
import { normalizeError } from './errors.js';

export interface HealthPolicy {
  failureThreshold?: number;
  degradedThreshold?: number;
  cooldownMs?: number;
  recoverySuccesses?: number;
}

export interface HealthEvent {
  accountId: string;
  previous: AccountHealth;
  current: AccountHealth;
  timestamp: number;
  reason: string;
}

export class HealthMonitor {
  private readonly policies = new Map<string, HealthPolicy>();
  private readonly recovery = new Map<string, number>();
  private readonly events: HealthEvent[] = [];

  constructor(private readonly clock: () => number = Date.now) {}

  setPolicy(accountId: string, policy: HealthPolicy): void { this.policies.set(accountId, policy); }

  getEvents(): HealthEvent[] { return [...this.events]; }

  recordSuccess(accountId: string, state: AccountState): AccountState {
    const policy = this.policies.get(accountId) ?? {};
    const previous = state.health;
    const successes = (this.recovery.get(accountId) ?? 0) + 1;
    this.recovery.set(accountId, successes);
    const required = policy.recoverySuccesses ?? 1;
    const health: AccountHealth = previous === 'disabled' ? previous : successes >= required ? 'healthy' : 'degraded';
    const next = { ...state, health, failures: health === 'healthy' ? 0 : state.failures, lastSuccessAt: this.clock(), cooldownUntil: undefined };
    if (health !== previous) this.emit(accountId, previous, health, 'successful recovery');
    return next;
  }

  recordFailure(accountId: string, state: AccountState, rawError: unknown): AccountState {
    const error = normalizeError(rawError);
    const policy = this.policies.get(accountId) ?? {};
    const previous = state.health;
    const failures = state.failures + 1;
    this.recovery.set(accountId, 0);
    let health: AccountHealth = 'degraded';
    let cooldownUntil = state.cooldownUntil;
    if (error.category === 'AuthenticationError') health = 'authentication_failure';
    else if (error.category === 'RateLimitError') { health = 'rate_limited'; cooldownUntil = this.clock() + (error.retryAfterMs ?? policy.cooldownMs ?? 60_000); }
    else if (error.category === 'ProviderUnavailableError' || error.category === 'TimeoutError') { health = 'temporarily_unavailable'; cooldownUntil = this.clock() + (error.retryAfterMs ?? policy.cooldownMs ?? 30_000); }
    else if (failures >= (policy.failureThreshold ?? 3)) { health = 'temporarily_unavailable'; cooldownUntil = this.clock() + (policy.cooldownMs ?? 30_000); }
    else if (failures >= (policy.degradedThreshold ?? 1)) health = 'degraded';
    const next = { ...state, failures, health, lastFailureAt: this.clock(), cooldownUntil };
    if (health !== previous) this.emit(accountId, previous, health, error.message);
    return next;
  }

  isEligible(state: AccountState): boolean {
    if (state.health === 'disabled' || state.health === 'authentication_failure') return false;
    return !state.cooldownUntil || state.cooldownUntil <= this.clock();
  }

  async check(accountId: string, account: AccountConfig, adapter: ProviderAdapter, credential: string, state: AccountState): Promise<AccountState> {
    try {
      const ok = await adapter.healthCheck(account, credential);
      return ok ? this.recordSuccess(accountId, state) : this.recordFailure(accountId, state, new Error('Provider health check failed'));
    } catch (error) { return this.recordFailure(accountId, state, error); }
  }

  private emit(accountId: string, previous: AccountHealth, current: AccountHealth, reason: string): void {
    this.events.push({ accountId, previous, current, timestamp: this.clock(), reason });
  }
}
