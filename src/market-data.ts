export interface OHLCVBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketQuote {
  symbol: string;
  exchange: string;
  price: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  timestamp: number;
}

export interface TechnicalIndicators {
  symbol: string;
  timeframe: string;
  asOf: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  atr14?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  volumeRatio?: number;
  support?: number;
  resistance?: number;
}

export interface FundamentalSnapshot {
  symbol: string;
  asOf: number;
  marketCap?: number;
  pe?: number;
  pb?: number;
  eps?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  debtToEquity?: number;
  roe?: number;
  freeCashFlow?: number;
}

export interface MarketNewsItem {
  id: string;
  symbol?: string;
  publishedAt: number;
  title: string;
  source?: string;
  url?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

export interface SectorStrength {
  symbol: string;
  sector: string;
  asOf: number;
  relativeStrength?: number;
  sectorChangePercent?: number;
  marketChangePercent?: number;
  rank?: number;
}

export interface RiskMetrics {
  symbol: string;
  asOf: number;
  volatility?: number;
  atrPercent?: number;
  maxDrawdown?: number;
  beta?: number;
  riskReward?: number;
  stopLoss?: number;
  target?: number;
}

export interface MarketDataProvider {
  quote(symbol: string, exchange?: string): Promise<MarketQuote>;
  history(symbol: string, timeframe: string, limit?: number, exchange?: string): Promise<OHLCVBar[]>;
  technicals(symbol: string, timeframe?: string, exchange?: string): Promise<TechnicalIndicators>;
  fundamentals(symbol: string, exchange?: string): Promise<FundamentalSnapshot>;
  news(symbol: string, limit?: number): Promise<MarketNewsItem[]>;
  sectorStrength(symbol: string, exchange?: string): Promise<SectorStrength>;
  risk(symbol: string, exchange?: string): Promise<RiskMetrics>;
}

export function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalPositiveInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${key} must be a positive integer`);
  return value as number;
}
