import type { AccountConfig, GenerateRequest, GenerateResult, ModelInfo, ProviderAdapter, StreamChunk } from '../domain.js';
import { GatewayError } from '../errors.js';
import { readJson } from './http.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;
  private url(model: string, action: 'generateContent' | 'streamGenerateContent' | 'listModels') {
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    return action === 'listModels' ? `${base}/models` : `${base}/models/${model}:${action}`;
  }
  private body(request: GenerateRequest) {
    const contents = (request.messages?.length ? request.messages : [{ role: 'user', content: request.prompt }]).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    return { contents, generationConfig: { temperature: request.options?.temperature, maxOutputTokens: request.options?.maxTokens, responseMimeType: request.options?.jsonSchema ? 'application/json' : undefined, responseSchema: request.options?.jsonSchema } };
  }
  async generate(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): Promise<GenerateResult> {
    const started = Date.now();
    const response = await fetch(`${this.url(model.id, 'generateContent')}?key=${encodeURIComponent(credential)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: JSON.stringify(this.body(request)), signal: request.options?.signal });
    const data = await readJson(response);
    const usage = data.usageMetadata ?? {};
    return { text: data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '', provider: this.name, accountId: account.id, model: model.id, usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, totalTokens: usage.totalTokenCount }, requestId, latencyMs: Date.now() - started };
  }
  async *stream(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.url(model.id, 'streamGenerateContent')}?alt=sse&key=${encodeURIComponent(credential)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: JSON.stringify(this.body(request)), signal: request.options?.signal });
    if (!response.ok || !response.body) throw new GatewayError(response.status === 429 ? 'RateLimitError' : 'ProviderUnavailableError', `Gemini streaming request failed with HTTP ${response.status}`, response.status === 429 || response.status >= 500);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('data:')) { try { const data = JSON.parse(line.slice(5)); const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''; if (text) yield { text }; } catch { /* ignore keep-alive */ } }
    }
    yield { text: '', done: true };
  }
  async discoverModels(account: AccountConfig, credential: string): Promise<ModelInfo[]> {
    const response = await fetch(`${this.url('', 'listModels')}?key=${encodeURIComponent(credential)}`);
    const data = await readJson(response);
    return (data.models ?? []).map((m: any) => ({ id: String(m.name ?? '').replace(/^models\//, ''), provider: this.name, capabilities: account.capabilities, contextWindow: m.inputTokenLimit, available: true, metadata: m })).filter((m: ModelInfo) => Boolean(m.id));
  }
  async healthCheck(account: AccountConfig, credential: string): Promise<boolean> { try { await this.discoverModels(account, credential); return true; } catch { return false; } }
}
