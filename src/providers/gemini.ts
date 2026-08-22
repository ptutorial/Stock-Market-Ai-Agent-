import type { AccountConfig, GenerateRequest, GenerateResult, ModelInfo, ProviderAdapter, StreamChunk, ToolCall } from '../domain.js';
import { GatewayError } from '../errors.js';
import { readJson, request as httpRequest } from './http.js';

const TIMEOUT_MS = 30_000;

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;

  private url(model: string, action: 'generateContent' | 'streamGenerateContent' | 'listModels') {
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    return action === 'listModels' ? `${base}/models` : `${base}/models/${model}:${action}`;
  }

  private body(request: GenerateRequest) {
    const contents = (request.messages?.length ? request.messages : [{ role: 'user' as const, content: request.prompt }])
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const options = request.options;
    return {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        responseMimeType: options?.jsonSchema ? 'application/json' : undefined,
        responseSchema: options?.jsonSchema,
      },
      tools: options?.tools?.length
        ? [{ functionDeclarations: options.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }]
        : undefined,
    };
  }

  private extractCandidate(data: any): { text: string; toolCalls?: ToolCall[] } {
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part: any) => part.text ?? '').join('');
    const toolCalls = parts.filter((part: any) => part.functionCall).map((part: any) => ({ name: String(part.functionCall.name), arguments: (part.functionCall.args ?? {}) as Record<string, unknown> }));
    return { text, ...(toolCalls.length ? { toolCalls } : {}) };
  }

  async generate(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): Promise<GenerateResult> {
    const started = Date.now();
    const response = await httpRequest(`${this.url(model.id, 'generateContent')}?key=${encodeURIComponent(credential)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify(this.body(request)),
      signal: request.options?.signal,
      timeoutMs: TIMEOUT_MS,
    });
    const data = await readJson(response);
    const usage = data.usageMetadata ?? {};
    const result = this.extractCandidate(data);
    return { ...result, provider: this.name, accountId: account.id, model: model.id, usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, totalTokens: usage.totalTokenCount }, requestId, latencyMs: Date.now() - started };
  }

  async *stream(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): AsyncIterable<StreamChunk> {
    const response = await httpRequest(`${this.url(model.id, 'streamGenerateContent')}?alt=sse&key=${encodeURIComponent(credential)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify(this.body(request)),
      signal: request.options?.signal,
      timeoutMs: TIMEOUT_MS,
    });
    if (!response.ok || !response.body) throw new GatewayError(response.status === 429 ? 'RateLimitError' : 'ProviderUnavailableError', `Gemini streaming request failed with HTTP ${response.status}`, response.status === 429 || response.status >= 500);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try { const result = this.extractCandidate(JSON.parse(line.slice(5))); if (result.text) yield { text: result.text }; } catch { /* Ignore SSE keep-alives. */ }
      }
    }
    yield { text: '', done: true };
  }

  async discoverModels(account: AccountConfig, credential: string): Promise<ModelInfo[]> {
    const response = await httpRequest(`${this.url('', 'listModels')}?key=${encodeURIComponent(credential)}`, { timeoutMs: TIMEOUT_MS });
    const data = await readJson(response);
    return (data.models ?? []).map((m: any) => ({ id: String(m.name ?? '').replace(/^models\//, ''), provider: this.name, capabilities: account.capabilities, contextWindow: m.inputTokenLimit, available: true, metadata: m })).filter((m: ModelInfo) => Boolean(m.id));
  }

  async healthCheck(account: AccountConfig, credential: string): Promise<boolean> {
    try { await this.discoverModels(account, credential); return true; } catch { return false; }
  }
}
