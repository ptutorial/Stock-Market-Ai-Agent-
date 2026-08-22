import { spawn } from 'node:child_process';
const rounds = Number(process.env.SUSTAINED_ROUNDS ?? 10);
const requests = Number(process.env.SUSTAINED_REQUESTS ?? 1000);
const concurrency = Number(process.env.SUSTAINED_CONCURRENCY ?? 50);
const maxP95 = Number(process.env.SUSTAINED_MAX_P95_MS ?? 250);
const results = [];
for (let round = 1; round <= rounds; round += 1) {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/load-test.mjs'], { env: { ...process.env, LOAD_REQUESTS: String(requests), LOAD_CONCURRENCY: String(concurrency), LOAD_MAX_P95_MS: String(maxP95), }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; child.stdout.on('data', (b) => { out += b; process.stdout.write(b); }); child.stderr.on('data', (b) => { err += b; process.stderr.write(b); }); child.on('close', (code) => resolve({ code, out, err }));
  });
  if (result.code !== 0) process.exitCode = 1;
  try { results.push(JSON.parse(result.out)); } catch { results.push({ round, failedToParse: true }); }
}
const valid = results.filter((r) => Number.isFinite(r.p95Ms));
const averageP95 = valid.length ? valid.reduce((sum, r) => sum + r.p95Ms, 0) / valid.length : Infinity;
console.log(JSON.stringify({ rounds, requestsPerRound: requests, concurrency, averageP95Ms: Number(averageP95.toFixed(2)), results }, null, 2));
if (!valid.length || averageP95 > maxP95) process.exitCode = 1;
