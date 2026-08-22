export * from './domain.js';
export * from './errors.js';
export * from './config.js';
export * from './model-registry.js';
export * from './router.js';
export * from './limits.js';
export * from './retry.js';
export * from './state.js';
export * from './usage.js';
export * from './health.js';
export * from './observability.js';
export * from './security.js';
export * from './gateway.js';
export { GeminiAdapter } from './providers/gemini.js';
export { GroqAdapter, OpenRouterAdapter } from './providers/openai-compatible.js';
export { CloudflareWorkersAIAdapter } from './providers/cloudflare.js';

import { LLMGateway } from './gateway.js';
import { GeminiAdapter } from './providers/gemini.js';
import { GroqAdapter, OpenRouterAdapter } from './providers/openai-compatible.js';
import { CloudflareWorkersAIAdapter } from './providers/cloudflare.js';

export function createGateway(
  config: ConstructorParameters<typeof LLMGateway>[0],
  credentials?: ConstructorParameters<typeof LLMGateway>[1],
  usage?: ConstructorParameters<typeof LLMGateway>[2],
): LLMGateway {
  return new LLMGateway(config, credentials, usage);
}

export function createDefaultAdapters() {
  return [new GeminiAdapter(), new GroqAdapter(), new OpenRouterAdapter(), new CloudflareWorkersAIAdapter()];
}
