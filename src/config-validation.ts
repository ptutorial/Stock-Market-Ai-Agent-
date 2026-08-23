import type { AccountConfig, ProviderAdapter, ProviderName } from './domain.js';

export interface GatewayConfigValidationInput {
  accounts: AccountConfig[];
  adapters: ProviderAdapter[];
  providerOrder?: string[];
  fallbackProviders?: string[];
}

/** Validate static gateway configuration before any request reaches a provider. */
export function validateGatewayConfig(config: GatewayConfigValidationInput): void {
  if (!config.accounts.length) throw new Error('At least one gateway account is required');
  const adapters = new Set(config.adapters.map((adapter) => adapter.name));
  if (adapters.size !== config.adapters.length) throw new Error('Duplicate provider adapter configured');
  const accountIds = new Set<string>();
  for (const account of config.accounts) {
    if (!account.id.trim()) throw new Error('Account id must not be empty');
    if (accountIds.has(account.id)) throw new Error(`Duplicate account id ${account.id}`);
    accountIds.add(account.id);
    if (!adapters.has(account.provider)) throw new Error(`Account ${account.id} references provider ${account.provider} without an adapter`);
    if (!account.credentialRef.trim()) throw new Error(`Account ${account.id} has no credentialRef`);
    if (!account.models.length) throw new Error(`Account ${account.id} has no configured models`);
    if (!account.capabilities.length) throw new Error(`Account ${account.id} has no configured capabilities`);
    for (const value of [account.limits?.rpm, account.limits?.rpd, account.limits?.tpm, account.limits?.tpd]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Account ${account.id} has an invalid quota limit`);
    }
  }
  for (const provider of [...(config.providerOrder ?? []), ...(config.fallbackProviders ?? [])]) {
    if (!adapters.has(provider as ProviderName)) throw new Error(`Routing references unknown provider ${provider}`);
  }
}
