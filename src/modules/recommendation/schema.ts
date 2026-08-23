export type RecommendationAction = 'BUY' | 'HOLD' | 'AVOID';

export interface ValidatedRecommendation {
  recommendation: RecommendationAction;
  confidence: number;
  scores: Record<string, number>;
  evidence: string[];
  risks: string[];
  invalidationConditions: string[];
  sourceProvenance: string[];
}

export function validateRecommendation(value: unknown): ValidatedRecommendation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Final recommendation must be an object');
  const input = value as Record<string, unknown>;
  const action = input.recommendation;
  if (action !== 'BUY' && action !== 'HOLD' && action !== 'AVOID') throw new Error('Recommendation must be BUY, HOLD, or AVOID');
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Confidence must be between 0 and 1');
  const objectMap = (name: string, max: number): Record<string, number> => {
    const raw = input[name];
    if (raw === undefined) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${name} must be an object`);
    const result: Record<string, number> = {};
    for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(item);
      if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${name}.${key} is out of range`);
      result[key] = n;
    }
    return result;
  };
  const strings = (name: string): string[] => {
    const raw = input[name];
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) throw new Error(`${name} must be an array of strings`);
    return [...raw] as string[];
  };
  return {
    recommendation: action,
    confidence,
    scores: objectMap('scores', 100),
    evidence: strings('evidence'),
    risks: strings('risks'),
    invalidationConditions: strings('invalidationConditions'),
    sourceProvenance: strings('sourceProvenance'),
  };
}
