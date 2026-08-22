import type { AgentRole } from './agents.js';
import type { AgentModelPolicy, LLMProvider } from './agent-llm.js';

const PROVIDERS: LLMProvider[] = ['gemini', 'groq', 'openrouter', 'cloudflare'];

function provider(value: string | undefined, fallback: LLMProvider): LLMProvider {
  return value && PROVIDERS.includes(value as LLMProvider) ? value as LLMProvider : fallback;
}

function model(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function buildPolicy(
  env: NodeJS.ProcessEnv,
  role: AgentRole,
  name: string,
  primaryProvider: LLMProvider,
  primaryModelKey: string,
  primaryModelFallback: string,
  fallbackProvider: LLMProvider,
  fallbackModelKey: string,
  fallbackModelFallback: string,
  outputFallback: number,
): AgentModelPolicy {
  return {
    name,
    primary: {
      provider: provider(env[`${role.toUpperCase()}_LLM_PROVIDER`], provider(env.AGENT_LLM_PRIMARY_PROVIDER, primaryProvider)),
      model: model(env, `${role.toUpperCase()}_LLM_MODEL`, model(env, primaryModelKey, primaryModelFallback)),
    },
    fallback: [{
      provider: provider(env[`${role.toUpperCase()}_LLM_FALLBACK_PROVIDER`], provider(env.AGENT_LLM_FALLBACK_PROVIDER, fallbackProvider)),
      model: model(env, `${role.toUpperCase()}_LLM_FALLBACK_MODEL`, model(env, fallbackModelKey, fallbackModelFallback)),
    }],
    maxOutputTokens: positiveInt(env, `${role.toUpperCase()}_LLM_MAX_OUTPUT_TOKENS`, outputFallback),
  };
}

export function loadAgentModelPolicies(env: NodeJS.ProcessEnv = process.env): Record<AgentRole, AgentModelPolicy> {
  return {
    technical: buildPolicy(env, 'technical', 'technical-fast', 'gemini', 'GEMINI_FAST_MODEL', 'gemini-2.5-flash', 'groq', 'GROQ_FAST_MODEL', 'llama-3.3-70b-versatile', 1200),
    fundamental: buildPolicy(env, 'fundamental', 'fundamental-reasoning', 'gemini', 'GEMINI_REASONING_MODEL', 'gemini-2.5-pro', 'openrouter', 'OPENROUTER_REASONING_MODEL', 'openai/gpt-4o', 1800),
    news: buildPolicy(env, 'news', 'news-fast', 'gemini', 'GEMINI_FAST_MODEL', 'gemini-2.5-flash', 'groq', 'GROQ_FAST_MODEL', 'llama-3.3-70b-versatile', 1200),
    sector: buildPolicy(env, 'sector', 'sector-fast', 'gemini', 'GEMINI_FAST_MODEL', 'gemini-2.5-flash', 'groq', 'GROQ_FAST_MODEL', 'llama-3.3-70b-versatile', 1200),
    risk: buildPolicy(env, 'risk', 'risk-reasoning', 'gemini', 'GEMINI_REASONING_MODEL', 'gemini-2.5-pro', 'openrouter', 'OPENROUTER_REASONING_MODEL', 'openai/gpt-4o', 1800),
    recommendation: buildPolicy(env, 'recommendation', 'recommendation-strong', 'gemini', 'GEMINI_REASONING_MODEL', 'gemini-2.5-pro', 'openrouter', 'OPENROUTER_REASONING_MODEL', 'openai/gpt-4o', 2200),
    critic: buildPolicy(env, 'critic', 'critic-strong', 'gemini', 'GEMINI_REASONING_MODEL', 'gemini-2.5-pro', 'openrouter', 'OPENROUTER_REASONING_MODEL', 'openai/gpt-4o', 1800),
    final_decision: buildPolicy(env, 'final_decision', 'final-strong', 'gemini', 'GEMINI_REASONING_MODEL', 'gemini-2.5-pro', 'openrouter', 'OPENROUTER_REASONING_MODEL', 'openai/gpt-4o', 1800),
  };
}
