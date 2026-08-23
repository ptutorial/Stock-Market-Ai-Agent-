import type { ToolRegistry } from '../tools/registry.js';
import { AgentRegistry } from './registry.js';

export function createStockAgents(tools: ToolRegistry): AgentRegistry {
  const registry = new AgentRegistry({ tools });
  const common = 'Use only supplied tool evidence. Never invent market facts. Clearly separate observations from inferences. Return concise, machine-readable conclusions when requested.';
  const shared = 'Prefer the shared stock snapshot. When snapshot evidence is supplied, do not re-fetch the same market data.';
  registry
    .register({ id: 'technical', role: 'technical', task: 'reasoning', systemPrompt: `${common} ${shared} Analyze price trend, momentum, volatility, support/resistance and technical indicators.`, toolNames: ['market_price', 'technical_indicators'], maxToolRounds: 2 })
    .register({ id: 'fundamental', role: 'fundamental', task: 'reasoning', systemPrompt: `${common} ${shared} Analyze financial quality, valuation and fundamental trends.`, toolNames: ['fundamentals'], maxToolRounds: 2 })
    .register({ id: 'news', role: 'news', task: 'general', systemPrompt: `${common} ${shared} Analyze supplied recent news and identify catalysts and risks.`, toolNames: ['market_news'], maxToolRounds: 2 })
    .register({ id: 'sector', role: 'sector', task: 'reasoning', systemPrompt: `${common} ${shared} Analyze sector-relative strength and market regime evidence.`, toolNames: ['sector_strength'], maxToolRounds: 2 })
    .register({ id: 'risk', role: 'risk', task: 'reasoning', systemPrompt: `${common} ${shared} Assess downside risk, volatility, invalidation conditions and risk/reward.`, toolNames: ['risk_metrics'], maxToolRounds: 2 })
    .register({ id: 'recommendation', role: 'recommendation', task: 'reasoning', systemPrompt: `${common} Synthesize agent evidence into a draft recommendation. Do not invent prices or facts.`, toolNames: [], maxToolRounds: 1 })
    .register({ id: 'critic', role: 'critic', task: 'reasoning', systemPrompt: `${common} Challenge the draft recommendation, identify unsupported claims, missing evidence and contradictory signals.`, toolNames: [], maxToolRounds: 1 })
    .register({ id: 'final-decision', role: 'final_decision', task: 'structured_output', systemPrompt: `${common} Produce the final structured recommendation only from the supplied evidence and validated draft/critique.`, toolNames: [], maxToolRounds: 1 });
  return registry;
}
