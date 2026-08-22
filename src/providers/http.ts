import { GatewayError } from '../errors.js';
import type { GenerateRequest, StreamChunk, Usage } from '../types.js';

export async function readJson(response: Response): Promise<Record<string, any>> {
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    let detail = '';
    try { detail = JSON.stringify(await response.json()); } catch { detail = await response.text(); }
    const error = new GatewayError(response.status === 429 ? 'RateLimitError' : response.status >= 500 ? 'ServerError' : response.status === 401 || response.status === 403 ? 'AuthenticationError' : response.status === 404 ? 'ModelUnavailableError' : 'InvalidRequestError', `Provider returned HTTP ${response.status}`, response.status === 429 || response.status >= 500, retryAfter ? Number(retryAfter) * 1000 : undefined);
    throw new GatewayError(error.category, `${error.message}: ${detail.slice(0, 500)}`, error.retryable, error.retryAfterMs);
  }
  return response.json();
}

export function usageFromOpenAI(data: any, input?: number, output?: number): Usage {
  const u = data?.usage ?? {};
  return { inputTokens: u.prompt_tokens ?? u.input_tokens ?? input, outputTokens: u.completion_tokens ?? u.output_tokens ?? output, totalTokens: u.total_tokens ?? ((u.prompt_tokens ?? input ?? 0) + (u.completion_tokens ?? output ?? 0)) };
}

export function messages(request: GenerateRequest) {
  return request.messages?.length ? request.messages : [{ role: 'user', content: request.prompt }];
}

export async function streamSSE(response: Response): Promise<AsyncIterable<StreamChunk>> {
  if (!response.ok || !response.body) throw new GatewayError('ProviderUnavailableError', `Streaming request failed with HTTP ${response.status}`, response.status >= 500);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return (async function* () {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
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
