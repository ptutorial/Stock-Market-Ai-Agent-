import assert from 'node:assert/strict';
import test from 'node:test';
import { constantTimeEqual, redactObject, redactSecret, safeError, validateCredentialRef, validateOutboundUrl } from '../dist/security.js';

test('validates credential references without accepting arbitrary secret values', () => {
  assert.equal(validateCredentialRef('env:GEMINI_API_KEY'), 'env:GEMINI_API_KEY');
  assert.throws(() => validateCredentialRef('actual-secret-value with spaces'));
});

test('redacts sensitive object fields recursively', () => {
  assert.deepEqual(redactObject({ apiKey: 'secret', nested: { password: 'pass', ok: true } }), { apiKey: '[REDACTED]', nested: { password: '[REDACTED]', ok: true } });
  assert.equal(redactSecret('abcdefghijkl', 4), 'abcd***');
});

test('allows only HTTPS to explicitly allowlisted hosts', () => {
  assert.equal(validateOutboundUrl('https://api.example.com/v1', ['api.example.com']).hostname, 'api.example.com');
  assert.throws(() => validateOutboundUrl('http://api.example.com/v1', ['api.example.com']));
  assert.throws(() => validateOutboundUrl('https://evil.example.com', ['api.example.com']));
});

test('constant-time comparison preserves equality semantics', () => {
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'different'), false);
});

test('safeError returns only safe error metadata', () => {
  assert.deepEqual(safeError({ category: 'RateLimitError', message: 'limited', apiKey: 'secret' }), { category: 'RateLimitError', message: 'limited' });
});
