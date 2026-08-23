import type { AgentRole } from './agents.js';
import type { Capability, GenerateResult, TaskType, ToolDefinition } from './domain.js';

export type LLMProvider = 'gemini' | 'groq' | 'openrouter' | 'cloudflare';
export type AgentModelPolicy = { name: string; primary: { provider: LLMProvider; model: string }; fallback?: Array<{ provider: LLMProvider; model: string }>; maxInputTokens?: number; maxOutputTokens?: number; maxCostPerRequest?: number };
export type AgentLLMRequest = { requestId: string; agentId: string; role: AgentRole; task: TaskType; systemPrompt: string; input: unknown; policy: AgentModelPolicy; capabilities?: Capability[]; tools?: ToolDefinition[] };
export type AgentLLMResponse = { output: string; toolCalls?: GenerateResult['toolCalls']; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number }; provider: LLMProvider; model: string; estimatedCost?: number; fallback?: boolean };
export interface AgentLLMGateway { generate(request: AgentLLMRequest): Promise<AgentLLMResponse>; }
export type MultiProviderGateway = { generate(request: { requestId: string; provider: LLMProvider; model: string; task: TaskType; systemPrompt: string; input: unknown; capabilities?: Capability[]; tools?: ToolDefinition[]; maxInputTokens?: number; maxOutputTokens?: number }): Promise<AgentLLMResponse> };

export class MultiProviderAgentLLM implements AgentLLMGateway {
  constructor(private readonly gateway: MultiProviderGateway) {}
  async generate(request: AgentLLMRequest): Promise<AgentLLMResponse> {
    const candidates = [request.policy.primary, ...(request.policy.fallback ?? [])]; let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const result = await this.gateway.generate({ requestId: request.requestId, provider: candidate.provider, model: candidate.model, task: request.task, systemPrompt: request.systemPrompt, input: request.input, capabilities: request.capabilities, tools: request.tools, maxInputTokens: request.policy.maxInputTokens, maxOutputTokens: request.policy.maxOutputTokens });
        if (request.policy.maxCostPerRequest !== undefined && (result.estimatedCost ?? 0) > request.policy.maxCostPerRequest) throw new Error(`LLM request cost ${result.estimatedCost ?? 0} exceeds policy limit ${request.policy.maxCostPerRequest}`);
        return { ...result, provider: candidate.provider, model: candidate.model, fallback: index > 0 };
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error('All configured LLM providers failed');
  }
}

/** Adapter depends on the gateway contract, not a concrete LLMGateway class, avoiding duplicate private members across modular and legacy gateways. */
export class LLMGatewayAgentAdapter implements MultiProviderGateway {
  constructor(private readonly gateway: { generate: (task: TaskType, prompt: string, options?: Record<string, unknown>) => Promise<GenerateResult> }) {}
  async generate(request: Parameters<MultiProviderGateway['generate']>[0]): Promise<AgentLLMResponse> {
    const prompt = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const result = await this.gateway.generate(request.task, prompt, { task: request.task, model: request.model, capabilities: request.capabilities, tools: request.tools, maxTokens: request.maxOutputTokens, provider: request.provider, requestId: request.requestId });
    return { output: result.text, toolCalls: result.toolCalls, usage: result.usage, estimatedCost: result.usage.estimatedCost, provider: request.provider, model: result.model ?? request.model };
  }
}

export const DEFAULT_AGENT_MODEL_POLICIES: Record<AgentRole, AgentModelPolicy> = {
  technical: { name: 'technical-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  fundamental: { name: 'fundamental-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  news: { name: 'news-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  sector: { name: 'sector-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  risk: { name: 'risk-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  recommendation: { name: 'recommendation-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 2200 },
  critic: { name: 'critic-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  final_decision: { name: 'final-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
};
