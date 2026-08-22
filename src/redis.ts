import { randomUUID } from 'node:crypto';
import type { AccountState } from './domain.js';
import type { QuotaUsage, StateStore, RedisLikeClient } from './state.js';

export interface RedisAtomicClient extends RedisLikeClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export class AtomicRedisStateStore implements StateStore {
  constructor(private readonly redis: RedisAtomicClient, private readonly prefix = 'llm-gateway') {}

  async get(accountId: string): Promise<AccountState | undefined> {
    const raw = await this.redis.get(`${this.prefix}:state:${accountId}`);
    return raw ? JSON.parse(raw) as AccountState : undefined;
  }

  async set(accountId: string, state: AccountState): Promise<void> {
    await this.redis.set(`${this.prefix}:state:${accountId}`, JSON.stringify(state));
  }

  async update(accountId: string, updater: (current: AccountState | undefined) => AccountState): Promise<AccountState> {
    const lockKey = `${this.prefix}:lock:${accountId}`;
    const token = randomUUID();
    const acquireDeadline = Date.now() + 5_000;
    let acquired = false;
    while (Date.now() < acquireDeadline) {
      const result = await this.redis.set(lockKey, token, 'NX', 'PX', 10_000);
      if (result === 'OK') { acquired = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 25)));
    }
    if (!acquired || await this.redis.get(lockKey) !== token) throw new Error(`Timed out acquiring state lock for account ${accountId}`);
    try {
      const current = await this.get(accountId);
      const next = updater(current);
      await this.set(accountId, next);
      return next;
    } finally {
      await this.redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", { keys: [lockKey], arguments: [token] });
    }
  }

  async reserve(accountId: string, tokens: number, limits: { rpm?: number; rpd?: number; tpm?: number; tpd?: number }, now = Date.now()): Promise<boolean> {
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const keys = [
      `${this.prefix}:quota:${accountId}:m:${minute}:requests`,
      `${this.prefix}:quota:${accountId}:m:${minute}:tokens`,
      `${this.prefix}:quota:${accountId}:d:${day}:requests`,
      `${this.prefix}:quota:${accountId}:d:${day}:tokens`,
    ];
    const script = `
local mr = tonumber(redis.call('GET', KEYS[1]) or '0')
local mt = tonumber(redis.call('GET', KEYS[2]) or '0')
local dr = tonumber(redis.call('GET', KEYS[3]) or '0')
local dt = tonumber(redis.call('GET', KEYS[4]) or '0')
local rpm = tonumber(ARGV[1]); local rpd = tonumber(ARGV[2]); local tpm = tonumber(ARGV[3]); local tpd = tonumber(ARGV[4]); local tokens = math.max(0, tonumber(ARGV[5]))
if rpm >= 0 and mr + 1 > rpm then return 0 end
if rpd >= 0 and dr + 1 > rpd then return 0 end
if tpm >= 0 and mt + tokens > tpm then return 0 end
if tpd >= 0 and dt + tokens > tpd then return 0 end
redis.call('INCRBY', KEYS[1], 1)
if tokens > 0 then redis.call('INCRBY', KEYS[2], tokens) end
redis.call('INCRBY', KEYS[3], 1)
if tokens > 0 then redis.call('INCRBY', KEYS[4], tokens) end
redis.call('EXPIRE', KEYS[1], 61)
redis.call('EXPIRE', KEYS[2], 61)
redis.call('EXPIRE', KEYS[3], 86401)
redis.call('EXPIRE', KEYS[4], 86401)
return 1`;
    const value = await this.redis.eval(script, { keys, arguments: [String(limits.rpm ?? -1), String(limits.rpd ?? -1), String(limits.tpm ?? -1), String(limits.tpd ?? -1), String(Math.max(0, Math.floor(tokens)))] });
    return Number(value) === 1;
  }

  async getQuotaUsage(accountId: string, now = Date.now()): Promise<QuotaUsage> {
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const keys = [
      `${this.prefix}:quota:${accountId}:m:${minute}:requests`,
      `${this.prefix}:quota:${accountId}:m:${minute}:tokens`,
      `${this.prefix}:quota:${accountId}:d:${day}:requests`,
      `${this.prefix}:quota:${accountId}:d:${day}:tokens`,
    ];
    const values = await Promise.all(keys.map((key) => this.redis.get(key)));
    return {
      minuteRequests: Number(values[0] ?? 0),
      minuteTokens: Number(values[1] ?? 0),
      dayRequests: Number(values[2] ?? 0),
      dayTokens: Number(values[3] ?? 0),
    };
  }
}
