import { createClient } from 'redis';
import { AtomicRedisStateStore } from '../dist/redis.js';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const total = Number(process.env.REDIS_LOAD_REQUESTS ?? 100);
const rpm = Number(process.env.REDIS_LOAD_RPM ?? 25);
const prefix = `cert:${process.pid}:${Date.now()}`;
const client = createClient({ url });
client.on('error', () => {});
await client.connect();
const store = new AtomicRedisStateStore(client, prefix);
const account = `quota-${Date.now()}`;
const results = await Promise.all(Array.from({ length: total }, () => store.reserve(account, 1, { rpm, rpd: total + 1, tpm: total + 1, tpd: total + 1 })));
const accepted = results.filter(Boolean).length;
const quota = await store.getQuotaUsage(account);
console.log(JSON.stringify({ total, rpm, accepted, rejected: total - accepted, quota }, null, 2));
await client.del(`${prefix}:quota:${account}:m:${Math.floor(Date.now() / 60000)}:requests`, `${prefix}:quota:${account}:m:${Math.floor(Date.now() / 60000)}:tokens`, `${prefix}:quota:${account}:d:${Math.floor(Date.now() / 86400000)}:requests`, `${prefix}:quota:${account}:d:${Math.floor(Date.now() / 86400000)}:tokens`);
await client.quit();
if (accepted !== rpm || quota.minuteRequests !== rpm) process.exitCode = 1;
