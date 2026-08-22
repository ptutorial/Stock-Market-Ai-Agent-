import { createServer } from 'node:http';
import { createClient } from 'redis';
import { createGatewayHttpHandler } from './http.js';
import { flattenAccounts, loadConfigFromEnvironment } from './config.js';
import { LLMGateway, EnvironmentCredentialStore } from './gateway.js';
import { GeminiAdapter } from './providers/gemini.js';
import { CloudflareWorkersAIAdapter } from './providers/cloudflare.js';
import { GroqAdapter, OpenRouterAdapter } from './providers/openai-compatible.js';
import { AtomicRedisStateStore } from './redis.js';
import type { RedisAtomicClient } from './redis.js';
import type { StateStore } from './state.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.GATEWAY_API_KEY;
if (!apiKey) throw new Error('GATEWAY_API_KEY is required to start the HTTP server');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${process.env.PORT}`);

const config = loadConfigFromEnvironment();
const adapters = [new GeminiAdapter(), new GroqAdapter(), new OpenRouterAdapter(), new CloudflareWorkersAIAdapter()];
const configuredProviders = new Set(flattenAccounts(config).map((account) => account.provider));
const availableProviders = new Set(adapters.map((adapter) => adapter.name));
for (const provider of configuredProviders) if (!availableProviders.has(provider)) throw new Error(`No adapter is registered for configured provider: ${provider}`);

let redisClient: ReturnType<typeof createClient> | undefined;
let stateStore: StateStore;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (error) => console.error('Redis client error', error));
  await redisClient.connect();
  stateStore = new AtomicRedisStateStore(redisClient as unknown as RedisAtomicClient);
} else {
  const { InMemoryStateStore } = await import('./state.js');
  stateStore = new InMemoryStateStore();
}

const accounts = flattenAccounts(config);
if (!accounts.length) throw new Error('No enabled gateway accounts are configured');

const gatewayConfig = { accounts, adapters, strategy: config.strategy, maxRetries: config.maxRetries, cooldownMs: config.cooldownMs, stateStore };
const gateway = new LLMGateway(gatewayConfig, new EnvironmentCredentialStore());
const maxBodyBytes = Number(process.env.GATEWAY_REQUEST_BODY_LIMIT_BYTES ?? 1_048_576);
const handler = createGatewayHttpHandler({ ...gatewayConfig, apiKey, maxBodyBytes });

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
    const body = raw ? JSON.parse(raw) : {};
    const result = await handler({ method: req.method ?? 'GET', path: req.url ?? '/', body, headers: { authorization: req.headers.authorization, 'x-request-id': req.headers['x-request-id'] as string | undefined } });
    res.statusCode = result.status;
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    res.end(JSON.stringify(result.body));
  } catch (error) {
    console.error('HTTP request error', error);
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'InvalidRequest' }));
  }
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    if (redisClient?.isOpen) await redisClient.quit();
    process.exit(0);
  });
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
server.listen(port, '0.0.0.0', () => console.log(`LLM gateway listening on ${port}`));
