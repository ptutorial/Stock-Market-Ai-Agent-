import type { TaskType, ToolCall } from '../../domain.js';
import type { ToolRegistry } from '../tools/registry.js';

export type AgentRole = 'technical' | 'fundamental' | 'news' | 'sector' | 'risk' | 'recommendation' | 'critic' | 'final_decision' | 'planner';

export interface AgentContext {
  requestId: string;
  symbol: string;
  exchange?: string;
  horizon?: string;
  input: Record<string, unknown>;
  evidence: Record<string, unknown>;
  evidenceOnly?: boolean;
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

export interface AgentRegistryOptions { tools: ToolRegistry; }

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
