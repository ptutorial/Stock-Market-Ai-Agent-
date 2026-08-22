import { createClient } from 'redis';
import { AtomicRedisStateStore } from '../dist/redis.js';
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const prefix = `failure-cert:${process.pid}:${Date.now()}`;
const client = createClient({ url }); client.on('error', () => {}); await client.connect();
const store = new AtomicRedisStateStore(client, prefix); const account = `recovery-${Date.now()}`;
const before = await store.reserve(account, 1, { rpm: 1, rpd: 100, tpm: 100, tpd: 100 });
const exhausted = await store.reserve(account, 1, { rpm: 1, rpd: 100, tpm: 100, tpd: 100 });
const unavailable = createClient({ url: process.env.REDIS_BAD_URL ?? 'redis://127.0.0.1:63999' });
let unavailableFailed = false;
try { await unavailable.connect(); } catch { unavailableFailed = true; }
if (unavailable.isOpen) await unavailable.quit();
const report = { firstReservation: before, secondReservation: exhausted, redisFailureDetected: unavailableFailed };
console.log(JSON.stringify(report, null, 2));
await client.quit();
if (before !== true || exhausted !== false || !unavailableFailed) process.exitCode = 1;
