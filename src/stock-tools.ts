import type { ToolDefinition } from './domain.js';
import type { ToolHandler } from './tools.js';
import type { MarketDataProvider } from './market-data.js';
import { optionalPositiveInteger, optionalString, requiredString } from './market-data.js';

const schema = (properties: Record<string, unknown>, required: string[] = ['symbol']) => ({ type: 'object', properties, required, additionalProperties: false });
function tool(name: string, description: string, inputSchema: Record<string, unknown>): ToolDefinition { return { name, description, inputSchema }; }

export function createStockTools(provider: MarketDataProvider): ToolHandler[] {
  return [
    { definition: tool('market_price', 'Get the latest market quote for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })), async execute(input) { return provider.quote(requiredString(input, 'symbol'), optionalString(input, 'exchange')); } },
    { definition: tool('market_history', 'Get recent historical OHLCV bars for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, limit: { type: 'integer', minimum: 1, maximum: 5000, default: 100 }, exchange: { type: 'string' } })), async execute(input) { return provider.history(requiredString(input, 'symbol'), optionalString(input, 'timeframe') ?? '1d', optionalPositiveInteger(input, 'limit') ?? 100, optionalString(input, 'exchange')); } },
    { definition: tool('technical_indicators', 'Get deterministic technical indicators for a symbol and timeframe.', schema({ symbol: { type: 'string', minLength: 1 }, timeframe: { type: 'string', default: '1d' }, exchange: { type: 'string' } })), async execute(input) { return provider.technicals(requiredString(input, 'symbol'), optionalString(input, 'timeframe') ?? '1d', optionalString(input, 'exchange')); } },
    { definition: tool('fundamentals', 'Get the latest fundamental snapshot for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })), async execute(input) { return provider.fundamentals(requiredString(input, 'symbol'), optionalString(input, 'exchange')); } },
    { definition: tool('market_news', 'Get recent news items for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 } })), async execute(input) { return provider.news(requiredString(input, 'symbol'), optionalPositiveInteger(input, 'limit') ?? 10); } },
    { definition: tool('sector_strength', 'Get sector strength context for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })), async execute(input) { return provider.sectorStrength(requiredString(input, 'symbol'), optionalString(input, 'exchange')); } },
    { definition: tool('risk_metrics', 'Get deterministic risk metrics for a symbol.', schema({ symbol: { type: 'string', minLength: 1 }, exchange: { type: 'string' } })), async execute(input) { return provider.risk(requiredString(input, 'symbol'), optionalString(input, 'exchange')); } },
  ];
}
