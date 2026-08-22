import type { AccountState } from './domain.js';

export interface StateStore {
  get(accountId: string): Promise<AccountState | undefined>;
  set(accountId: string, state: AccountState): Promise<void>;
  update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState>;
  reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now?: number): Promise<boolean>;
}

const emptyState = (): AccountState => ({ requests: 0, tokens: 0, failures: 0, health: 'healthy' });

export class InMemoryStateStore implements StateStore {
  private readonly states = new Map<string, AccountState>();
  private readonly reservations = new Map<string, { minuteStartedAt: number; dayStartedAt: number; minuteRequests: number; dayRequests: number; minuteTokens: number; dayTokens: number }>();
  private readonly locks = new Map<string, Promise<void>>();

  async get(accountId: string): Promise<AccountState | undefined> {
    const state = this.states.get(accountId);
    return state ? { ...state } : undefined;
  }

  async set(accountId: string, state: AccountState): Promise<void> {
    this.states.set(accountId, { ...state });
  }

  async update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState> {
    return this.withLock(accountId, async () => {
      const next = updater(this.states.get(accountId));
      this.states.set(accountId, { ...next });
      return { ...next };
    });
  }

  async reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now = Date.now()): Promise<boolean> {
    return this.withLock(accountId, async () => {
      let bucket = this.reservations.get(accountId);
      if (!bucket) {
        bucket = { minuteStartedAt: now, dayStartedAt: now, minuteRequests: 0, dayRequests: 0, minuteTokens: 0, dayTokens: 0 };
        this.reservations.set(accountId, bucket);
      }
      if (now - bucket.minuteStartedAt >= 60_000) Object.assign(bucket, { minuteStartedAt: now, minuteRequests: 0, minuteTokens: 0 });
      if (now - bucket.dayStartedAt >= 86_400_000) Object.assign(bucket, { dayStartedAt: now, dayRequests: 0, dayTokens: 0 });
      if (limits.rpm !== undefined && bucket.minuteRequests + 1 > limits.rpm) return false;
      if (limits.rpd !== undefined && bucket.dayRequests + 1 > limits.rpd) return false;
      if (limits.tpm !== undefined && bucket.minuteTokens + tokens > limits.tpm) return false;
      if (limits.tpd !== undefined && bucket.dayTokens + tokens > limits.tpd) return false;
      bucket.minuteRequests += 1;
      bucket.dayRequests += 1;
      bucket.minuteTokens += tokens;
      bucket.dayTokens += tokens;
      const state = this.states.get(accountId) ?? emptyState();
      state.requests += 1;
      state.tokens += tokens;
      state.lastUsedAt = now;
      this.states.set(accountId, { ...state });
      return true;
    });
  }

  private async withLock<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(accountId, current);
    await previous;
    try { return await operation(); } finally { release(); if (this.locks.get(accountId) === current) this.locks.delete(accountId); }
  }
}

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisStateStore {
  constructor(private readonly redis: RedisLikeClient, private readonly prefix = 'llm-gateway') {}

  async get(accountId: string): Promise<AccountState | undefined> {
    const raw = await this.redis.get(`${this.prefix}:state:${accountId}`);
    return raw ? JSON.parse(raw) as AccountState : undefined;
  }

  async set(accountId: string, state: AccountState): Promise<void> {
    await this.redis.set(`${this.prefix}:state:${accountId}`, JSON.stringify(state));
  }

  async update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState> {
    const current = await this.get(accountId);
    const next = updater(current);
    await this.set(accountId, next);
    return next;
  }

  async reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now = Date.now()): Promise<boolean> {
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const requestKey = `${this.prefix}:quota:${accountId}:m:${minute}:requests`;
    const tokenKey = `${this.prefix}:quota:${accountId}:m:${minute}:tokens`;
    const dayRequestKey = `${this.prefix}:quota:${accountId}:d:${day}:requests`;
    const dayTokenKey = `${this.prefix}:quota:${accountId}:d:${day}:tokens`;
    const current = await Promise.all([requestKey, tokenKey, dayRequestKey, dayTokenKey].map((key) => this.redis.get(key)));
    const requests = Number(current[0] ?? 0);
    const minuteTokens = Number(current[1] ?? 0);
    const dayRequests = Number(current[2] ?? 0);
    const dayTokens = Number(current[3] ?? 0);
    if (limits.rpm !== undefined && requests + 1 > limits.rpm) return false;
    if (limits.tpm !== undefined && minuteTokens + tokens > limits.tpm) return false;
    if (limits.rpd !== undefined && dayRequests + 1 > limits.rpd) return false;
    if (limits.tpd !== undefined && dayTokens + tokens > limits.tpd) return false;
    await this.redis.incr(requestKey); await this.redis.incr(dayRequestKey);
    if (tokens) { for (let i = 0; i < tokens; i += 1) await this.redis.incr(tokenKey); for (let i = 0; i < tokens; i += 1) await this.redis.incr(dayTokenKey); }
    await Promise.all([this.redis.expire(requestKey, 61), this.redis.expire(tokenKey, 61), this.redis.expire(dayRequestKey, 86_401), this.redis.expire(dayTokenKey, 86_401)]);
    return true;
  }
}
