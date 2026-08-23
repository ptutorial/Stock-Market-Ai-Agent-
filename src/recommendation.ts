import { randomUUID } from 'node:crypto';
import type { AgentContext, AgentResult, AgentRegistry } from './agents.js';
import type { AgentRuntime } from './agent-runtime.js';
import { validateRecommendation, type RecommendationAction } from './recommendation-schema.js';
import { calculateDeterministicScores, type DeterministicScores } from './recommendation-scoring.js';

export interface SourceProvenance { agentId: string; role: string; tool: string; source: string; freshness?: string; observedAt?: number; fetchedAt?: number; fallback?: boolean; }
export interface Recommendation { symbol: string; exchange?: string; horizon: string; recommendation: RecommendationAction; confidence: number; scores: Record<string, number>; evidence: string[]; risks: string[]; invalidationConditions: string[]; sourceProvenance: SourceProvenance[]; agentConclusions: Record<string, string>; draft: string; critique: string; requestId: string; }
export interface RecommendationEngineOptions {
  agents: AgentRegistry;
  runtime: AgentRuntime;
  snapshotLoader?: (symbol: string, exchange: string) => Promise<unknown>;
}

export class RecommendationEngine {
  constructor(private readonly options: RecommendationEngineOptions) {}

  async recommend(input: { symbol: string; exchange?: string; horizon?: string; data?: Record<string, unknown> }): Promise<Recommendation> {
    const requestId = randomUUID();
    const exchange = input.exchange ?? 'NSE';
    const horizon = input.horizon ?? '1-3_months';
    const suppliedSnapshot = input.data?.stockSnapshot;
    const snapshot = suppliedSnapshot ?? (this.options.snapshotLoader ? await this.options.snapshotLoader(input.symbol, exchange) : undefined);
    const evidence = snapshot === undefined ? {} : { stockSnapshot: snapshot };
    const context: AgentContext = { requestId, symbol: input.symbol, exchange, horizon, input: input.data ?? {}, evidence, evidenceOnly: snapshot !== undefined };
    const specialistIds = ['technical', 'fundamental', 'news', 'sector', 'risk'];
    const agents = specialistIds.map((id) => { const agent = this.options.agents.get(id); if (!agent) throw new Error(`Required agent ${id} is not registered`); return agent; });

    // Run each specialist to completion before starting the next specialist.
    // AgentRuntime performs an initial LLM call followed by a tool-result call;
    // keeping the specialist loop sequential preserves the deterministic
    // execution order used by the recommendation pipeline and its audit trail.
    const specialistResults: AgentResult[] = [];
    for (const agent of agents) {
      specialistResults.push(await this.options.runtime.run(agent, context));
    }

    const conclusions = Object.fromEntries(specialistResults.map((result) => [result.role, result.output]));
    const provenance = snapshot !== undefined ? collectSnapshotProvenance(snapshot) : collectSourceProvenance(specialistResults);
    const deterministicScores = calculateDeterministicScores(snapshot !== undefined ? snapshotScoringEvidence(snapshot) : collectScoringEvidence(specialistResults));
    const synthesisEvidence = { ...evidence, specialistConclusions: conclusions, sourceProvenance: provenance, deterministicScores };
    const synthesisContext: AgentContext = { ...context, evidence: synthesisEvidence, evidenceOnly: true };
    const recommendationAgent = this.options.agents.get('recommendation'); const criticAgent = this.options.agents.get('critic'); const finalAgent = this.options.agents.get('final-decision');
    if (!recommendationAgent || !criticAgent || !finalAgent) throw new Error('Recommendation, critic and final-decision agents are required');
    const draftResult = await this.options.runtime.run(recommendationAgent, synthesisContext);
    const critiqueResult = await this.options.runtime.run(criticAgent, { ...synthesisContext, evidence: { ...synthesisEvidence, draft: draftResult.output } });
    const finalResult = await this.options.runtime.run(finalAgent, { ...synthesisContext, evidence: { ...synthesisEvidence, draft: draftResult.output, critique: critiqueResult.output } });
    return normalizeRecommendation(finalResult.structured, { symbol: input.symbol, exchange, horizon, requestId, conclusions, draft: draftResult.output, critique: critiqueResult.output, provenance, deterministicScores });
  }
}

function unwrapRouted(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return 'data' in record ? record.data : value;
}

function snapshotScoringEvidence(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
  const s = snapshot as Record<string, unknown>;
  return {
    technical: unwrapRouted(s.technicals),
    fundamental: unwrapRouted(s.fundamentals),
    news: unwrapRouted(s.news),
    sector: unwrapRouted(s.sector),
    risk: unwrapRouted(s.risk),
  };
}

function collectSnapshotProvenance(snapshot: unknown): SourceProvenance[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const sources = (snapshot as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    const m = source as Record<string, unknown>;
    if (typeof m.source !== 'string') return [];
    return [{ agentId: 'stock-snapshot', role: 'data', tool: `stock_snapshot.${index}`, source: m.source, freshness: typeof m.freshness === 'string' ? m.freshness : undefined, observedAt: typeof m.observedAt === 'number' ? m.observedAt : undefined, fetchedAt: typeof m.fetchedAt === 'number' ? m.fetchedAt : undefined, fallback: typeof m.fallback === 'boolean' ? m.fallback : undefined }];
  });
}

function collectScoringEvidence(results: AgentResult[]): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};
  const mapping: Record<string, string> = { technical: 'technical', fundamental: 'fundamental', news: 'news', sector: 'sector', risk: 'risk' };
  for (const result of results) {
    const key = mapping[result.role];
    if (!key) continue;
    const values = result.toolResults.map((item) => {
      const output = item.output;
      if (output && typeof output === 'object' && !Array.isArray(output) && 'data' in output) return (output as Record<string, unknown>).data;
      return output;
    });
    evidence[key] = key === 'news' ? values.flat() : values[values.length - 1];
  }
  return evidence;
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
  const raw = (value as Record<string, unknown>).metadata; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>; if (typeof m.source !== 'string') return undefined;
  return { source: m.source, freshness: typeof m.freshness === 'string' ? m.freshness : undefined, observedAt: typeof m.observedAt === 'number' ? m.observedAt : undefined, fetchedAt: typeof m.fetchedAt === 'number' ? m.fetchedAt : undefined, fallback: typeof m.fallback === 'boolean' ? m.fallback : undefined };
}

function normalizeRecommendation(structured: Record<string, unknown> | undefined, context: { symbol: string; exchange: string; horizon: string; requestId: string; conclusions: Record<string, string>; draft: string; critique: string; provenance: SourceProvenance[]; deterministicScores: DeterministicScores }): Recommendation {
  const validated = validateRecommendation(structured);
  const suppliedScores = Object.keys(context.deterministicScores).length ? context.deterministicScores : validated.scores;
  return { symbol: context.symbol, exchange: context.exchange, horizon: context.horizon, ...validated, scores: { ...suppliedScores }, sourceProvenance: context.provenance, agentConclusions: context.conclusions, draft: context.draft, critique: context.critique, requestId: context.requestId };
}
