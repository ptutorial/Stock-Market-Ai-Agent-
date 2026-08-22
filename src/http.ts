import { randomUUID } from 'node:crypto';
import type { GenerateOptions, StreamChunk, TaskType } from './domain.js';
import { GatewayError } from './errors.js';
import { GatewayClient, type GatewayClientOptions } from './sdk.js';

export interface GatewayHttpRequest { method: string; path: string; body?: unknown; headers?: Record<string, string | undefined>; }
export interface GatewayHttpResponse { status: number; headers: Record<string, string>; body: unknown; }
export interface GatewayHttpServerOptions extends GatewayClientOptions { maxBodyBytes?: number; apiKey?: string; }

export function createGatewayHttpHandler(options: GatewayHttpServerOptions) {
  const client = new GatewayClient(options);
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  return async (request: GatewayHttpRequest): Promise<GatewayHttpResponse> => {
    const requestId = request.headers?.['x-request-id'] ?? randomUUID();
    const headers = { 'content-type': 'application/json', 'x-request-id': requestId };
    if (request.method.toUpperCase() !== 'POST') return { status: 405, headers, body: { error: 'MethodNotAllowed', requestId } };
    if (options.apiKey && request.headers?.authorization !== `Bearer ${options.apiKey}`) return { status: 401, headers, body: { error: 'Unauthorized', requestId } };
    const raw = JSON.stringify(request.body ?? {});
    if (Buffer.byteLength(raw, 'utf8') > maxBodyBytes) return { status: 413, headers, body: { error: 'PayloadTooLarge', requestId } };
    try {
      if (request.path === '/v1/generate') {
        const body = request.body as { task?: TaskType; prompt?: string; options?: GenerateOptions };
        if (typeof body?.task !== 'string' || typeof body?.prompt !== 'string' || !body.prompt.trim()) return { status: 400, headers, body: { error: 'InvalidRequest', requestId } };
        const result = await client.generate({ task: body.task, prompt: body.prompt, options: body.options });
        return { status: 200, headers, body: { ...result, requestId } };
      }
      return { status: 404, headers, body: { error: 'NotFound', requestId } };
    } catch (error) {
      const normalized = error instanceof GatewayError ? error : new GatewayError('ProviderUnavailableError', 'Gateway request failed');
      const status = normalized.category === 'AuthenticationError' ? 401 : normalized.category === 'RateLimitError' ? 429 : normalized.category === 'InvalidRequestError' ? 400 : 502;
      return { status, headers, body: { error: normalized.category, message: normalized.category === 'InvalidRequestError' ? normalized.message : 'Gateway request failed', requestId } };
    }
  };
}

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
