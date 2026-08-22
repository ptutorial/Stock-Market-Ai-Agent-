import type { FundamentalSnapshot, MarketDataProvider, MarketNewsItem, MarketQuote, OHLCVBar, RiskMetrics, SectorStrength, TechnicalIndicators } from './market-data.js';

export type DataSourceName = 'local_db' | 'yahoo' | string;
export type FreshnessStatus = 'fresh' | 'stale' | 'missing' | 'unknown';
export interface DataSourceMetadata { source: DataSourceName; fetchedAt: number; observedAt?: number; freshness: FreshnessStatus; }
export interface DataSourceResult<T> { data: T | null; metadata: DataSourceMetadata; }
export interface MarketDataSource {
  readonly name: DataSourceName;
  quote(symbol: string, exchange?: string): Promise<DataSourceResult<MarketQuote>>;
  history(symbol: string, timeframe: string, limit?: number, exchange?: string): Promise<DataSourceResult<OHLCVBar[]>>;
  technicals(symbol: string, timeframe?: string, exchange?: string): Promise<DataSourceResult<TechnicalIndicators>>;
  fundamentals(symbol: string, exchange?: string): Promise<DataSourceResult<FundamentalSnapshot>>;
  news(symbol: string, limit?: number): Promise<DataSourceResult<MarketNewsItem[]>>;
  sectorStrength(symbol: string, exchange?: string): Promise<DataSourceResult<SectorStrength>>;
  risk(symbol: string, exchange?: string): Promise<DataSourceResult<RiskMetrics>>;
}
export interface LocalDBExecutor {
  quote(symbol: string, exchange?: string): Promise<MarketQuote | null>;
  history(symbol: string, timeframe: string, limit?: number, exchange?: string): Promise<OHLCVBar[] | null>;
  technicals(symbol: string, timeframe?: string, exchange?: string): Promise<TechnicalIndicators | null>;
  fundamentals(symbol: string, exchange?: string): Promise<FundamentalSnapshot | null>;
  news(symbol: string, limit?: number): Promise<MarketNewsItem[] | null>;
  sectorStrength(symbol: string, exchange?: string): Promise<SectorStrength | null>;
  risk(symbol: string, exchange?: string): Promise<RiskMetrics | null>;
}
export interface LocalDBDataSourceOptions { executor: LocalDBExecutor; freshnessSeconds?: Partial<Record<'quote' | 'history' | 'technicals' | 'fundamentals' | 'news' | 'sectorStrength' | 'risk', number>>; clock?: () => number; }
function result<T>(source: DataSourceName, data: T | null, observedAt: number | undefined, now: number, maxAge?: number): DataSourceResult<T> {
  const freshness: FreshnessStatus = data === null ? 'missing' : observedAt === undefined || maxAge === undefined ? 'unknown' : now - observedAt <= maxAge * 1000 ? 'fresh' : 'stale';
  return { data, metadata: { source, fetchedAt: now, observedAt, freshness } };
}
function observedAtFrom<T extends { timestamp?: number; asOf?: number }>(data: T | null): number | undefined { return data?.timestamp ?? data?.asOf; }
export class LocalDBDataSource implements MarketDataSource {
  readonly name = 'local_db' as const;
  private readonly clock: () => number;
  private readonly freshnessSeconds: NonNullable<LocalDBDataSourceOptions['freshnessSeconds']>;
  constructor(private readonly options: LocalDBDataSourceOptions) { this.clock = options.clock ?? Date.now; this.freshnessSeconds = options.freshnessSeconds ?? {}; }
  async quote(symbol: string, exchange?: string) { const now = this.clock(); const data = await this.options.executor.quote(symbol, exchange); return result(this.name, data, observedAtFrom(data), now, this.freshnessSeconds.quote); }
  async history(symbol: string, timeframe: string, limit?: number, exchange?: string) { const now = this.clock(); const data = await this.options.executor.history(symbol, timeframe, limit, exchange); return result(this.name, data, data?.at(-1)?.timestamp, now, this.freshnessSeconds.history); }
  async technicals(symbol: string, timeframe?: string, exchange?: string) { const now = this.clock(); const data = await this.options.executor.technicals(symbol, timeframe, exchange); return result(this.name, data, observedAtFrom(data), now, this.freshnessSeconds.technicals); }
  async fundamentals(symbol: string, exchange?: string) { const now = this.clock(); const data = await this.options.executor.fundamentals(symbol, exchange); return result(this.name, data, observedAtFrom(data), now, this.freshnessSeconds.fundamentals); }
  async news(symbol: string, limit?: number) { const now = this.clock(); const data = await this.options.executor.news(symbol, limit); return result(this.name, data, data?.[0]?.publishedAt, now, this.freshnessSeconds.news); }
  async sectorStrength(symbol: string, exchange?: string) { const now = this.clock(); const data = await this.options.executor.sectorStrength(symbol, exchange); return result(this.name, data, observedAtFrom(data), now, this.freshnessSeconds.sectorStrength); }
  async risk(symbol: string, exchange?: string) { const now = this.clock(); const data = await this.options.executor.risk(symbol, exchange); return result(this.name, data, observedAtFrom(data), now, this.freshnessSeconds.risk); }
}
export interface DataSourceRouterOptions { sources: MarketDataSource[]; priority?: DataSourceName[]; fallbackOn?: FreshnessStatus[]; onFallback?: (event: { method: string; symbol: string; from: DataSourceName; to: DataSourceName; reason: FreshnessStatus }) => void; }
export class DataSourceRouter implements MarketDataProvider {
  private readonly sources: MarketDataSource[]; private readonly fallbackOn: Set<FreshnessStatus>; private readonly onFallback?: DataSourceRouterOptions['onFallback'];
  constructor(options: DataSourceRouterOptions) { if (!options.sources.length) throw new Error('At least one data source is required'); const byName = new Map(options.sources.map((source) => [source.name, source])); const ordered = (options.priority ?? options.sources.map((source) => source.name)).map((name) => byName.get(name)).filter((source): source is MarketDataSource => Boolean(source)); this.sources = [...ordered, ...options.sources.filter((source) => !ordered.includes(source))]; this.fallbackOn = new Set(options.fallbackOn ?? ['missing', 'stale']); this.onFallback = options.onFallback; }
  private async route<T>(method: string, symbol: string, call: (source: MarketDataSource) => Promise<DataSourceResult<T>>): Promise<T> {
    let previous: DataSourceName | undefined; let lastStatus: FreshnessStatus = 'missing'; let lastError: unknown;
    for (const source of this.sources) {
      try {
        const response = await call(source);
        if (response.data !== null && !this.fallbackOn.has(response.metadata.freshness)) return response.data as T;
        if (previous && previous !== source.name) this.onFallback?.({ method, symbol, from: previous, to: source.name, reason: lastStatus });
        previous = source.name; lastStatus = response.metadata.freshness;
      } catch (error) { lastError = error; if (previous && previous !== source.name) this.onFallback?.({ method, symbol, from: previous, to: source.name, reason: lastStatus }); previous = source.name; lastStatus = 'missing'; }
    }
    throw lastError instanceof Error ? lastError : new Error(`No usable ${method} data source available for ${symbol}`);
  }
  quote(symbol: string, exchange?: string): Promise<MarketQuote> { return this.route('quote', symbol, (s) => s.quote(symbol, exchange)); }
  history(symbol: string, timeframe: string, limit?: number, exchange?: string): Promise<OHLCVBar[]> { return this.route('history', symbol, (s) => s.history(symbol, timeframe, limit, exchange)); }
  technicals(symbol: string, timeframe?: string, exchange?: string): Promise<TechnicalIndicators> { return this.route('technicals', symbol, (s) => s.technicals(symbol, timeframe, exchange)); }
  fundamentals(symbol: string, exchange?: string): Promise<FundamentalSnapshot> { return this.route('fundamentals', symbol, (s) => s.fundamentals(symbol, exchange)); }
  news(symbol: string, limit?: number): Promise<MarketNewsItem[]> { return this.route('news', symbol, (s) => s.news(symbol, limit)); }
  sectorStrength(symbol: string, exchange?: string): Promise<SectorStrength> { return this.route('sectorStrength', symbol, (s) => s.sectorStrength(symbol, exchange)); }
  risk(symbol: string, exchange?: string): Promise<RiskMetrics> { return this.route('risk', symbol, (s) => s.risk(symbol, exchange)); }
}
