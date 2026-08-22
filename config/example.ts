import { createDefaultAdapters, LLMGateway } from '../src/index.js';

export const gateway = new LLMGateway({
  adapters: createDefaultAdapters(),
  strategy: 'priority',
  fallbackProviders: ['gemini', 'groq', 'openrouter', 'cloudflare'],
  maxRetries: 2,
  cooldownMs: 30_000,
  accounts: [
    {
      id: 'gemini-dev-1', provider: 'gemini', credentialRef: 'GEMINI_API_KEY_1',
      models: ['gemini-2.5-flash'], capabilities: ['chat', 'streaming', 'structured_output'], priority: 100,
    },
    {
      id: 'gemini-dev-2', provider: 'gemini', credentialRef: 'GEMINI_API_KEY_2',
      models: ['gemini-2.5-flash'], capabilities: ['chat', 'streaming', 'structured_output'], priority: 90,
    },
    {
      id: 'groq-prod-1', provider: 'groq', credentialRef: 'GROQ_API_KEY_1',
      models: ['llama-3.3-70b-versatile'], capabilities: ['chat', 'streaming', 'tool_calling'], priority: 80,
    },
    {
      id: 'openrouter-1', provider: 'openrouter', credentialRef: 'OPENROUTER_API_KEY_1',
      models: ['openai/gpt-oss-120b'], capabilities: ['chat', 'streaming', 'tool_calling'], priority: 70,
    },
    {
      id: 'cloudflare-1', provider: 'cloudflare', credentialRef: 'CF_API_TOKEN',
      models: ['llama-3.2-3b-instruct'], capabilities: ['chat'], priority: 60,
    },
  ],
});

// Application code stays provider-neutral:
// const result = await gateway.generate('coding', 'Explain this function', { model: undefined });
