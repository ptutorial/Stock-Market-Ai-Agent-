import type { AccountConfig, GenerateOptions, GenerateResult, ProviderAdapter, RoutingStrategy, StreamChunk, TaskType } from './domain.js';
import { LLMGateway, type CredentialStore, type GatewayConfig, type UsageSink } from './gateway.js';

export interface GatewayClientOptions { accounts: AccountConfig[]; adapters: ProviderAdapter[]; credentialStore?: CredentialStore; usageSink?: UsageSink; strategy?: RoutingStrategy; fallbackProviders?: string[]; maxRetries?: number; cooldownMs?: number; }
export interface GenerateInput { task: TaskType; prompt: string; options?: GenerateOptions; }

export class GatewayClient {
  private readonly gateway: LLMGateway;
  constructor(options: GatewayClientOptions) {
    const config: GatewayConfig = { accounts: options.accounts, adapters: options.adapters, strategy: options.strategy, fallbackProviders: options.fallbackProviders, maxRetries: options.maxRetries, cooldownMs: options.cooldownMs };
    this.gateway = new LLMGateway(config, options.credentialStore, options.usageSink);
  }
  generate(input: GenerateInput): Promise<GenerateResult> { return this.gateway.generate(input.task, input.prompt, input.options); }
  stream(input: GenerateInput): AsyncIterable<StreamChunk> { return this.gateway.stream(input.task, input.prompt, input.options); }
}

export class GatewayClientBuilder {
  private accounts: AccountConfig[] = []; private adapters: ProviderAdapter[] = []; private credentialStore?: CredentialStore; private usageSink?: UsageSink; private strategy?: RoutingStrategy; private fallbackProviders?: string[]; private maxRetries?: number; private cooldownMs?: number;
  addAccount(account: AccountConfig): this { this.accounts.push(account); return this; }
  addAccounts(accounts: AccountConfig[]): this { this.accounts.push(...accounts); return this; }
  addAdapter(adapter: ProviderAdapter): this { this.adapters.push(adapter); return this; }
  addAdapters(adapters: ProviderAdapter[]): this { this.adapters.push(...adapters); return this; }
  credentialStore(store: CredentialStore): this { this.credentialStore = store; return this; }
  usageSink(sink: UsageSink): this { this.usageSink = sink; return this; }
  strategy(value: RoutingStrategy): this { this.strategy = value; return this; }
  fallbackProviders(value: string[]): this { this.fallbackProviders = [...value]; return this; }
  maxRetries(value: number): this { this.maxRetries = value; return this; }
  cooldownMs(value: number): this { this.cooldownMs = value; return this; }
  build(): GatewayClient {
    if (!this.accounts.length) throw new Error('At least one account is required');
    if (!this.adapters.length) throw new Error('At least one provider adapter is required');
    if (this.maxRetries !== undefined && (!Number.isInteger(this.maxRetries) || this.maxRetries < 0)) throw new Error('maxRetries must be a non-negative integer');
    if (this.cooldownMs !== undefined && (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0)) throw new Error('cooldownMs must be non-negative');
    return new GatewayClient({ accounts: [...this.accounts], adapters: [...this.adapters], credentialStore: this.credentialStore, usageSink: this.usageSink, strategy: this.strategy, fallbackProviders: this.fallbackProviders, maxRetries: this.maxRetries, cooldownMs: this.cooldownMs });
  }
}

export function createGatewayClient(options: GatewayClientOptions): GatewayClient { return new GatewayClient(options); }
export function gatewayClient(): GatewayClientBuilder { return new GatewayClientBuilder(); }
