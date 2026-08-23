import { randomUUID } from 'node:crypto';
import type { ToolCall } from '../../domain.js';
import type { LLMGateway } from '../llm/gateway/index.js';
import type { AgentContext, AgentDefinition, AgentResult } from './registry.js';
import { ToolRegistry } from '../tools/registry.js';
import { DEFAULT_AGENT_MODEL_POLICIES, LLMGatewayAgentAdapter, MultiProviderAgentLLM } from '../llm/agent/index.js';
import type { AgentLLMGateway, AgentModelPolicy } from '../llm/agent/index.js';

export interface AgentRuntimeOptions { tools: ToolRegistry; agentLLM?: AgentLLMGateway; gateway?: LLMGateway; policies?: Partial<Record<AgentModelPolicy['name'] | AgentDefinition['role'], AgentModelPolicy>>; maxRounds?: number; }
export class AgentRuntime {
  private readonly maxRounds: number; private readonly llm: AgentLLMGateway; private readonly policies: Record<string, AgentModelPolicy>;
  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxRounds = options.maxRounds ?? 4;
    if (options.agentLLM) this.llm = options.agentLLM;
    else if (options.gateway) this.llm = new MultiProviderAgentLLM(new LLMGatewayAgentAdapter(options.gateway));
    else throw new Error('AgentRuntime requires agentLLM or gateway');
    const mergedPolicies = { ...DEFAULT_AGENT_MODEL_POLICIES, ...(options.policies ?? {}) };
    this.policies = Object.fromEntries(Object.entries(mergedPolicies).filter(([, policy]) => policy !== undefined)) as Record<string, AgentModelPolicy>;
  }
  async run(agent: AgentDefinition, context: AgentContext): Promise<AgentResult> {
    const requestId = context.requestId || randomUUID(); const effectiveToolNames = context.evidenceOnly ? [] : agent.toolNames; const allowedTools = new Set(effectiveToolNames); const toolCalls: ToolCall[] = []; const toolResults: AgentResult['toolResults'] = []; let prompt = this.buildPrompt(agent, context, toolResults, effectiveToolNames); let output = ''; let structured: Record<string, unknown> | undefined;
    for (let round = 0; round < Math.min(this.maxRounds, agent.maxToolRounds ?? this.maxRounds); round += 1) { const policy = this.policies[agent.role]; if (!policy) throw new Error(`No LLM model policy configured for agent role ${agent.role}`); const response = await this.llm.generate({ requestId, agentId: agent.id, role: agent.role, task: agent.task, systemPrompt: agent.systemPrompt, input: prompt, policy, capabilities: agent.task === 'structured_output' ? ['chat', 'structured_output', ...(effectiveToolNames.length ? ['tool_calling' as const] : [])] : effectiveToolNames.length ? ['chat', 'tool_calling'] : ['chat'], tools: this.options.tools.definitions(effectiveToolNames) }); output = response.output; structured = parseStructuredOutput(output); const calls = response.toolCalls ?? []; toolCalls.push(...calls); if (!calls.length) break; for (const call of calls) { if (!allowedTools.has(call.name)) throw new Error(`Agent ${agent.id} is not permitted to use tool ${call.name}`); const toolOutput = await this.options.tools.execute(call.name, call.arguments, { requestId, agentId: agent.id }); toolResults.push({ tool: call.name, input: call.arguments, output: toolOutput }); } prompt = this.buildPrompt(agent, context, toolResults, effectiveToolNames, output); }
    return { agentId: agent.id, role: agent.role, output, toolCalls, toolResults, structured };
  }
  private buildPrompt(agent: AgentDefinition, context: AgentContext, results: AgentResult['toolResults'], effectiveToolNames: string[], previous?: string): string { return [`SYSTEM: ${agent.systemPrompt}`, `SYMBOL: ${context.symbol}`, context.exchange ? `EXCHANGE: ${context.exchange}` : '', context.horizon ? `HORIZON: ${context.horizon}` : '', `INPUT: ${JSON.stringify(context.input)}`, `EVIDENCE: ${JSON.stringify(context.evidence)}`, results.length ? `TOOL_RESULTS: ${JSON.stringify(results)}` : '', previous ? `PREVIOUS_RESPONSE: ${previous}` : '', effectiveToolNames.length ? 'Use only the tools listed in the tool definitions. Do not fabricate tool results.' : 'Use only supplied evidence; no tool calls are available for this step.', 'Return the conclusion and, when structured output is requested, valid JSON only.'].filter(Boolean).join('\n'); }
}
export function parseStructuredOutput(text: string): Record<string, unknown> | undefined { const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); try { const value: unknown = JSON.parse(trimmed); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } catch { return undefined; } }
