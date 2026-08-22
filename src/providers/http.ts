import { GatewayError } from '../errors.js';
import type { GenerateRequest, StreamChunk, Usage } from '../domain.js';

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number;
}

function statusError(response: Response, detail = ''): GatewayError {
  const retryAfter = response.headers.get('retry-after');
  const retryAfterMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : undefined;
  const category = response.status === 429
    ? 'RateLimitError'
    : response.status === 401 || response.status === 403
      ? 'AuthenticationError'
      : response.status === 404
        ? 'ModelUnavailableError'
        : response.status >= 500
          ? 'ServerError'
          : 'InvalidRequestError';
  return new GatewayError(
    category,
    `Provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    response.status === 429 || response.status >= 500,
    retryAfterMs,
  );
}

export async function request(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal;
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    return await fetch(url, { ...options, signal: combined });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new GatewayError('TimeoutError', `Provider request timed out after ${options.timeoutMs}ms`, true);
    }
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('ProviderUnavailableError', 'Provider request failed', true);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readJson(response: Response): Promise<Record<string, any>> {
  if (!response.ok) {
    let detail = '';
    try { detail = JSON.stringify(await response.json()); } catch { try { detail = await response.text(); } catch { /* ignore */ } }
    throw statusError(response, detail);
  }
  try {
    return await response.json() as Record<string, any>;
  } catch {
    throw new GatewayError('ServerError', 'Provider returned invalid JSON', true);
  }
}

export function usageFromOpenAI(data: any, input?: number, output?: number): Usage {
  const u = data?.usage ?? {};
  return {
    inputTokens: u.prompt_tokens ?? u.input_tokens ?? input,
    outputTokens: u.completion_tokens ?? u.output_tokens ?? output,
    totalTokens: u.total_tokens ?? ((u.prompt_tokens ?? input ?? 0) + (u.completion_tokens ?? output ?? 0)),
  };
}

export function messages(request: GenerateRequest) {
  return request.messages?.length ? request.messages : [{ role: 'user', content: request.prompt }];
}

export async function streamSSE(response: Response): Promise<AsyncIterable<StreamChunk>> {
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    throw statusError(response, detail);
  }
  if (!response.body) throw new GatewayError('ProviderUnavailableError', 'Provider returned an empty streaming body', true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return (async function* () {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { yield { text: '', done: true }; continue; }
        try {
          const json = JSON.parse(payload);
          const text = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
          if (text) yield { text };
          if (json.usage) yield { text: '', usage: usageFromOpenAI(json) };
        } catch { /* Ignore non-JSON SSE keep-alives. */ }
      }
    }
    yield { text: '', done: true };
  })();
}
