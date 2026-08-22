import { GatewayError, normalizeError } from './errors.js';

export interface RetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
}

export interface RetryContext {
  attempt: number;
  delayMs: number;
  error: GatewayError;
}

export interface RetryExecutorOptions extends RetryPolicy {
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (context: RetryContext) => void;
  now?: () => number;
}

export interface FallbackCandidate<T> {
  candidate: T;
  capabilities?: string[];
  available?: boolean;
}

export function isRetryable(error: GatewayError): boolean {
  return error.retryable && !['AuthenticationError', 'InvalidRequestError', 'UnsupportedCapabilityError'].includes(error.category);
}

export function calculateBackoff(attempt: number, policy: RetryPolicy, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) return retryAfterMs;
  const base = policy.baseDelayMs ?? 250;
  const max = policy.maxDelayMs ?? 10_000;
  const jitter = policy.jitter ?? 0.2;
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const spread = exponential * jitter;
  return Math.max(0, Math.round(exponential - spread + random() * spread * 2));
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryExecutorOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (raw) {
      const error = normalizeError(raw);
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      const delayMs = calculateBackoff(attempt, options, error.retryAfterMs);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new GatewayError('UnknownProviderError', 'Retry execution failed');
}

export function selectFallback<T>(
  candidates: FallbackCandidate<T>[],
  requiredCapabilities: string[] = [],
): T | undefined {
  return candidates.find((item) => item.available !== false && requiredCapabilities.every((cap) => item.capabilities?.includes(cap)))?.candidate;
}
