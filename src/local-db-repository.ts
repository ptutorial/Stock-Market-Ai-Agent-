import type { FundamentalSnapshot, MarketNewsItem, MarketQuote, OHLCVBar } from './market-data.js';
import type { LocalDBExecutor } from './data-sources.js';

export interface SqlRow { [key: string]: unknown; }
export interface SqlExecutor { query<T extends SqlRow>(sql: string, params?: readonly unknown[]): Promise<T[]>; }
function number(value: unknown): number | undefined { if (value === null || value === undefined) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function requiredNumber(value: unknown, field: string): number { const parsed = number(value); if (parsed === undefined) throw new Error(`Invalid ${field} returned by local database`); return parsed; }
function timestamp(value: unknown): number { if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; if (value instanceof Date) return value.getTime(); const parsed = Date.parse(String(value)); if (!Number.isFinite(parsed)) throw new Error('Invalid timestamp returned by local database'); return parsed; }

export class SqlMarketDataRepository implements LocalDBExecutor {
  constructor(private readonly db: SqlExecutor) {}
  async quote(symbol: string, exchange = 'NSE'): Promise<MarketQuote | null> {
    const rows = await this.db.query('SELECT symbol, COALESCE(last, close) AS price, previous_close, total_traded_quantity, trade_date FROM stock_daily WHERE symbol = ? ORDER BY trade_date DESC LIMIT 1', [symbol]);
    const row = rows[0]; if (!row) return null; const price = requiredNumber(row.price, 'price'); const previous = number(row.previous_close);
    return { symbol: String(row.symbol ?? symbol), exchange, price, change: previous === undefined ? undefined : price - previous, changePercent: previous ? ((price - previous) / previous) * 100 : undefined, volume: number(row.total_traded_quantity), timestamp: timestamp(row.trade_date) };
  }
  async history(symbol: string, timeframe: string, limit = 100, _exchange?: string): Promise<OHLCVBar[] | null> {
    if (!['1d', 'day', 'daily'].includes(timeframe)) throw new Error(`Unsupported local history timeframe: ${timeframe}`);
    const rows = await this.db.query('SELECT trade_date, open, high, low, close, total_traded_quantity AS volume FROM stock_daily WHERE symbol = ? ORDER BY trade_date DESC LIMIT ?', [symbol, limit]);
    return rows.length ? rows.reverse().map((row) => ({ timestamp: timestamp(row.trade_date), open: requiredNumber(row.open, 'open'), high: requiredNumber(row.high, 'high'), low: requiredNumber(row.low, 'low'), close: requiredNumber(row.close, 'close'), volume: requiredNumber(row.volume, 'volume') })) : null;
  }
  async technicals(symbol: string, timeframe = '1d', _exchange?: string) {
    const rows = await this.db.query('SELECT symbol, trade_date, rsi_14, sma_20, sma_50, sma_200, volume_spike_ratio FROM stock_daily WHERE symbol = ? ORDER BY trade_date DESC LIMIT 1', [symbol]);
    const row = rows[0]; if (!row) return null;
    return { symbol: String(row.symbol ?? symbol), timeframe, asOf: timestamp(row.trade_date), rsi14: number(row.rsi_14), ema20: number(row.sma_20), ema50: number(row.sma_50), ema200: number(row.sma_200), volumeRatio: number(row.volume_spike_ratio) };
  }
  async fundamentals(symbol: string, _exchange?: string): Promise<FundamentalSnapshot | null> {
    const rows = await this.db.query('SELECT symbol, market_cap, trailing_pe, price_to_book, trailing_eps, revenue_growth, earnings_growth, debt_to_equity, return_on_equity, free_cashflow, updated_at FROM fundamentals WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1', [symbol]);
    const row = rows[0]; if (!row) return null;
    return { symbol: String(row.symbol ?? symbol), asOf: timestamp(row.updated_at ?? Date.now()), marketCap: number(row.market_cap), pe: number(row.trailing_pe), pb: number(row.price_to_book), eps: number(row.trailing_eps), revenueGrowth: number(row.revenue_growth), earningsGrowth: number(row.earnings_growth), debtToEquity: number(row.debt_to_equity), roe: number(row.return_on_equity), freeCashFlow: number(row.free_cashflow) };
  }
  async news(symbol: string, limit = 10): Promise<MarketNewsItem[] | null> {
    const rows = await this.db.query('SELECT id, source_name, title, url, published_at, sentiment_label FROM news_articles WHERE (stock_id_1 = ? OR stock_id_2 = ?) ORDER BY published_at DESC LIMIT ?', [symbol, symbol, limit]);
    return rows.length ? rows.map((row) => ({ id: String(row.id), symbol, publishedAt: timestamp(row.published_at), title: String(row.title), source: row.source_name == null ? undefined : String(row.source_name), url: row.url == null ? undefined : String(row.url), sentiment: row.sentiment_label === 'positive' || row.sentiment_label === 'negative' ? row.sentiment_label : 'neutral' })) : null;
  }
  async sectorStrength(symbol: string, _exchange?: string) {
    const rows = await this.db.query('SELECT symbol, sector, updated_at FROM fundamentals WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1', [symbol]);
    const row = rows[0]; if (!row) return null;
    return { symbol: String(row.symbol ?? symbol), sector: String(row.sector ?? 'Unknown'), asOf: timestamp(row.updated_at ?? Date.now()) };
  }
  async risk(symbol: string, _exchange?: string) {
    const rows = await this.db.query('SELECT symbol, beta, updated_at FROM fundamentals WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1', [symbol]);
    const row = rows[0]; if (!row) return null;
    return { symbol: String(row.symbol ?? symbol), asOf: timestamp(row.updated_at ?? Date.now()), beta: number(row.beta) };
  }
}
export function createLocalDBDataSource(db: SqlExecutor): LocalDBExecutor { return new SqlMarketDataRepository(db); }
