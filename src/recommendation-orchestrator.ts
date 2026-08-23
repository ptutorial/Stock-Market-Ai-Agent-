import type { AgentContext, AgentResult, AgentRegistry } from './agents.js';
import type { AgentRuntime } from './agent-runtime.js';

export interface RecommendationOrchestratorOptions { agents: AgentRegistry; runtime: AgentRuntime; }
export interface RecommendationRun { symbol: string; exchange?: string; horizon?: string; specialistResults: AgentResult[]; draft: AgentResult; critique: AgentResult; finalDecision: AgentResult; }

/** Runs independent specialists concurrently, then synthesizes, critiques and finalizes sequentially. */
export class RecommendationOrchestrator {
  constructor(private readonly options: RecommendationOrchestratorOptions) {}

  async run(input: { requestId: string; symbol: string; exchange?: string; horizon?: string; input?: Record<string, unknown>; evidence?: Record<string, unknown>; }): Promise<RecommendationRun> {
    const base: AgentContext = { requestId: input.requestId, symbol: input.symbol, exchange: input.exchange, horizon: input.horizon, input: input.input ?? {}, evidence: input.evidence ?? {} };
    const specialistIds = ['technical', 'fundamental', 'news', 'sector', 'risk'];
    const specialistResults = await Promise.all(specialistIds.map((id) => this.options.runtime.run(this.requireAgent(id), base)));
    const specialistEvidence = this.toEvidence(specialistResults);
    const draft = await this.options.runtime.run(this.requireAgent('recommendation'), { ...base, evidence: { ...base.evidence, specialists: specialistEvidence } });
    const critique = await this.options.runtime.run(this.requireAgent('critic'), { ...base, evidence: { ...base.evidence, specialists: specialistEvidence, draft: this.resultEvidence(draft) } });
    const finalDecision = await this.options.runtime.run(this.requireAgent('final-decision'), { ...base, evidence: { ...base.evidence, specialists: specialistEvidence, draft: this.resultEvidence(draft), critique: this.resultEvidence(critique) } });
    return { symbol: input.symbol, exchange: input.exchange, horizon: input.horizon, specialistResults, draft, critique, finalDecision };
  }

  private requireAgent(id: string) { const agent = this.options.agents.get(id); if (!agent) throw new Error(`Required recommendation agent ${id} is not registered`); return agent; }
  private toEvidence(results: AgentResult[]): Record<string, unknown> { return Object.fromEntries(results.map((result) => [result.agentId, this.resultEvidence(result)])); }
  private resultEvidence(result: AgentResult): Record<string, unknown> { return { agentId: result.agentId, role: result.role, output: result.output, structured: result.structured, toolResults: result.toolResults }; }
}
