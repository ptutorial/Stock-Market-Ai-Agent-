import type { AccountConfig, GenerateRequest, GenerateResult, ProviderAdapter, StreamChunk } from '../types.js';
import { readJson, messages, streamSSE, usageFromOpenAI } from './http.js';

export abstract class OpenAICompatibleAdapter implements ProviderAdapter {
  abstract readonly name: 'groq' | 'openrouter';
  protected abstract endpoint(account: AccountConfig): string;
  protected headers(credential: string): Record<string, string> { return { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }; }
  protected requestBody(request: GenerateRequest, model: string, stream = false) {
    return { model, messages: messages(request), temperature: request.options?.temperature, max_tokens: request.options?.maxTokens, stream, tools: request.options?.tools?.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), response_format: request.options?.jsonSchema ? { type: 'json_schema', json_schema: request.options.jsonSchema } : undefined };
  }
  async generate(account: AccountConfig, request: GenerateRequest, model: string, credential: string, requestId: string): Promise<GenerateResult> {
    const started = Date.now();
    const response = await fetch(this.endpoint(account), { method: 'POST', headers: { ...this.headers(credential), 'x-request-id': requestId }, body: JSON.stringify(this.requestBody(request, model)) , signal: request.options?.signal });
    const data = await readJson(response);
    return { text: data.choices?.[0]?.message?.content ?? '', provider: this.name, accountId: account.id, model, usage: usageFromOpenAI(data), requestId, latencyMs: Date.now() - started };
  }
  async *stream(account: AccountConfig, request: GenerateRequest, model: string, credential: string, requestId: string): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint(account), { method: 'POST', headers: { ...this.headers(credential), 'x-request-id': requestId }, body: JSON.stringify(this.requestBody(request, model, true)), signal: request.options?.signal });
    const stream = await streamSSE(response);
    yield* stream;
  }
  async discoverModels(account: AccountConfig, credential: string): Promise<string[]> {
    const response = await fetch(this.endpoint(account).replace(/\/chat\/completions$/, '/models'), { headers: this.headers(credential) });
    const data = await readJson(response);
    return (data.data ?? []).map((m: any) => m.id).filter(Boolean);
  }
  async healthCheck(account: AccountConfig, credential: string): Promise<boolean> {
    try { await this.discoverModels(account, credential); return true; } catch { return false; }
  }
}

export class GroqAdapter extends OpenAICompatibleAdapter {
  readonly name = 'groq' as const;
  protected endpoint(): string { return 'https://api.groq.com/openai/v1/chat/completions'; }
}

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  readonly name = 'openrouter' as const;
  protected endpoint(): string { return 'https://openrouter.ai/api/v1/chat/completions'; }
  protected headers(credential: string) { return { ...super.headers(credential), 'http-referer': process.env.OPENROUTER_HTTP_REFERER ?? '', 'x-title': process.env.OPENROUTER_APP_NAME ?? 'LLM Gateway' }; }
}
