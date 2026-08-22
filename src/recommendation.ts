import { randomUUID } from 'node:crypto';
import type { AgentContext, AgentResult, AgentRegistry } from './agents.js';
import type { AgentRuntime } from './agent-runtime.js';
import { validateRecommendation, type RecommendationAction } from './recommendation-schema.js';

export interface SourceProvenance { agentId: string; role: string; tool: string; source: string; freshness?: string; observedAt?: string; fetchedAt?: string; fallback?: boolean; }
export interface Recommendation { symbol: string; exchange?: string; horizon: string; recommendation: RecommendationAction; confidence: number; scores: Record<string, number>; evidence: string[]; risks: string[]; invalidationConditions: string[]; sourceProvenance: SourceProvenance[]; agentConclusions: Record<string, string>; draft: string; critique: string; requestId: string; }
export interface RecommendationEngineOptions { agents: AgentRegistry; runtime: AgentRuntime; }

export class RecommendationEngine {
  constructor(private readonly options: RecommendationEngineOptions) {}
  async recommend(input: { symbol: string; exchange?: string; horizon?: string; data?: Record<string, unknown> }): Promise<Recommendation> {
    const requestId = randomUUID(); const exchange = input.exchange ?? 'NSE'; const horizon = input.horizon ?? '1-3_months';
    const context: AgentContext = { requestId, symbol: input.symbol, exchange, horizon, input: input.data ?? {}, evidence: {} };
    const specialistResults: AgentResult[] = [];
    for (const id of ['technical', 'fundamental', 'news', 'sector', 'risk']) { const agent = this.options.agents.get(id); if (!agent) throw new Error(`Required agent ${id} is not registered`); specialistResults.push(await this.options.runtime.run(agent, context)); }
    const conclusions = Object.fromEntries(specialistResults.map((result) => [result.role, result.output]));
    const provenance = collectSourceProvenance(specialistResults);
    const synthesisContext: AgentContext = { ...context, evidence: { specialistConclusions: conclusions, sourceProvenance: provenance } };
    const recommendationAgent = this.options.agents.get('recommendation'); const criticAgent = this.options.agents.get('critic'); const finalAgent = this.options.agents.get('final-decision');
    if (!recommendationAgent || !criticAgent || !finalAgent) throw new Error('Recommendation, critic and final-decision agents are required');
    const draftResult = await this.options.runtime.run(recommendationAgent, synthesisContext);
    const critiqueResult = await this.options.runtime.run(criticAgent, { ...synthesisContext, evidence: { ...synthesisContext.evidence, draft: draftResult.output } });
    const finalResult = await this.options.runtime.run(finalAgent, { ...synthesisContext, evidence: { ...synthesisContext.evidence, draft: draftResult.output, critique: critiqueResult.output } });
    return normalizeRecommendation(finalResult.structured, { symbol: input.symbol, exchange, horizon, requestId, conclusions, draft: draftResult.output, critique: critiqueResult.output, provenance });
  }
}

function collectSourceProvenance(results: AgentResult[]): SourceProvenance[] {
  const output: SourceProvenance[] = [];
  for (const result of results) for (const toolResult of result.toolResults) {
    const metadata = extractMetadata(toolResult.output); if (!metadata?.source) continue;
    output.push({ agentId: result.agentId, role: result.role, tool: toolResult.tool, ...metadata });
  }
  return output;
}

function extractMetadata(value: unknown): Omit<SourceProvenance, 'agentId' | 'role' | 'tool'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>).metadata;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>; if (typeof m.source !== 'string') return undefined;
  return { source: m.source, freshness: typeof m.freshness === 'string' ? m.freshness : undefined, observedAt: typeof m.observedAt === 'string' ? m.observedAt : undefined, fetchedAt: typeof m.fetchedAt === 'string' ? m.fetchedAt : undefined, fallback: typeof m.fallback === 'boolean' ? m.fallback : undefined };
}

function normalizeRecommendation(structured: Record<string, unknown> | undefined, context: { symbol: string; exchange: string; horizon: string; requestId: string; conclusions: Record<string, string>; draft: string; critique: string; provenance: SourceProvenance[] }): Recommendation {
  const validated = validateRecommendation(structured);
  return { symbol: context.symbol, exchange: context.exchange, horizon: context.horizon, ...validated, sourceProvenance: context.provenance, agentConclusions: context.conclusions, draft: context.draft, critique: context.critique, requestId: context.requestId };
}
