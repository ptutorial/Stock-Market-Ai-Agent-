import type { ToolDefinition } from './domain.js';
import type { ToolHandler } from './tools.js';
import type { MarketDataProvider } from './market-data.js';
import { optionalPositiveInteger, optionalString, requiredString } from './market-data.js';
import type { DataSourceRouter, RoutedData } from './data-sources.js';
import { getStockSnapshot } from './stock-snapshot.js';

const schema = (properties: Record<string, unknown>, required: string[] = ['symbol']) => ({ type: 'object', properties, required, additionalProperties: false });
function tool(name: string, description: string, inputSchema: Record<string, unknown>): ToolDefinition { return { name, description, inputSchema }; }

type StockDataProvider = MarketDataProvider | DataSourceRouter;

function isDataSourceRouter(provider: StockDataProvider): provider is DataSourceRouter {
  return typeof (provider as DataSourceRouter).quoteDetailed === 'function';
}

export function createStockTools(provider: StockDataProvider): ToolHandler[] {
  return [
    {
      definition: tool('market_price', 'Get the latest market quote for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.quoteDetailed(symbol, exchange) : provider.quote(symbol, exchange);
      },
    },
    {
      definition: tool('market_history', 'Get recent historical OHLCV bars for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, limit: { type: 'integer', minimum: 1, maximum: 5000, default: 100 }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const timeframe = optionalString(input, 'timeframe') ?? '1d';
        const limit = optionalPositiveInteger(input, 'limit') ?? 100;
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.historyDetailed(symbol, timeframe, limit, exchange) : provider.history(symbol, timeframe, limit, exchange);
      },
    },
    {
      definition: tool('technical_indicators', 'Get deterministic technical indicators for a symbol and timeframe.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const timeframe = optionalString(input, 'timeframe') ?? '1d';
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.technicalsDetailed(symbol, timeframe, exchange) : provider.technicals(symbol, timeframe, exchange);
      },
    },
    {
      definition: tool('fundamentals', 'Get the latest fundamental snapshot for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.fundamentalsDetailed(symbol, exchange) : provider.fundamentals(symbol, exchange);
      },
    },
    {
      definition: tool('market_news', 'Get recent news items for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const limit = optionalPositiveInteger(input, 'limit') ?? 10;
        return isDataSourceRouter(provider) ? provider.newsDetailed(symbol, limit) : provider.news(symbol, limit);
      },
    },
    {
      definition: tool('sector_strength', 'Get sector strength context for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.sectorStrengthDetailed(symbol, exchange) : provider.sectorStrength(symbol, exchange);
      },
    },
    {
      definition: tool('risk_metrics', 'Get deterministic risk metrics for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })),
      async execute(input) {
        const symbol = requiredString(input, 'symbol');
        const exchange = optionalString(input, 'exchange');
        return isDataSourceRouter(provider) ? provider.riskDetailed(symbol, exchange) : provider.risk(symbol, exchange);
      },
    },
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
