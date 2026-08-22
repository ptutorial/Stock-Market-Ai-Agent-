import type { AccountState } from './domain.js';
import type { StateStore, RedisLikeClient } from './state.js';

export interface RedisAtomicClient extends RedisLikeClient {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
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
    const current = await this.get(accountId);
    const next = updater(current);
    await this.set(accountId, next);
    return next;
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
local mr = redis.call('GET', KEYS[1]) or 0
local mt = redis.call('GET', KEYS[2]) or 0
local dr = redis.call('GET', KEYS[3]) or 0
local dt = redis.call('GET', KEYS[4]) or 0
local rpm = tonumber(ARGV[1]); local rpd = tonumber(ARGV[2]); local tpm = tonumber(ARGV[3]); local tpd = tonumber(ARGV[4]); local tokens = tonumber(ARGV[5])
if rpm >= 0 and tonumber(mr) + 1 > rpm then return 0 end
if rpd >= 0 and tonumber(dr) + 1 > rpd then return 0 end
if tpm >= 0 and tonumber(mt) + tokens > tpm then return 0 end
if tpd >= 0 and tonumber(dt) + tokens > tpd then return 0 end
redis.call('INCRBY', KEYS[1], 1)
redis.call('INCRBY', KEYS[2], tokens)
redis.call('INCRBY', KEYS[3], 1)
redis.call('INCRBY', KEYS[4], tokens)
redis.call('EXPIRE', KEYS[1], 61)
redis.call('EXPIRE', KEYS[2], 61)
redis.call('EXPIRE', KEYS[3], 86401)
redis.call('EXPIRE', KEYS[4], 86401)
return 1`;
    const value = await this.redis.eval(script, keys.length, ...keys, String(limits.rpm ?? -1), String(limits.rpd ?? -1), String(limits.tpm ?? -1), String(limits.tpd ?? -1), String(tokens));
    return Number(value) === 1;
  }
}
