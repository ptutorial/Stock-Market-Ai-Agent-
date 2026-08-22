import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const checks = [
  ['E1', 'Synthetic gateway load', 'npm', ['run', 'load:test']],
  ['E2', 'Redis atomic quota concurrency', 'npm', ['run', 'load:redis']],
  ['E3', 'Multi-instance shared quota', 'npm', ['run', 'load:multi']],
  ['E4', 'Sustained load', 'npm', ['run', 'load:sustained']],
  ['E5', 'Account fairness', 'npm', ['run', 'load:fairness']],
  ['E6', 'Failure/recovery under load', 'npm', ['run', 'load:failure']],
];

const successCriteria = {
  E1: 'all requests complete; provider/state counts match; p95 within threshold',
  E2: 'accepted reservations never exceed RPM; Redis counters match accepted reservations',
  E3: 'all instances share one quota and combined accepted reservations never exceed RPM',
  E4: 'all rounds complete and average p95 remains within threshold',
  E5: 'round-robin accounts remain within floor/ceiling distribution',
  E6: 'Redis failure fails closed and reconnection restores reservation capability',
  E7: 'all E1-E6 outputs are green and attached to the release record',
};

function runCheck(command, args) {
  const started = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        durationMs: Number((performance.now() - started).toFixed(2)),
        stdout,
        stderr: `${stderr}${error.message}\n`,
      });
    });

    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        durationMs: Number((performance.now() - started).toFixed(2)),
        stdout,
        stderr,
      });
    });
  });
}

function parseJsonEvidence(output) {
  const values = [];
  const stack = [];
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (stack.length === 0) start = index;
      stack.push(char);
      continue;
    }

    if ((char === '}' && stack.at(-1) === '{') || (char === ']' && stack.at(-1) === '[')) {
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        const candidate = output.slice(start, index + 1);
        try {
          values.push(JSON.parse(candidate));
        } catch {
          // Ignore non-JSON brace-delimited output.
        }
        start = -1;
      }
    }
  }

  return values.length === 0 ? null : values.at(-1);
}

const startedAt = new Date();
const checkStatuses = {};
const results = {};

for (const [id, name, command, args] of checks) {
  console.log(`\n[${id}] ${name}: ${command} ${args.join(' ')}`);
  const result = await runCheck(command, args);
  const status = result.exitCode === 0 ? 'PASS' : 'FAIL';
  checkStatuses[id] = status;
  results[id] = {
    name,
    command: [command, ...args].join(' '),
    status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    evidence: parseJsonEvidence(result.stdout),
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  console.log(`[${id}] ${status} (${result.durationMs}ms)`);
}

const status = Object.values(checkStatuses).every((checkStatus) => checkStatus === 'PASS') ? 'PASS' : 'FAIL';
const report = {
  phase: 'Batch E',
  status,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  checks: checkStatuses,
  results,
  successCriteria,
};

await mkdir('artifacts', { recursive: true });
const artifactPath = join('artifacts', 'batch-e-certification.json');
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nBatch E certification ${status}`);
console.log(`Report written to ${artifactPath}`);

if (status !== 'PASS') process.exitCode = 1;
