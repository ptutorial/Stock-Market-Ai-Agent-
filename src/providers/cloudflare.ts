import type { AccountConfig, GenerateRequest, GenerateResult, ModelInfo, ProviderAdapter, StreamChunk } from '../domain.js';
import { GatewayError } from '../errors.js';
import { messages, readJson, request as httpRequest, streamSSE, usageFromOpenAI } from './http.js';

const TIMEOUT_MS = 30_000;

export class CloudflareWorkersAIAdapter implements ProviderAdapter {
  readonly name = 'cloudflare' as const;

  private endpoint(account: AccountConfig, model: string): string {
    const accountId = account.metadata?.accountId;
    if (!accountId) throw new GatewayError('AuthenticationError', `Cloudflare account ID is not configured for ${account.id}`);
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model.startsWith('@cf/') ? model : `@cf/${model}`}`;
  }

  private headers(credential: string) {
    return { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
  }

  async generate(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): Promise<GenerateResult> {
    const started = Date.now();
    const response = await httpRequest(this.endpoint(account, model.id), {
      method: 'POST',
      headers: { ...this.headers(credential), 'x-request-id': requestId },
      body: JSON.stringify({ messages: messages(request), max_tokens: request.options?.maxTokens, temperature: request.options?.temperature }),
      signal: request.options?.signal,
      timeoutMs: TIMEOUT_MS,
    });
    const data = await readJson(response);
    const result = data.result ?? {};
    return { text: result.response ?? result.output_text ?? '', provider: this.name, accountId: account.id, model: model.id, usage: usageFromOpenAI(result), requestId, latencyMs: Date.now() - started };
  }

  async *stream(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): AsyncIterable<StreamChunk> {
    const response = await httpRequest(this.endpoint(account, model.id), {
      method: 'POST',
      headers: { ...this.headers(credential), 'x-request-id': requestId },
      body: JSON.stringify({ messages: messages(request), stream: true, max_tokens: request.options?.maxTokens, temperature: request.options?.temperature }),
      signal: request.options?.signal,
      timeoutMs: TIMEOUT_MS,
    });
    yield* await streamSSE(response);
  }

  async discoverModels(account: AccountConfig, _credential: string): Promise<ModelInfo[]> {
    return account.models.map((id) => ({ id, provider: this.name, capabilities: account.capabilities, available: true }));
  }

  async healthCheck(account: AccountConfig, credential: string): Promise<boolean> {
    try {
      const response = await httpRequest(this.endpoint(account, account.models[0]), { method: 'POST', headers: this.headers(credential), body: JSON.stringify({ messages: [{ role: 'user', content: 'health check' }], max_tokens: 1 }), timeoutMs: TIMEOUT_MS });
      return response.ok;
    } catch { return false; }
  }
}
