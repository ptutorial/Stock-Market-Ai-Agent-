import { randomUUID } from 'node:crypto';
import type { AgentContext, AgentResult, AgentRegistry } from './agents.js';
import type { AgentRuntime } from './agent-runtime.js';

export type RecommendationAction = 'BUY' | 'HOLD' | 'AVOID';

export interface Recommendation {
  symbol: string;
  exchange?: string;
  horizon: string;
  recommendation: RecommendationAction;
  confidence: number;
  scores: Record<string, number>;
  evidence: string[];
  risks: string[];
  agentConclusions: Record<string, string>;
  draft: string;
  critique: string;
  requestId: string;
}

export interface RecommendationEngineOptions { agents: AgentRegistry; runtime: AgentRuntime; }

export class RecommendationEngine {
  constructor(private readonly options: RecommendationEngineOptions) {}

  async recommend(input: { symbol: string; exchange?: string; horizon?: string; data?: Record<string, unknown> }): Promise<Recommendation> {
    const requestId = randomUUID();
    const context: AgentContext = { requestId, symbol: input.symbol, exchange: input.exchange, horizon: input.horizon ?? '1-3_months', input: input.data ?? {}, evidence: {} };
    const specialistIds = ['technical', 'fundamental', 'news', 'sector', 'risk'];
    const specialistResults: AgentResult[] = [];
    for (const id of specialistIds) {
      const agent = this.options.agents.get(id);
      if (!agent) throw new Error(`Required agent ${id} is not registered`);
      specialistResults.push(await this.options.runtime.run(agent, context));
    }
    const conclusions = Object.fromEntries(specialistResults.map((result) => [result.role, result.output]));
    const synthesisContext: AgentContext = { ...context, evidence: { specialistConclusions: conclusions } };
    const recommendationAgent = this.options.agents.get('recommendation');
    const criticAgent = this.options.agents.get('critic');
    const finalAgent = this.options.agents.get('final-decision');
    if (!recommendationAgent || !criticAgent || !finalAgent) throw new Error('Recommendation, critic and final-decision agents are required');
    const draftResult = await this.options.runtime.run(recommendationAgent, synthesisContext);
    const critiqueResult = await this.options.runtime.run(criticAgent, { ...synthesisContext, evidence: { ...synthesisContext.evidence, draft: draftResult.output } });
    const finalResult = await this.options.runtime.run(finalAgent, { ...synthesisContext, evidence: { ...synthesisContext.evidence, draft: draftResult.output, critique: critiqueResult.output } });
    return normalizeRecommendation(finalResult.structured, { symbol: input.symbol, exchange: input.exchange, horizon: context.horizon, requestId, conclusions, draft: draftResult.output, critique: critiqueResult.output });
  }
}

function normalizeRecommendation(structured: Record<string, unknown> | undefined, context: { symbol: string; exchange?: string; horizon: string; requestId: string; conclusions: Record<string, string>; draft: string; critique: string }): Recommendation {
  const action = String(structured?.recommendation ?? 'HOLD').toUpperCase();
  const recommendationAction: RecommendationAction = action === 'BUY' || action === 'AVOID' ? action : 'HOLD';
  const rawConfidence = Number(structured?.confidence ?? 0);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
  const rawScores = structured?.scores;
  const scores: Record<string, number> = {};
  if (rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores)) {
    for (const [key, value] of Object.entries(rawScores)) { const score = Number(value); if (Number.isFinite(score)) scores[key] = Math.min(100, Math.max(0, score)); }
  }
  const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const recommendation: Recommendation = {
    symbol: context.symbol,
    horizon: context.horizon,
    recommendation: recommendationAction,
    confidence,
    scores,
    evidence: list(structured?.evidence),
    risks: list(structured?.risks),
    agentConclusions: context.conclusions,
    draft: context.draft,
    critique: context.critique,
    requestId: context.requestId,
  };
  if (context.exchange !== undefined) recommendation.exchange = context.exchange;
  return recommendation;
}
