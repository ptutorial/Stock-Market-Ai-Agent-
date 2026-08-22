import type { TaskType, ToolCall, ToolDefinition } from './domain.js';
import type { ToolRegistry } from './tools.js';

export type AgentRole = 'technical' | 'fundamental' | 'news' | 'sector' | 'risk' | 'recommendation' | 'critic' | 'final_decision';

export interface AgentContext {
  requestId: string;
  symbol: string;
  exchange?: string;
  horizon?: string;
  input: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  task: TaskType;
  systemPrompt: string;
  toolNames: string[];
  maxToolRounds?: number;
}

export interface AgentResult {
  agentId: string;
  role: AgentRole;
  output: string;
  toolCalls: ToolCall[];
  toolResults: Array<{ tool: string; input: Record<string, unknown>; output: unknown }>;
  structured?: Record<string, unknown>;
}

export interface AgentRegistryOptions {
  tools: ToolRegistry;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  constructor(private readonly options: AgentRegistryOptions) {}

  register(agent: AgentDefinition): this {
    if (!agent.id.trim()) throw new Error('Agent id is required');
    if (this.agents.has(agent.id)) throw new Error(`Agent ${agent.id} is already registered`);
    for (const tool of agent.toolNames) if (!this.options.tools.has(tool)) throw new Error(`Agent ${agent.id} references unknown tool ${tool}`);
    this.agents.set(agent.id, { ...agent, toolNames: [...agent.toolNames] });
    return this;
  }

  get(id: string): AgentDefinition | undefined { return this.agents.get(id); }
  list(): AgentDefinition[] { return [...this.agents.values()]; }
}

export function createStockAgents(tools: ToolRegistry): AgentRegistry {
  const registry = new AgentRegistry({ tools });
  const common = 'Use only supplied tool evidence. Never invent market facts. Clearly separate observations from inferences. Return concise, machine-readable conclusions when requested.';
  registry
    .register({ id: 'technical', role: 'technical', task: 'reasoning', systemPrompt: `${common} Analyze price trend, momentum, volatility, support/resistance and technical indicators.`, toolNames: ['market_price', 'technical_indicators'], maxToolRounds: 2 })
    .register({ id: 'fundamental', role: 'fundamental', task: 'reasoning', systemPrompt: `${common} Analyze financial quality, valuation and fundamental trends.`, toolNames: ['fundamentals'], maxToolRounds: 2 })
    .register({ id: 'news', role: 'news', task: 'general', systemPrompt: `${common} Analyze supplied recent news and identify catalysts and risks.`, toolNames: ['market_news'], maxToolRounds: 2 })
    .register({ id: 'sector', role: 'sector', task: 'reasoning', systemPrompt: `${common} Analyze sector-relative strength and market regime evidence.`, toolNames: ['sector_strength'], maxToolRounds: 2 })
    .register({ id: 'risk', role: 'risk', task: 'reasoning', systemPrompt: `${common} Assess downside risk, volatility, invalidation conditions and risk/reward.`, toolNames: ['risk_metrics'], maxToolRounds: 2 })
    .register({ id: 'recommendation', role: 'recommendation', task: 'reasoning', systemPrompt: `${common} Synthesize agent evidence into a draft recommendation. Do not invent prices or facts.`, toolNames: [], maxToolRounds: 1 })
    .register({ id: 'critic', role: 'critic', task: 'reasoning', systemPrompt: `${common} Challenge the draft recommendation, identify unsupported claims, missing evidence and contradictory signals.`, toolNames: [], maxToolRounds: 1 })
    .register({ id: 'final-decision', role: 'final_decision', task: 'structured_output', systemPrompt: `${common} Produce the final structured recommendation only from the supplied evidence and validated draft/critique.`, toolNames: [], maxToolRounds: 1 });
  return registry;
}
