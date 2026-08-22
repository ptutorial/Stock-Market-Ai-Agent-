import { randomUUID } from 'node:crypto';
import type { AccountState } from './domain.js';

export interface QuotaUsage {
  minuteRequests: number;
  dayRequests: number;
  minuteTokens: number;
  dayTokens: number;
}

export interface StateStore {
  get(accountId: string): Promise<AccountState | undefined>;
  set(accountId: string, state: AccountState): Promise<void>;
  update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState>;
  reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now?: number): Promise<boolean>;
  getQuotaUsage?(accountId: string, now?: number): Promise<QuotaUsage>;
}

const emptyState = (): AccountState => ({ requests: 0, tokens: 0, failures: 0, health: 'healthy' });

export class InMemoryStateStore implements StateStore {
  private readonly states = new Map<string, AccountState>();
  private readonly reservations = new Map<string, { minuteStartedAt: number; dayStartedAt: number; minuteRequests: number; dayRequests: number; minuteTokens: number; dayTokens: number }>();
  private readonly locks = new Map<string, Promise<void>>();

  async get(accountId: string): Promise<AccountState | undefined> {
    const state = this.states.get(accountId);
    return state ? { ...state, metadata: state.metadata ? { ...state.metadata } : undefined } : undefined;
  }

  async set(accountId: string, state: AccountState): Promise<void> {
    this.states.set(accountId, { ...state, metadata: state.metadata ? { ...state.metadata } : undefined });
  }

  async update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState> {
    return this.withLock(accountId, async () => {
      const current = this.states.get(accountId);
      const next = updater(current ? { ...current, metadata: current.metadata ? { ...current.metadata } : undefined } : undefined);
      this.states.set(accountId, { ...next, metadata: next.metadata ? { ...next.metadata } : undefined });
      return { ...next, metadata: next.metadata ? { ...next.metadata } : undefined };
    });
  }

  async reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now = Date.now()): Promise<boolean> {
    return this.withLock(accountId, async () => {
      let bucket = this.reservations.get(accountId);
      if (!bucket) {
        bucket = { minuteStartedAt: now, dayStartedAt: now, minuteRequests: 0, dayRequests: 0, minuteTokens: 0, dayTokens: 0 };
        this.reservations.set(accountId, bucket);
      }
      this.resetExpiredBuckets(bucket, now);
      const requestedTokens = Math.max(0, Math.floor(tokens));
      if (limits.rpm !== undefined && bucket.minuteRequests + 1 > limits.rpm) return false;
      if (limits.rpd !== undefined && bucket.dayRequests + 1 > limits.rpd) return false;
      if (limits.tpm !== undefined && bucket.minuteTokens + requestedTokens > limits.tpm) return false;
      if (limits.tpd !== undefined && bucket.dayTokens + requestedTokens > limits.tpd) return false;
      bucket.minuteRequests += 1;
      bucket.dayRequests += 1;
      bucket.minuteTokens += requestedTokens;
      bucket.dayTokens += requestedTokens;
      return true;
    });
  }

  async getQuotaUsage(accountId: string, now = Date.now()): Promise<QuotaUsage> {
    return this.withLock(accountId, async () => {
      const bucket = this.reservations.get(accountId);
      if (!bucket) return { minuteRequests: 0, dayRequests: 0, minuteTokens: 0, dayTokens: 0 };
      this.resetExpiredBuckets(bucket, now);
      return { minuteRequests: bucket.minuteRequests, dayRequests: bucket.dayRequests, minuteTokens: bucket.minuteTokens, dayTokens: bucket.dayTokens };
    });
  }

  private resetExpiredBuckets(bucket: { minuteStartedAt: number; dayStartedAt: number; minuteRequests: number; dayRequests: number; minuteTokens: number; dayTokens: number }, now: number): void {
    if (now - bucket.minuteStartedAt >= 60_000) Object.assign(bucket, { minuteStartedAt: now, minuteRequests: 0, minuteTokens: 0 });
    if (now - bucket.dayStartedAt >= 86_400_000) Object.assign(bucket, { dayStartedAt: now, dayRequests: 0, dayTokens: 0 });
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
  del?: (key: string) => Promise<number>;
  eval?: (script: string, ...args: unknown[]) => Promise<unknown>;
}

const RESERVE_SCRIPT = `
local minuteRequests = tonumber(redis.call('GET', KEYS[1]) or '0')
local minuteTokens = tonumber(redis.call('GET', KEYS[2]) or '0')
local dayRequests = tonumber(redis.call('GET', KEYS[3]) or '0')
local dayTokens = tonumber(redis.call('GET', KEYS[4]) or '0')
local addTokens = tonumber(ARGV[1])
local rpm = tonumber(ARGV[2]); local rpd = tonumber(ARGV[3]); local tpm = tonumber(ARGV[4]); local tpd = tonumber(ARGV[5])
if rpm >= 0 and minuteRequests + 1 > rpm then return 0 end
if rpd >= 0 and dayRequests + 1 > rpd then return 0 end
if tpm >= 0 and minuteTokens + addTokens > tpm then return 0 end
if tpd >= 0 and dayTokens + addTokens > tpd then return 0 end
redis.call('INCRBY', KEYS[1], 1)
redis.call('INCRBY', KEYS[3], 1)
if addTokens > 0 then redis.call('INCRBY', KEYS[2], addTokens); redis.call('INCRBY', KEYS[4], addTokens) end
redis.call('EXPIRE', KEYS[1], 61); redis.call('EXPIRE', KEYS[2], 61); redis.call('EXPIRE', KEYS[3], 86401); redis.call('EXPIRE', KEYS[4], 86401)
return 1
`;

export class RedisStateStore implements StateStore {
  constructor(private readonly redis: RedisLikeClient, private readonly prefix = 'llm-gateway') {}

  async get(accountId: string): Promise<AccountState | undefined> {
    const raw = await this.redis.get(`${this.prefix}:state:${accountId}`);
    return raw ? JSON.parse(raw) as AccountState : undefined;
  }

  async set(accountId: string, state: AccountState): Promise<void> {
    await this.redis.set(`${this.prefix}:state:${accountId}`, JSON.stringify(state));
  }

  async update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState> {
    if (!this.redis.eval) throw new Error('Redis client must support EVAL for atomic state updates');
    const current = await this.get(accountId);
    const next = updater(current);
    await this.set(accountId, next);
    return next;
  }

  async reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now = Date.now()): Promise<boolean> {
    if (!this.redis.eval) throw new Error('Redis client must support EVAL for atomic quota reservation');
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const keys = [`${this.prefix}:quota:${accountId}:m:${minute}:requests`, `${this.prefix}:quota:${accountId}:m:${minute}:tokens`, `${this.prefix}:quota:${accountId}:d:${day}:requests`, `${this.prefix}:quota:${accountId}:d:${day}:tokens`];
    const result = await this.redis.eval(RESERVE_SCRIPT, { keys, arguments: [String(Math.max(0, Math.floor(tokens))), String(limits.rpm ?? -1), String(limits.rpd ?? -1), String(limits.tpm ?? -1), String(limits.tpd ?? -1)] });
    return Number(result) === 1;
  }

  async getQuotaUsage(accountId: string, now = Date.now()): Promise<QuotaUsage> {
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const keys = [`${this.prefix}:quota:${accountId}:m:${minute}:requests`, `${this.prefix}:quota:${accountId}:m:${minute}:tokens`, `${this.prefix}:quota:${accountId}:d:${day}:requests`, `${this.prefix}:quota:${accountId}:d:${day}:tokens`];
    const values = await Promise.all(keys.map((key) => this.redis.get(key)));
    return { minuteRequests: Number(values[0] ?? 0), minuteTokens: Number(values[1] ?? 0), dayRequests: Number(values[2] ?? 0), dayTokens: Number(values[3] ?? 0) };
  }
}
