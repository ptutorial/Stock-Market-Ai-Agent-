export type ErrorCategory = 'AuthenticationError' | 'RateLimitError' | 'TimeoutError' | 'ProviderUnavailableError' | 'ModelUnavailableError' | 'InvalidRequestError' | 'UnsupportedCapabilityError' | 'ServerError' | 'UnknownProviderError';

export class GatewayError extends Error {
  constructor(public readonly category: ErrorCategory, message: string, public readonly retryable = false, public readonly retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = category;
  }
}

export function normalizeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') return new GatewayError('TimeoutError', 'Provider request timed out', true);
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|unauthori[sz]ed|invalid.*key|authentication/i.test(message)) return new GatewayError('AuthenticationError', 'Provider authentication failed', false);
  if (/429|rate.?limit|quota/i.test(message)) return new GatewayError('RateLimitError', 'Provider rate limit reached', true);
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return new GatewayError('TimeoutError', 'Provider request timed out', true);
  if (/404|model.*(not found|unavailable)/i.test(message)) return new GatewayError('ModelUnavailableError', 'Requested model is unavailable', true);
  if (/5\d\d|unavailable|ECONNRESET|ECONNREFUSED/i.test(message)) return new GatewayError('ProviderUnavailableError', 'Provider is temporarily unavailable', true);
  return new GatewayError('UnknownProviderError', 'Unexpected provider error', false, undefined, { cause: error });
}
