import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code !== 'ENOENT') throw error;
}

const child = spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit', env: process.env });
let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill(signal);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

child.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal && !shuttingDown) {
    console.error(`Server exited due to ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
