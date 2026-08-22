import { createHash, timingSafeEqual } from 'node:crypto';

const SECRET_REF = /^[A-Za-z0-9._:/-]{1,256}$/;
const BLOCKED_PROTOCOLS = /^(?:file|gopher|ftp|data|javascript):/i;

export function validateCredentialRef(value: unknown): string {
  if (typeof value !== 'string' || !SECRET_REF.test(value)) throw new Error('Invalid credential reference');
  return value;
}

export function redactSecret(value: string, visible = 4): string {
  if (!value) return '';
  if (value.length <= visible) return '***';
  return `${value.slice(0, visible)}***`;
}

export function redactObject(value: unknown, sensitiveKeys = ['apiKey', 'apikey', 'authorization', 'credential', 'credentialRef', 'password', 'secret', 'token']): unknown {
  if (Array.isArray(value)) return value.map((item) => redactObject(item, sensitiveKeys));
  if (!value || typeof value !== 'object') return value;
  const sensitive = new Set(sensitiveKeys.map((key) => key.toLowerCase()));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sensitive.has(key.toLowerCase()) ? '[REDACTED]' : redactObject(item, sensitiveKeys)]));
}

export function validateOutboundUrl(value: string, allowedHosts: string[]): URL {
  const url = new URL(value);
  if (BLOCKED_PROTOCOLS.test(url.protocol) || url.protocol !== 'https:') throw new Error('Outbound URL must use HTTPS');
  if (!allowedHosts.includes(url.hostname)) throw new Error('Outbound host is not allowlisted');
  return url;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function safeError(error: unknown): { category?: string; message: string } {
  if (error && typeof error === 'object') {
    const value = error as { category?: unknown; message?: unknown };
    return { category: typeof value.category === 'string' ? value.category : undefined, message: typeof value.message === 'string' ? value.message : 'Request failed' };
  }
  return { message: error instanceof Error ? error.message : 'Request failed' };
}
