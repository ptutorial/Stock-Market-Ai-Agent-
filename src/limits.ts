import type { AccountConfig, AccountState } from './domain.js';

export interface RateLimitSnapshot {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  resetAt?: number;
}

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfterMs?: number;
}

export interface UsageWindow {
  requests: number;
  tokens: number;
  windowStartedAt: number;
}

export class RateLimitTracker {
  private readonly windows = new Map<string, { minute: UsageWindow; day: UsageWindow }>();
  private readonly cooldowns = new Map<string, number>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) { this.clock = clock; }

  canAccept(account: AccountConfig, state: AccountState, tokens = 0): boolean {
    if (account.enabled === false || state.health === 'disabled') return false;
    const now = this.clock();
    if (state.cooldownUntil && state.cooldownUntil > now) return false;
    const window = this.getWindows(account.id, now);
    const limits = account.limits ?? {};
    if (limits.rpm !== undefined && window.minute.requests >= limits.rpm) return false;
    if (limits.rpd !== undefined && window.day.requests >= limits.rpd) return false;
    if (limits.tpm !== undefined && window.minute.tokens + tokens > limits.tpm) return false;
    if (limits.tpd !== undefined && window.day.tokens + tokens > limits.tpd) return false;
    return true;
  }

  record(accountId: string, tokens = 0): void {
    const now = this.clock();
    const window = this.getWindows(accountId, now);
    window.minute.requests += 1;
    window.minute.tokens += tokens;
    window.day.requests += 1;
    window.day.tokens += tokens;
  }

  applyRetryAfter(accountId: string, retryAfterMs: number): number {
    const until = this.clock() + Math.max(0, retryAfterMs);
    this.cooldowns.set(accountId, until);
    return until;
  }

  cooldownUntil(accountId: string): number | undefined {
    const until = this.cooldowns.get(accountId);
    if (until && until <= this.clock()) { this.cooldowns.delete(accountId); return undefined; }
    return until;
  }

  parseHeaders(headers: Headers): RateLimitHeaders {
    const number = (name: string) => { const value = headers.get(name); return value === null ? undefined : Number(value); };
    const retry = headers.get('retry-after');
    const reset = number('x-ratelimit-reset');
    const resetAt = reset === undefined ? undefined : (reset < 10_000_000_000 ? reset * 1000 : reset);
    return {
      limit: number('x-ratelimit-limit') ?? number('x-ratelimit-limit-requests'),
      remaining: number('x-ratelimit-remaining') ?? number('x-ratelimit-remaining-requests'),
      resetAt,
      retryAfterMs: retry === null ? undefined : (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - this.clock())),
    };
  }

  private getWindows(accountId: string, now: number) {
    let entry = this.windows.get(accountId);
    if (!entry) {
      entry = { minute: { requests: 0, tokens: 0, windowStartedAt: now }, day: { requests: 0, tokens: 0, windowStartedAt: now } };
      this.windows.set(accountId, entry);
    }
    if (now - entry.minute.windowStartedAt >= 60_000) entry.minute = { requests: 0, tokens: 0, windowStartedAt: now };
    if (now - entry.day.windowStartedAt >= 86_400_000) entry.day = { requests: 0, tokens: 0, windowStartedAt: now };
    return entry;
  }
}

export function mergeRateLimitState(state: AccountState, tracker: RateLimitTracker, accountId: string): AccountState {
  const cooldownUntil = tracker.cooldownUntil(accountId);
  return cooldownUntil ? { ...state, cooldownUntil, health: 'rate_limited' } : state;
}
