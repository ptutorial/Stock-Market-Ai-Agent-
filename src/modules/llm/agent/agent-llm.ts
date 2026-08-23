import type { Capability, GenerateOptions, TaskType, ToolDefinition, ToolCall } from '../../../domain.js';
import type { AgentRole } from '../../agents/registry.js';

export type LLMProvider = 'gemini' | 'groq' | 'openrouter' | 'cloudflare';
export interface AgentModelPolicy { name: string; primary: { provider: LLMProvider; model: string }; fallback?: Array<{ provider: LLMProvider; model: string }>; maxOutputTokens?: number; }
export interface AgentLLMRequest { requestId: string; agentId: string; role: AgentRole; task: TaskType; systemPrompt: string; input: unknown; policy: AgentModelPolicy; capabilities?: Capability[]; tools?: ToolDefinition[]; maxInputTokens?: number; maxOutputTokens?: number; }
export interface AgentLLMResponse { output: string; provider: LLMProvider; model: string; toolCalls?: ToolCall[]; fallback?: boolean; }
export interface AgentLLMGateway { generate(request: AgentLLMRequest): Promise<AgentLLMResponse>; }

export class MultiProviderAgentLLM implements AgentLLMGateway {
  constructor(private readonly gateway: AgentLLMGateway) {}
  async generate(request: AgentLLMRequest): Promise<AgentLLMResponse> {
    const candidates = [request.policy.primary, ...(request.policy.fallback ?? [])]; let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) { const candidate = candidates[index]; try { const response = await this.gateway.generate({ ...request, policy: { ...request.policy, primary: candidate, fallback: [] } }); return { ...response, provider: candidate.provider, model: candidate.model, fallback: index > 0 || response.fallback }; } catch (error) { lastError = error; } }
    throw lastError instanceof Error ? lastError : new Error('All configured agent LLM providers failed');
  }
}

export class LLMGatewayAgentAdapter implements AgentLLMGateway {
  constructor(private readonly gateway: { generate(task: TaskType, prompt: string, options?: GenerateOptions & { provider?: LLMProvider; requestId?: string }): Promise<{ text: string; provider: LLMProvider; model: string; toolCalls?: ToolCall[] }> }) {}
  async generate(request: AgentLLMRequest): Promise<AgentLLMResponse> {
    const input = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const result = await this.gateway.generate(request.task, `SYSTEM: ${request.systemPrompt}\nUSER: ${input}`, { provider: request.policy.primary.provider, model: request.policy.primary.model, task: request.task, capabilities: request.capabilities, tools: request.tools, maxTokens: request.maxOutputTokens ?? request.policy.maxOutputTokens, requestId: request.requestId });
    return { output: result.text, provider: result.provider, model: result.model, toolCalls: result.toolCalls };
  }
}

export const DEFAULT_AGENT_MODEL_POLICIES: Record<string, AgentModelPolicy> = {
  technical: { name: 'technical-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  fundamental: { name: 'fundamental-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  news: { name: 'news-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  sector: { name: 'sector-fast', primary: { provider: 'gemini', model: 'gemini-2.5-flash' }, fallback: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }], maxOutputTokens: 1200 },
  risk: { name: 'risk-reasoning', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  recommendation: { name: 'recommendation-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 2200 },
  critic: { name: 'critic-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
  final_decision: { name: 'final-strong', primary: { provider: 'gemini', model: 'gemini-2.5-pro' }, fallback: [{ provider: 'openrouter', model: 'openai/gpt-4o' }], maxOutputTokens: 1800 },
};
