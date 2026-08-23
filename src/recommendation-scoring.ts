export interface DeterministicScores { technical: number; fundamental: number; news: number; sector: number; risk: number; overall: number; }
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const finite = (value: unknown): number | undefined => { const n = Number(value); return Number.isFinite(n) ? n : undefined; };

/** Deterministic arithmetic over supplied market evidence; LLMs may explain but do not calculate these scores. */
export function calculateDeterministicScores(evidence: Record<string, unknown>): DeterministicScores {
  const technical = scoreTechnical(evidence.technical);
  const fundamental = scoreFundamental(evidence.fundamental);
  const news = scoreNews(evidence.news);
  const sector = scoreSector(evidence.sector);
  const risk = scoreRisk(evidence.risk);
  return { technical, fundamental, news, sector, risk, overall: clamp(technical * .25 + fundamental * .25 + news * .15 + sector * .15 + risk * .20) };
}
function scoreTechnical(value: unknown): number { const v = asRecord(value); const rsi = finite(v.rsi14); const volume = finite(v.volumeRatio); const trend = trendScore(finite(v.price), finite(v.ema20), finite(v.ema50), finite(v.ema200)); const rsiScore = rsi === undefined ? 50 : rsi >= 50 && rsi <= 70 ? 75 : rsi > 70 ? 45 : rsi >= 30 ? 55 : 25; const volumeScore = volume === undefined ? 50 : clamp(50 + (volume - 1) * 25); return clamp(trend * .5 + rsiScore * .3 + volumeScore * .2); }
function scoreFundamental(value: unknown): number { const v = asRecord(value); const parts: number[] = []; const growth = finite(v.earningsGrowth ?? v.revenueGrowth); if (growth !== undefined) parts.push(clamp(50 + growth * 2)); const roe = finite(v.roe); if (roe !== undefined) parts.push(clamp(50 + roe * 1.5)); const de = finite(v.debtToEquity); if (de !== undefined) parts.push(clamp(80 - de * 10)); const pe = finite(v.pe); if (pe !== undefined && pe > 0) parts.push(clamp(85 - pe * 1.5)); return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 50; }
function scoreNews(value: unknown): number { if (!Array.isArray(value) || value.length === 0) return 50; const scores = value.map((item) => { const sentiment = asRecord(item).sentiment; return sentiment === 'positive' ? 100 : sentiment === 'negative' ? 0 : 50; }); return scores.reduce((a, b) => a + b, 0) / scores.length; }
function scoreSector(value: unknown): number { const v = asRecord(value); const rs = finite(v.relativeStrength); const rank = finite(v.rank); const rsScore = rs === undefined ? 50 : clamp(50 + rs * 5); const rankScore = rank === undefined ? 50 : clamp(100 - rank); return rs === undefined && rank === undefined ? 50 : rs === undefined ? rankScore : rank === undefined ? rsScore : rsScore * .7 + rankScore * .3; }
function scoreRisk(value: unknown): number { const v = asRecord(value); const volatility = finite(v.volatility); const drawdown = finite(v.maxDrawdown); const rr = finite(v.riskReward); const parts: number[] = []; if (volatility !== undefined) parts.push(clamp(80 - volatility * 2)); if (drawdown !== undefined) parts.push(clamp(90 - Math.abs(drawdown) * 2)); if (rr !== undefined) parts.push(clamp(rr * 25)); return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 50; }
function trendScore(price: number | undefined, ...emas: Array<number | undefined>): number { if (price === undefined) return 50; const values = emas.filter((v): v is number => v !== undefined); return values.length ? values.filter((ema) => price >= ema).length / values.length * 100 : 50; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
