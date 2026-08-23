export * from './modules/shared/index.js';
export * from './modules/config/index.js';
export * from './modules/llm/index.js';
export * from './modules/agents/index.js';
export * from './modules/recommendation/index.js';
export * from './modules/market/index.js';
export * from './modules/tools/index.js';
export * from './modules/infrastructure/index.js';
export * from './modules/http/index.js';
export * from './security.js';

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
