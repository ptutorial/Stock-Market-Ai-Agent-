import type { AccountConfig, Capability, GenerateRequest, GenerateResult, ModelInfo, ProviderAdapter, StreamChunk, ToolCall, Usage } from '../domain.js';
import { GatewayError } from '../errors.js';
import { readJson, request as httpRequest } from './http.js';

const TIMEOUT_MS = 30_000;
const ALL_CAPABILITIES: Capability[] = ['chat', 'streaming', 'structured_output', 'tool_calling', 'vision'];

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;

  private url(model: string, action: 'generateContent' | 'streamGenerateContent' | 'listModels') {
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    return action === 'listModels' ? `${base}/models` : `${base}/models/${model}:${action}`;
  }

  private configuredCapabilities(account: AccountConfig): Capability[] {
    const configured = account.metadata?.modelCapabilities;
    if (!configured) return (['chat', 'streaming'] as Capability[]).filter((capability) => account.capabilities.includes(capability));
    try {
      const parsed = JSON.parse(configured) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is Capability => typeof value === 'string' && ALL_CAPABILITIES.includes(value as Capability) && account.capabilities.includes(value as Capability));
    } catch {
      throw new GatewayError('InvalidRequestError', 'Gemini modelCapabilities metadata must be valid JSON');
    }
  }

  private body(request: GenerateRequest) {
    const messages = request.messages?.length ? request.messages : [{ role: 'user' as const, content: request.prompt }];
    const system = messages.find((message) => message.role === 'system');
    const conversational = messages.filter((message) => message.role !== 'system');
    if (conversational.some((message) => message.role === 'tool')) throw new GatewayError('InvalidRequestError', 'Gemini tool-result messages require a function name, which the common message contract does not currently carry');
    const contents = conversational.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const options = request.options;
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
      contents,
      generationConfig: { temperature: options?.temperature, maxOutputTokens: options?.maxTokens, responseMimeType: options?.jsonSchema ? 'application/json' : undefined, responseSchema: options?.jsonSchema },
      ...(options?.tools?.length ? { tools: [{ functionDeclarations: options.tools }] } : {}),
    };
  }

  private async send(account: AccountConfig, credential: string, model: string, request: GenerateRequest, stream = false): Promise<Response> {
    const url = `${this.url(model, stream ? 'streamGenerateContent' : 'generateContent')}${stream ? '?alt=sse' : ''}`;
    const response = await httpRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': credential }, body: JSON.stringify(this.body(request)), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw new GatewayError(response.status === 429 ? 'RateLimitError' : response.status >= 500 ? 'ServerError' : response.status === 401 || response.status === 403 ? 'AuthenticationError' : 'InvalidRequestError', `Gemini request failed with HTTP ${response.status}`, Boolean(retryAfter), retryAfter ? Number(retryAfter) * 1000 : undefined);
    }
    return response;
  }

  async generate(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): Promise<GenerateResult> {
    const started = Date.now();
    const response = await this.send(account, credential, model.id, request);
    const data = await readJson(response) as Record<string, any>;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts.filter((part: any) => typeof part.text === 'string').map((part: any) => part.text).join('');
    const toolCalls: ToolCall[] = parts.filter((part: any) => part.functionCall).map((part: any) => ({ id: part.functionCall.name, name: part.functionCall.name, arguments: part.functionCall.args ?? {} }));
    const usage: Usage = data.usageMetadata ? { inputTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount, totalTokens: data.usageMetadata.totalTokenCount } : {};
    return { text, provider: this.name, accountId: account.id, model: model.id, usage, requestId, latencyMs: Date.now() - started, ...(toolCalls.length ? { toolCalls } : {}) };
  }

  async *stream(account: AccountConfig, request: GenerateRequest, model: ModelInfo, credential: string, requestId: string): AsyncIterable<StreamChunk> {
    const response = await this.send(account, credential, model.id, request, true);
    const reader = response.body?.getReader();
    if (!reader) throw new GatewayError('ServerError', 'Gemini returned an empty streaming response');
    const decoder = new TextDecoder(); let buffer = ''; let usage: Usage | undefined;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim(); if (!payload) continue;
          const data = JSON.parse(payload) as any;
          const parts = data.candidates?.[0]?.content?.parts ?? [];
          const text = parts.filter((part: any) => typeof part.text === 'string').map((part: any) => part.text).join('');
          if (data.usageMetadata) usage = { inputTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount, totalTokens: data.usageMetadata.totalTokenCount };
          const toolCalls: ToolCall[] = parts.filter((part: any) => part.functionCall).map((part: any) => ({ id: part.functionCall.name, name: part.functionCall.name, arguments: part.functionCall.args ?? {} }));
          if (text || toolCalls.length) yield { text, ...(toolCalls.length ? { toolCalls } : {}), ...(usage ? { usage } : {}) };
        }
      }
      yield { text: '', done: true, ...(usage ? { usage } : {}) };
    } finally { reader.releaseLock(); }
  }

  async discoverModels(account: AccountConfig, credential: string): Promise<ModelInfo[]> {
    const response = await httpRequest(this.url('', 'listModels'), { headers: { 'x-goog-api-key': credential }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new GatewayError(response.status === 429 ? 'RateLimitError' : response.status === 401 || response.status === 403 ? 'AuthenticationError' : 'ServerError', `Gemini model discovery failed with HTTP ${response.status}`);
    const data = await readJson(response) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const capabilities = this.configuredCapabilities(account);
    return (data.models ?? []).filter((m) => m.name?.startsWith('models/')).map((m) => {
      const supported = m.supportedGenerationMethods ?? [];
      const modelCapabilities = capabilities.filter((capability) => capability === 'chat' ? supported.includes('generateContent') : capability === 'streaming' ? supported.includes('streamGenerateContent') : capability === 'structured_output' ? supported.includes('generateContent') : capability === 'tool_calling' ? supported.includes('generateContent') : capability === 'vision' ? false : false);
      return { id: m.name!.replace(/^models\//, ''), provider: this.name, capabilities: modelCapabilities, available: true };
    });
  }

  async healthCheck(account: AccountConfig, credential: string): Promise<boolean> { try { await this.discoverModels(account, credential); return true; } catch { return false; } }
}
