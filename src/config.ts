import type { AccountConfig, Capability, ProviderName } from './domain.js';
import { GatewayError } from './errors.js';
import { validateCredentialRef } from './security.js';

export interface ProviderConfig {
  name: ProviderName;
  enabled?: boolean;
  accounts: AccountConfig[];
}

export interface GatewayConfigFile {
  version: 1;
  strategy?: 'priority' | 'round_robin' | 'least_recently_used' | 'lowest_utilization' | 'fastest' | 'cheapest';
  maxRetries?: number;
  cooldownMs?: number;
  providers: ProviderConfig[];
}

const PROVIDERS: ProviderName[] = ['gemini', 'groq', 'openrouter', 'cloudflare'];
const CAPABILITIES: Capability[] = ['chat', 'streaming', 'structured_output', 'tool_calling', 'vision'];
const STRATEGIES = ['priority', 'round_robin', 'least_recently_used', 'lowest_utilization', 'fastest', 'cheapest'] as const;

function isProvider(value: string): value is ProviderName {
  return PROVIDERS.includes(value as ProviderName);
}

function isCapability(value: string): value is Capability {
  return CAPABILITIES.includes(value as Capability);
}

export function validateConfig(config: GatewayConfigFile): GatewayConfigFile {
  if (!config || typeof config !== 'object') throw new GatewayError('InvalidRequestError', 'Configuration must be an object');
  if (config.version !== 1) throw new GatewayError('InvalidRequestError', 'Unsupported configuration version');
  if (!Array.isArray(config.providers)) throw new GatewayError('InvalidRequestError', 'providers must be an array');
  if (config.strategy !== undefined && !STRATEGIES.includes(config.strategy)) throw new GatewayError('InvalidRequestError', `Unsupported routing strategy: ${config.strategy}`);
  if (config.maxRetries !== undefined && (!Number.isInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 10)) throw new GatewayError('InvalidRequestError', 'maxRetries must be an integer between 0 and 10');
  if (config.cooldownMs !== undefined && (!Number.isFinite(config.cooldownMs) || config.cooldownMs < 0 || config.cooldownMs > 86_400_000)) throw new GatewayError('InvalidRequestError', 'cooldownMs must be between 0 and 86400000');

  const accountIds = new Set<string>();
  for (const provider of config.providers) {
    if (!isProvider(provider.name)) throw new GatewayError('InvalidRequestError', `Unsupported provider: ${provider.name}`);
    if (!Array.isArray(provider.accounts)) throw new GatewayError('InvalidRequestError', `${provider.name}.accounts must be an array`);

    for (const account of provider.accounts) {
      if (account.provider !== provider.name) throw new GatewayError('InvalidRequestError', `Account ${account.id} provider does not match its parent provider`);
      if (!account.id || accountIds.has(account.id)) throw new GatewayError('InvalidRequestError', `Account id must be unique: ${account.id}`);
      accountIds.add(account.id);
      try { validateCredentialRef(account.credentialRef); } catch { throw new GatewayError('InvalidRequestError', `Invalid credentialRef for ${account.id}`); }
      if (!Array.isArray(account.models) || account.models.length === 0) throw new GatewayError('InvalidRequestError', `Account ${account.id} must define at least one model`);
      if (!Array.isArray(account.capabilities) || account.capabilities.length === 0 || !account.capabilities.every(isCapability)) throw new GatewayError('InvalidRequestError', `Invalid capabilities for ${account.id}`);
      if (account.priority !== undefined && (!Number.isFinite(account.priority) || account.priority < 0)) throw new GatewayError('InvalidRequestError', `Invalid priority for ${account.id}`);
      if (account.limits) for (const [name, value] of Object.entries(account.limits)) if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new GatewayError('InvalidRequestError', `Invalid ${name} limit for ${account.id}`);
    }
  }
  return config;
}

export function flattenAccounts(config: GatewayConfigFile): AccountConfig[] {
  return validateConfig(config).providers.filter((provider) => provider.enabled !== false).flatMap((provider) => provider.accounts.filter((account) => account.enabled !== false));
}

export function loadConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): GatewayConfigFile {
  const raw = env.LLM_GATEWAY_CONFIG;
  if (!raw) throw new GatewayError('InvalidRequestError', 'LLM_GATEWAY_CONFIG is not configured');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new GatewayError('InvalidRequestError', 'LLM_GATEWAY_CONFIG contains invalid JSON'); }
  return validateConfig(parsed as GatewayConfigFile);
}
