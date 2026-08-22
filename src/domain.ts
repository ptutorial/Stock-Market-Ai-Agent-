export type ProviderName = 'gemini' | 'groq' | 'openrouter' | 'cloudflare';

export type Capability =
  | 'chat'
  | 'streaming'
  | 'structured_output'
  | 'tool_calling'
  | 'vision';

export type TaskType =
  | 'coding'
  | 'general'
  | 'reasoning'
  | 'fast'
  | 'cheap'
  | 'long_context'
  | 'vision'
  | 'structured_output';

export type RoutingStrategy =
  | 'priority'
  | 'round_robin'
  | 'least_recently_used'
  | 'lowest_utilization'
  | 'fastest'
  | 'cheapest';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GenerateOptions {
  model?: string;
  task?: TaskType;
  capabilities?: Capability[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface GenerateRequest {
  prompt: string;
  messages?: LLMMessage[];
  options?: GenerateOptions;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
}

export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
  provider: ProviderName;
  accountId: string;
  model: string;
  usage: Usage;
  requestId: string;
  latencyMs: number;
}

export interface StreamChunk {
  text: string;
  done?: boolean;
  usage?: Usage;
}

export interface ModelInfo {
  id: string;
  provider: ProviderName;
  displayName?: string;
  capabilities: Capability[];
  contextWindow?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  available?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ProviderCapabilities {
  capabilities: Set<Capability>;
}

export interface AccountLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
}

export interface AccountConfig {
  id: string;
  provider: ProviderName;
  credentialRef: string;
  models: string[];
  capabilities: Capability[];
  priority?: number;
  enabled?: boolean;
  limits?: AccountLimits;
  costPerMillionInput?: number;
  costPerMillionOutput?: number;
}

export type AccountHealth =
  | 'healthy'
  | 'degraded'
  | 'rate_limited'
  | 'authentication_failure'
  | 'temporarily_unavailable'
  | 'disabled';

export interface AccountState {
  requests: number;
  tokens: number;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  failures: number;
  cooldownUntil?: number;
  health: AccountHealth;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  generate(
    account: AccountConfig,
    request: GenerateRequest,
    model: ModelInfo,
    credential: string,
    requestId: string,
  ): Promise<GenerateResult>;
  stream(
    account: AccountConfig,
    request: GenerateRequest,
    model: ModelInfo,
    credential: string,
    requestId: string,
  ): AsyncIterable<StreamChunk>;
  discoverModels(account: AccountConfig, credential: string): Promise<ModelInfo[]>;
  healthCheck(account: AccountConfig, credential: string): Promise<boolean>;
}

export interface RoutingCandidate {
  account: AccountConfig;
  state: AccountState;
  adapter: ProviderAdapter;
  model: ModelInfo;
  score: number;
}
