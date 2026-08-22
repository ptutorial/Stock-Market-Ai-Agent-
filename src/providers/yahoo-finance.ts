import type { FundamentalSnapshot, MarketDataProvider, MarketNewsItem, MarketQuote, OHLCVBar, RiskMetrics, SectorStrength, TechnicalIndicators } from '../market-data.js';
import type { DataSourceResult, MarketDataSource } from '../data-sources.js';

export interface YahooFinanceDataSourceOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clock?: () => number;
}

function yahooSymbol(symbol: string, exchange?: string): string {
  if (exchange?.toUpperCase() === 'NSE' && !symbol.includes('.')) return `${symbol}.NS`;
  if (exchange?.toUpperCase() === 'BSE' && !symbol.includes('.')) return `${symbol}.BO`;
  return symbol;
}

export class YahooFinanceDataSource implements MarketDataSource {
  readonly name = 'yahoo' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly clock: () => number;

  constructor(options: YahooFinanceDataSourceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://query1.finance.yahoo.com').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.clock = options.clock ?? Date.now;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Yahoo Finance returned HTTP ${response.status}`);
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private wrap<T>(data: T, observedAt?: number): DataSourceResult<T> {
    return {
      data,
      metadata: {
        source: this.name,
        fetchedAt: this.clock(),
        observedAt,
        freshness: 'unknown',
      },
    };
  }

  async quote(symbol: string, exchange?: string): Promise<DataSourceResult<MarketQuote>> {
    const ticker = yahooSymbol(symbol, exchange);
    const payload = await this.request<{ chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }>(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`);
    const meta = payload.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`Yahoo Finance quote unavailable for ${ticker}`);
    const price = Number(meta.regularMarketPrice ?? meta.previousClose);
    if (!Number.isFinite(price)) throw new Error(`Yahoo Finance returned no price for ${ticker}`);
    const timestamp = Number(meta.regularMarketTime ?? Math.floor(this.clock() / 1000)) * 1000;
    const previousClose = Number(meta.previousClose);
    const change = Number.isFinite(previousClose) ? price - previousClose : undefined;
    return this.wrap({ symbol, exchange: exchange ?? 'UNKNOWN', price, change, changePercent: Number.isFinite(previousClose) && previousClose !== 0 ? change! / previousClose * 100 : undefined, volume: Number(meta.regularMarketVolume), timestamp }, timestamp);
  }

  async history(symbol: string, timeframe: string, limit = 100, exchange?: string): Promise<DataSourceResult<OHLCVBar[]>> {
    const ticker = yahooSymbol(symbol, exchange);
    const interval = timeframe === '1d' || timeframe === 'daily' ? '1d' : timeframe === '1h' ? '1h' : '1d';
    const range = limit > 365 ? '5y' : limit > 180 ? '2y' : limit > 30 ? '1y' : '3mo';
    const payload = await this.request<{ chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number|null>; high?: Array<number|null>; low?: Array<number|null>; close?: Array<number|null>; volume?: Array<number|null> }> } }> } }>(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`);
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp || !quote) throw new Error(`Yahoo Finance history unavailable for ${ticker}`);
    const bars: OHLCVBar[] = result.timestamp.map((timestamp, i) => ({ timestamp: timestamp * 1000, open: Number(quote.open?.[i]), high: Number(quote.high?.[i]), low: Number(quote.low?.[i]), close: Number(quote.close?.[i]), volume: Number(quote.volume?.[i] ?? 0) })).filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)).slice(-limit);
    if (!bars.length) throw new Error(`Yahoo Finance returned no history for ${ticker}`);
    return this.wrap(bars, bars[bars.length - 1]?.timestamp);
  }

  async technicals(symbol: string, timeframe = '1d', exchange?: string): Promise<DataSourceResult<TechnicalIndicators>> {
    throw new Error(`Yahoo Finance technical indicators are not provided directly; calculate from history for ${symbol} (${timeframe}, ${exchange ?? 'UNKNOWN'})`);
  }

  async fundamentals(symbol: string, exchange?: string): Promise<DataSourceResult<FundamentalSnapshot>> {
    const ticker = yahooSymbol(symbol, exchange);
    const payload = await this.request<{ quoteSummary?: { result?: Array<{ summaryDetail?: Record<string, { raw?: number }>; defaultKeyStatistics?: Record<string, { raw?: number }>; financialData?: Record<string, { raw?: number }> }> } }>(`/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData`);
    const result = payload.quoteSummary?.result?.[0];
    if (!result) throw new Error(`Yahoo Finance fundamentals unavailable for ${ticker}`);
    const value = (group: Record<string, { raw?: number }> | undefined, key: string) => group?.[key]?.raw;
    return this.wrap({ symbol, asOf: this.clock(), marketCap: value(result.summaryDetail, 'marketCap'), pe: value(result.summaryDetail, 'trailingPE'), pb: value(result.defaultKeyStatistics, 'priceToBook'), eps: value(result.defaultKeyStatistics, 'trailingEps'), revenueGrowth: value(result.financialData, 'revenueGrowth'), earningsGrowth: value(result.financialData, 'earningsGrowth'), debtToEquity: value(result.financialData, 'debtToEquity'), roe: value(result.financialData, 'returnOnEquity'), freeCashFlow: value(result.financialData, 'freeCashflow') }, this.clock());
  }

  async news(symbol: string, limit = 10): Promise<DataSourceResult<MarketNewsItem[]>> {
    const ticker = yahooSymbol(symbol);
    const payload = await this.request<{ news?: Array<{ id?: string; title?: string; publisher?: string; link?: string; providerPublishTime?: number }> }>(`/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${Math.min(limit, 25)}`);
    const items = (payload.news ?? []).filter((item) => item.title).map((item, index) => ({ id: item.id ?? `${ticker}-${item.providerPublishTime ?? this.clock()}-${index}`, symbol, publishedAt: Number(item.providerPublishTime ?? Math.floor(this.clock() / 1000)) * 1000, title: item.title!, source: item.publisher, url: item.link }));
    return this.wrap(items, items[0]?.publishedAt);
  }

  async sectorStrength(symbol: string, exchange?: string): Promise<DataSourceResult<SectorStrength>> {
    throw new Error(`Yahoo Finance sector strength requires local market comparison data for ${symbol} (${exchange ?? 'UNKNOWN'})`);
  }

  async risk(symbol: string, exchange?: string): Promise<DataSourceResult<RiskMetrics>> {
    throw new Error(`Yahoo Finance risk metrics should be calculated from history for ${symbol} (${exchange ?? 'UNKNOWN'})`);
  }
}
