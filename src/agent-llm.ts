import type { AgentRole } from './agents.js';

export type LLMProvider = 'gemini' | 'openai-compatible' | 'cloudflare' | (string & {});

export type AgentModelPolicy = {
  name: string;
  primary: { provider: LLMProvider; model: string };
  fallback?: Array<{ provider: LLMProvider; model: string }>;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostPerRequest?: number;
};

export type AgentLLMRequest = {
  requestId: string;
  agentId: string;
  role: AgentRole;
  systemPrompt: string;
  input: unknown;
  policy: AgentModelPolicy;
};

export type AgentLLMResponse = {
  output: string;
  provider: LLMProvider;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost?: number;
  fallback?: boolean;
};

export interface AgentLLMGateway {
  generate(request: AgentLLMRequest): Promise<AgentLLMResponse>;
}

export type MultiProviderGateway = {
  generate(request: {
    requestId: string;
    provider: LLMProvider;
    model: string;
    systemPrompt: string;
    input: unknown;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  }): Promise<AgentLLMResponse>;
};

export class MultiProviderAgentLLM implements AgentLLMGateway {
  constructor(private readonly gateway: MultiProviderGateway) {}

  async generate(request: AgentLLMRequest): Promise<AgentLLMResponse> {
    const candidates = [request.policy.primary, ...(request.policy.fallback ?? [])];
    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const result = await this.gateway.generate({
          requestId: request.requestId,
          provider: candidate.provider,
          model: candidate.model,
          systemPrompt: request.systemPrompt,
          input: request.input,
          maxInputTokens: request.policy.maxInputTokens,
          maxOutputTokens: request.policy.maxOutputTokens,
        });
        return { ...result, provider: candidate.provider, model: candidate.model, fallback: index > 0 };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All configured LLM providers failed');
  }
}

export const DEFAULT_AGENT_MODEL_POLICIES: Record<AgentRole, AgentModelPolicy> = {
  technical: { name: 'technical-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o-mini' }], maxOutputTokens: 1200 },
  fundamental: { name: 'fundamental-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o' }], maxOutputTokens: 1800 },
  news: { name: 'news-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o-mini' }], maxOutputTokens: 1200 },
  sector: { name: 'sector-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o-mini' }], maxOutputTokens: 1200 },
  risk: { name: 'risk-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o' }], maxOutputTokens: 1800 },
  recommendation: { name: 'recommendation-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o' }], maxOutputTokens: 2200 },
  critic: { name: 'critic-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o' }], maxOutputTokens: 1800 },
  final_decision: { name: 'final-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openai-compatible', model: 'gpt-4o' }], maxOutputTokens: 1800 },
};
