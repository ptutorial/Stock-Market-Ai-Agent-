import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createClient } from 'redis';
import { createGatewayHttpHandler, type GatewayHttpServerOptions } from './http.js';
import { flattenAccounts, loadConfigFromEnvironment } from './config.js';
import { GeminiAdapter } from './providers/gemini.js';
import { CloudflareWorkersAIAdapter } from './providers/cloudflare.js';
import { GroqAdapter, OpenRouterAdapter } from './providers/openai-compatible.js';
import { AtomicRedisStateStore } from './redis.js';
import type { RedisAtomicClient } from './redis.js';
import type { StateStore } from './state.js';
import { EnvironmentCredentialStore } from './gateway.js';
import { HealthMonitor } from './health.js';

function loadEnvironment(): void {
  try {
    loadEnvFile();
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }
}

export async function startServer(): Promise<void> {
  loadEnvironment();
  const port = Number(process.env.PORT ?? 3000);
  const apiKey = process.env.GATEWAY_API_KEY;
  if (!apiKey) throw new Error('GATEWAY_API_KEY is required to start the HTTP server');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${process.env.PORT}`);

  const config = loadConfigFromEnvironment();
  const adapters = [new GeminiAdapter(), new GroqAdapter(), new OpenRouterAdapter(), new CloudflareWorkersAIAdapter()];
  const accounts = flattenAccounts(config);
  const configuredProviders = new Set(accounts.map((account) => account.provider));
  const availableProviders = new Set(adapters.map((adapter) => adapter.name));
  for (const provider of configuredProviders) {
    if (!availableProviders.has(provider)) throw new Error(`No adapter is registered for configured provider: ${provider}`);
  }
  if (!accounts.length) throw new Error('No enabled gateway accounts are configured');

  let redisClient: ReturnType<typeof createClient> | undefined;
  let stateStore: StateStore;
  if (process.env.REDIS_URL) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (error: Error) => console.error('Redis client error', error));
    await redisClient.connect();
    stateStore = new AtomicRedisStateStore(redisClient as unknown as RedisAtomicClient);
  } else {
    const { InMemoryStateStore } = await import('./state.js');
    stateStore = new InMemoryStateStore();
  }

  const maxBodyBytes = Number(process.env.GATEWAY_REQUEST_BODY_LIMIT_BYTES ?? 1_048_576);
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('Invalid GATEWAY_REQUEST_BODY_LIMIT_BYTES');
  const healthIntervalMs = Number(process.env.GATEWAY_HEALTH_CHECK_INTERVAL_MS ?? 30_000);
  if (!Number.isInteger(healthIntervalMs) || healthIntervalMs < 5_000) throw new Error('Invalid GATEWAY_HEALTH_CHECK_INTERVAL_MS');
  const shutdownTimeoutMs = Number(process.env.GATEWAY_SHUTDOWN_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1_000 || shutdownTimeoutMs > 120_000) throw new Error('Invalid GATEWAY_SHUTDOWN_TIMEOUT_MS');

  const gatewayOptions: GatewayHttpServerOptions = { accounts, adapters, strategy: config.strategy, maxRetries: config.maxRetries, cooldownMs: config.cooldownMs, stateStore, apiKey, maxBodyBytes };
  const handler = createGatewayHttpHandler(gatewayOptions);
  const credentialStore = new EnvironmentCredentialStore();
  const healthMonitor = new HealthMonitor();
  const adapterMap = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let shuttingDown = false;

  const checkHealth = async () => {
    if (shuttingDown) return;
    await Promise.all(accounts.map(async (account) => {
      const adapter = adapterMap.get(account.provider);
      if (!adapter) return;
      const credential = await credentialStore.get(account.credentialRef).catch(() => undefined);
      if (!credential) return;
      const current = await stateStore.get(account.id) ?? { requests: 0, tokens: 0, failures: 0, health: 'healthy' as const };
      const checked = await healthMonitor.check(account.id, account, adapter, credential, current);
      await stateStore.update(account.id, (latest) => {
        const state = latest ?? current;
        return { ...state, health: checked.health, cooldownUntil: checked.cooldownUntil, lastSuccessAt: checked.lastSuccessAt ?? state.lastSuccessAt, lastFailureAt: checked.lastFailureAt ?? state.lastFailureAt, failures: checked.health === 'healthy' ? 0 : Math.max(state.failures, checked.failures) };
      });
    }));
  };

  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBodyBytes) {
          res.statusCode = 413;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'PayloadTooLarge' }));
          req.destroy();
          return;
        }
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'InvalidRequest' }));
        return;
      }
      const result = await handler({ method: req.method ?? 'GET', path: req.url ?? '/', body, headers: { authorization: req.headers.authorization, 'x-request-id': req.headers['x-request-id'] as string | undefined } });
      res.statusCode = result.status;
      for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
      res.end(JSON.stringify(result.body));
    } catch (error: unknown) {
      console.error('HTTP request error', error);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'InternalServerError' }));
    }
  });

  const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => { onTimeout(); reject(new Error('Shutdown timeout')); }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (healthTimer) clearInterval(healthTimer);
    console.log(`Received ${signal}; shutting down`);
    try {
      await withTimeout(new Promise<void>((resolve) => server.close(() => resolve())), shutdownTimeoutMs, () => {
        server.closeAllConnections();
      });
    } catch (error: unknown) {
      console.error('HTTP server shutdown timed out', error);
    }
    if (redisClient?.isOpen) {
      try {
        await withTimeout(redisClient.quit(), shutdownTimeoutMs, () => {
          redisClient?.disconnect();
        });
      } catch (error: unknown) {
        console.error('Redis shutdown timed out', error);
        redisClient.disconnect();
      }
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
  process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));

  await checkHealth();
  healthTimer = setInterval(() => void checkHealth().catch((error: unknown) => console.error('Health check cycle failed', error)), healthIntervalMs);
  server.listen(port, '0.0.0.0', () => console.log(`LLM gateway listening on ${port}`));
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (entrypoint) await startServer();
