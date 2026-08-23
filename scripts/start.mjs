import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code !== 'ENOENT') throw error;
}

const children = [
  spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['scripts/swagger-server.mjs'], { stdio: 'inherit', env: process.env }),
];

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      shutdown('SIGTERM');
      process.exitCode = code ?? 1;
    }
    if (children.every((item) => item.exitCode !== null || item.signalCode !== null)) {
      process.exit(process.exitCode ?? 0);
    }
  });
}
