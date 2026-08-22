import { randomUUID } from 'node:crypto';
import type { GenerateResult, ToolCall } from './domain.js';
import type { LLMGateway } from './gateway.js';
import type { AgentContext, AgentDefinition, AgentResult } from './agents.js';
import { ToolRegistry } from './tools.js';

export interface AgentRuntimeOptions {
  gateway: LLMGateway;
  tools: ToolRegistry;
  maxRounds?: number;
}

export class AgentRuntime {
  private readonly maxRounds: number;
  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxRounds = options.maxRounds ?? 4;
  }

  async run(agent: AgentDefinition, context: AgentContext): Promise<AgentResult> {
    const requestId = context.requestId || randomUUID();
    const allowedTools = new Set(agent.toolNames);
    const toolCalls: ToolCall[] = [];
    const toolResults: AgentResult['toolResults'] = [];
    let prompt = this.buildPrompt(agent, context, toolResults);
    let response: GenerateResult | undefined;

    for (let round = 0; round < Math.min(this.maxRounds, agent.maxToolRounds ?? this.maxRounds); round += 1) {
      response = await this.options.gateway.generate(agent.task, prompt, {
        capabilities: agent.toolNames.length ? ['chat', 'tool_calling'] : ['chat'],
        tools: this.options.tools.definitions(agent.toolNames),
        maxTokens: 2000,
      });

      const calls = response.toolCalls ?? [];
      toolCalls.push(...calls);
      if (!calls.length) break;

      for (const call of calls) {
        if (!allowedTools.has(call.name)) {
          throw new Error(`Agent ${agent.id} is not permitted to use tool ${call.name}`);
        }
        const output = await this.options.tools.execute(call.name, call.arguments, {
          requestId,
          agentId: agent.id,
        });
        toolResults.push({ tool: call.name, input: call.arguments, output });
      }
      prompt = this.buildPrompt(agent, context, toolResults, response.text);
    }

    if (!response) throw new Error(`Agent ${agent.id} produced no response`);
    return {
      agentId: agent.id,
      role: agent.role,
      output: response.text,
      toolCalls,
      toolResults,
      structured: parseStructuredOutput(response.text),
    };
  }

  private buildPrompt(agent: AgentDefinition, context: AgentContext, results: AgentResult['toolResults'], previous?: string): string {
    return [
      `SYSTEM: ${agent.systemPrompt}`,
      `SYMBOL: ${context.symbol}`,
      context.exchange ? `EXCHANGE: ${context.exchange}` : '',
      context.horizon ? `HORIZON: ${context.horizon}` : '',
      `INPUT: ${JSON.stringify(context.input)}`,
      `EVIDENCE: ${JSON.stringify(context.evidence)}`,
      results.length ? `TOOL_RESULTS: ${JSON.stringify(results)}` : '',
      previous ? `PREVIOUS_RESPONSE: ${previous}` : '',
      agent.toolNames.length ? 'Use only the tools listed in the tool definitions. Do not fabricate tool results.' : '',
      'Return the conclusion and, when structured output is requested, valid JSON only.',
    ].filter(Boolean).join('\n');
  }
}

export function parseStructuredOutput(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
