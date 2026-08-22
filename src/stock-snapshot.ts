import type { DataSourceMetadata, DataSourceRouter, RoutedData } from './data-sources.js';
import type { FundamentalSnapshot, MarketNewsItem, MarketQuote, OHLCVBar, RiskMetrics, SectorStrength, TechnicalIndicators } from './market-data.js';

export interface StockSnapshot {
  symbol: string;
  exchange: string;
  quote: RoutedData<MarketQuote>;
  history: RoutedData<OHLCVBar[]>;
  technicals: RoutedData<TechnicalIndicators>;
  fundamentals: RoutedData<FundamentalSnapshot>;
  news: RoutedData<MarketNewsItem[]>;
  sector: RoutedData<SectorStrength>;
  risk: RoutedData<RiskMetrics>;
  sources: DataSourceMetadata[];
  generatedAt: number;
}

export interface StockSnapshotOptions {
  timeframe?: string;
  historyLimit?: number;
  newsLimit?: number;
  clock?: () => number;
}

export async function getStockSnapshot(
  router: DataSourceRouter,
  symbol: string,
  exchange = 'NSE',
  options: StockSnapshotOptions = {},
): Promise<StockSnapshot> {
  const timeframe = options.timeframe ?? '1d';
  const historyLimit = options.historyLimit ?? 100;
  const newsLimit = options.newsLimit ?? 10;

  const [quote, history, technicals, fundamentals, news, sector, risk] = await Promise.all([
    router.quoteDetailed(symbol, exchange),
    router.historyDetailed(symbol, timeframe, historyLimit, exchange),
    router.technicalsDetailed(symbol, timeframe, exchange),
    router.fundamentalsDetailed(symbol, exchange),
    router.newsDetailed(symbol, newsLimit),
    router.sectorStrengthDetailed(symbol, exchange),
    router.riskDetailed(symbol, exchange),
  ]);

  return {
    symbol,
    exchange,
    quote,
    history,
    technicals,
    fundamentals,
    news,
    sector,
    risk,
    sources: [quote, history, technicals, fundamentals, news, sector, risk].map((item) => item.metadata),
    generatedAt: (options.clock ?? Date.now)(),
  };
}
