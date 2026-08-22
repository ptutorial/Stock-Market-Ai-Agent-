import { createClient } from 'redis';
import { AtomicRedisStateStore } from '../dist/redis.js';
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const prefix = `failure-cert:${process.pid}:${Date.now()}`;
const client = createClient({ url }); client.on('error', () => {}); await client.connect();
const store = new AtomicRedisStateStore(client, prefix); const account = `recovery-${Date.now()}`;
const before = await store.reserve(account, 1, { rpm: 2, rpd: 100, tpm: 100, tpd: 100 });
client.disconnect();
let disconnectedOperationFailed = false;
try { await store.reserve(account, 1, { rpm: 2, rpd: 100, tpm: 100, tpd: 100 }); } catch { disconnectedOperationFailed = true; }
await client.connect();
const recovered = await store.reserve(account, 1, { rpm: 2, rpd: 100, tpm: 100, tpd: 100 });
const quota = await store.getQuotaUsage(account);
console.log(JSON.stringify({ firstReservation: before, disconnectedOperationFailed, recoveredReservation: recovered, quota }, null, 2));
await client.quit();
if (before !== true || !disconnectedOperationFailed || recovered !== true || quota.minuteRequests !== 2) process.exitCode = 1;
