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

const DEFAULT_CAPABILITIES: Record<ProviderName, Capability[]> = {
  gemini: ['chat', 'streaming', 'structured_output', 'tool_calling', 'vision'],
  groq: ['chat', 'streaming', 'structured_output', 'tool_calling'],
  openrouter: ['chat', 'streaming', 'structured_output', 'tool_calling'],
  cloudflare: ['chat', 'streaming', 'structured_output', 'tool_calling'],
};

const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: 'gemini-flash-latest',
  groq: 'qwen/qwen3.6-27b',
  openrouter: 'openai/gpt-4o-mini',
  cloudflare: '@cf/meta/llama-3.1-8b-instruct-fp8',
};

const ENV_PREFIXES: Record<ProviderName, string[]> = {
  gemini: ['GEMINI_API_KEY_', 'GEMINI_ACCOUNT_'],
  groq: ['GROQ_API_KEY_', 'GROQ_ACCOUNT_'],
  openrouter: ['OPENROUTER_API_KEY_', 'OPENROUTER_ACCOUNT_'],
  cloudflare: ['CLOUDFLARE_API_TOKEN_', 'CLOUDFLARE_ACCOUNT_'],
};

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

function discoverCredentialRefs(env: NodeJS.ProcessEnv, provider: ProviderName): string[] {
  const matches = new Map<number, string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    for (const prefix of ENV_PREFIXES[provider]) {
      if (!name.startsWith(prefix)) continue;
      const suffix = name.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      const index = Number(suffix);
      if (index > 0) matches.set(index, name);
    }
  }
  return [...matches.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

function dynamicConfigFromEnvironment(env: NodeJS.ProcessEnv): GatewayConfigFile {
  const providers: ProviderConfig[] = PROVIDERS.map((provider) => {
    const credentialRefs = discoverCredentialRefs(env, provider);
    return {
      name: provider,
      enabled: credentialRefs.length > 0,
      accounts: credentialRefs.map((credentialRef, index) => ({
        id: `${provider}-account-${index + 1}`,
        provider,
        credentialRef,
        models: [DEFAULT_MODELS[provider]],
        capabilities: DEFAULT_CAPABILITIES[provider],
        priority: index + 1,
        enabled: true,
        ...(provider === 'cloudflare' && env.CLOUDFLARE_ACCOUNT_ID ? { metadata: { accountId: env.CLOUDFLARE_ACCOUNT_ID } } : {}),
      })),
    };
  }).filter((provider) => provider.accounts.length > 0);

  if (providers.length === 0) throw new GatewayError('InvalidRequestError', 'No dynamic LLM provider credentials are configured');

  return validateConfig({ version: 1, strategy: 'round_robin', maxRetries: 2, cooldownMs: 30_000, providers });
}

export function loadConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): GatewayConfigFile {
  const raw = env.LLM_GATEWAY_CONFIG;
  if (!raw) return dynamicConfigFromEnvironment(env);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new GatewayError('InvalidRequestError', 'LLM_GATEWAY_CONFIG contains invalid JSON'); }
  return validateConfig(parsed as GatewayConfigFile);
}
