import type { ToolDefinition } from '../../../domain.js';
import type { ToolHandler } from '../core.js';
import type { MarketDataProvider } from '../../../market-data.js';
import { optionalPositiveInteger, optionalString, requiredString } from '../../../market-data.js';
import type { DataSourceRouter } from '../../../data-sources.js';
import { getStockSnapshot } from '../../../stock-snapshot.js';

type StockDataProvider = MarketDataProvider | DataSourceRouter;
const schema = (properties: Record<string, unknown>, required: string[] = ['symbol']) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name: string, description: string, inputSchema: Record<string, unknown>): ToolDefinition => ({ name, description, inputSchema });
const isRouter = (provider: StockDataProvider): provider is DataSourceRouter => typeof (provider as DataSourceRouter).quoteDetailed === 'function';

export function createStockTools(provider: StockDataProvider): ToolHandler[] {
  return [
    { definition: tool('market_price', 'Get the latest market quote for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.quoteDetailed(s, e) : provider.quote(s, e); } },
    { definition: tool('market_history', 'Get recent historical OHLCV bars for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, limit: { type: 'integer', minimum: 1, maximum: 5000, default: 100 }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const t = optionalString(input, 'timeframe') ?? '1d'; const l = optionalPositiveInteger(input, 'limit') ?? 100; const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.historyDetailed(s, t, l, e) : provider.history(s, t, l, e); } },
    { definition: tool('technical_indicators', 'Get deterministic technical indicators for a symbol and timeframe.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const t = optionalString(input, 'timeframe') ?? '1d'; const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.technicalsDetailed(s, t, e) : provider.technicals(s, t, e); } },
    { definition: tool('fundamentals', 'Get the latest fundamental snapshot for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.fundamentalsDetailed(s, e) : provider.fundamentals(s, e); } },
    { definition: tool('market_news', 'Get recent news items for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }})), async execute(input) { const s = requiredString(input, 'symbol'); const l = optionalPositiveInteger(input, 'limit') ?? 10; return isRouter(provider) ? provider.newsDetailed(s, l) : provider.news(s, l); } },
    { definition: tool('sector_strength', 'Get sector strength context for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.sectorStrengthDetailed(s, e) : provider.sectorStrength(s, e); } },
    { definition: tool('risk_metrics', 'Get deterministic risk metrics for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' }})), async execute(input) { const s = requiredString(input, 'symbol'); const e = optionalString(input, 'exchange'); return isRouter(provider) ? provider.riskDetailed(s, e) : provider.risk(s, e); } },
  ];
}

export function createStockSnapshotTool(router: DataSourceRouter): ToolHandler {
  return {
    definition: tool(
      'stock_snapshot',
      'Build a source-aware evidence snapshot for a stock, including quote, history, technicals, fundamentals, news, sector and risk data.',
      schema({
        symbol: { type: 'string', minLength: 1 },
        exchange: { type: 'string', default: 'NSE' },
        timeframe: { type: 'string', default: '1d' },
        historyLimit: { type: 'integer', minimum: 1, maximum: 5000, default: 100 },
        newsLimit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      }),
    ),
    async execute(input) {
      return getStockSnapshot(
        router,
        requiredString(input, 'symbol'),
        optionalString(input, 'exchange') ?? 'NSE',
        {
          timeframe: optionalString(input, 'timeframe') ?? '1d',
          historyLimit: optionalPositiveInteger(input, 'historyLimit') ?? 100,
          newsLimit: optionalPositiveInteger(input, 'newsLimit') ?? 10,
        },
      );
    },
  };
}
