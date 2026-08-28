# Multi-Provider LLM Gateway — Code Review & Architecture Guide

## Overview

A multi-provider LLM gateway that routes generation requests across configured LLM provider accounts (Gemini, Groq, OpenRouter, Cloudflare Workers AI) with authentication, health checking, retry, fallback, rate limiting, and request correlation.

---

## Architecture

```
Client (curl / SDK)
    │
    ▼
HTTP Server (node:http)
    │
    ├─ GET /health          → liveness check
    ├─ GET /ready            → readiness check (at least one healthy provider)
    └─ POST /v1/generate     → main generation endpoint
            │
            ▼
    GatewayHttpHandler
            │
            ▼
    GatewayClient → LLMGateway
            │
            ├─ selectCandidates()   → filter accounts by health, capabilities, model
            ├─ ModelRouter.rank()   → sort by strategy (priority, round_robin, etc.)
            ├─ generate()           → execute with retry + fallback across providers
            │
            ├─ GeminiAdapter ───────────→ Google Generative AI API
            ├─ GroqAdapter ─────────────→ Groq OpenAI-compatible API
            ├─ OpenRouterAdapter ───────→ OpenRouter API
            └─ CloudflareWorkersAIAdapter → Cloudflare Workers AI API
```

## Key Design Decisions

### 1. Credential References, Not Secrets

Credentials are stored as environment variable names (`credentialRef`), never as values in config files. `EnvironmentCredentialStore` resolves them at runtime.

```typescript
// Config says:
{ credentialRef: "GEMINI_API_KEY_1" }

// Runtime resolves:
process.env["GEMINI_API_KEY_1"] → actual key
```

### 2. Provider-Neutral Contract

All providers implement the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  generate(account, request, model, credential, requestId): Promise<GenerateResult>;
  stream(account, request, model, credential, requestId): AsyncIterable<StreamChunk>;
  discoverModels(account, credential): Promise<ModelInfo[]>;
  healthCheck(account, credential): Promise<boolean>;
}
```

Provider-specific authentication, error parsing, and model metadata are hidden inside adapters. The gateway never sees provider-specific details.

### 3. Dynamic Configuration

Without an explicit `LLM_GATEWAY_CONFIG` JSON env var, the gateway auto-discovers providers from environment variable patterns:

| Pattern | Provider |
|---|---|
| `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ... | Gemini |
| `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, ... | Groq |
| `OPENROUTER_API_KEY_1`, ... | OpenRouter |
| `CLOUDFLARE_API_TOKEN_1`, ... | Cloudflare |

Each discovered key becomes one account with the provider's default model.

### 4. State Management

Account state (health, cooldowns, usage counters) is held in a `StateStore`:

- **InMemoryStateStore** — default for development, uses Map with per-account locking.
- **RedisStateStore** / **AtomicRedisStateStore** — for production, uses Redis with Lua scripts for atomic quota reservation.

State includes:
- `health`: `healthy | degraded | rate_limited | authentication_failure | temporarily_unavailable | disabled`
- `cooldownUntil`: timestamp after which the account becomes eligible again
- `failures`: consecutive failure count
- `metadata`: latency, utilization metrics

### 5. Routing Strategies

| Strategy | Behavior |
|---|---|
| `priority` | Highest priority wins (ties broken by provider order, then insertion order) |
| `round_robin` | Cycles through eligible candidates |
| `least_recently_used` | Prefers longest-idle account |
| `lowest_utilization` | Prefers account with lowest RPM/TPM utilization |
| `fastest` | Prefers account with lowest observed latency |
| `cheapest` | Prefers account with lowest cost per token |

Default: `round_robin` (dynamic config) or `priority` (explicit config).

---

## Request Flow

1. **HTTP layer** parses request, validates auth (Bearer token), reads body
2. **Gateway handler** calls `GatewayClient.generate(task, prompt, options)`
3. **`LLMGateway.generate()`** calls `selectCandidates()`:
   - Filters accounts: enabled, not auth-failed, not in cooldown
   - Checks capability compatibility
   - Fetches credential from store
   - Discovers available models (cached with 5-minute TTL)
   - Ranks candidates by strategy
4. **Executes against top candidate** with retry:
   - Reserves quota (atomic)
   - Calls `adapter.generate()`
   - On success: marks account healthy, records usage
   - On failure: marks account degraded/cooldown, retries if retryable
   - After all retries exhausted for a candidate: moves to next candidate
5. **Returns** normalized `GenerateResult` or throws `GatewayError`

---

## Error Handling

### Error Categories

| Category | Retryable | HTTP Status | Meaning |
|---|---|---|---|
| `AuthenticationError` | No | 401 | Invalid API key |
| `RateLimitError` | Yes | 429 | Quota exhausted (honors `Retry-After`) |
| `TimeoutError` | Yes | 502 | Request timed out |
| `ProviderUnavailableError` | Yes | 502 | Provider down (5xx, connection refused) |
| `ModelUnavailableError` | Yes | 502 | Model not found/unavailable |
| `InvalidRequestError` | No | 400 | Bad request (wrong params, unsupported feature) |
| `ServerError` | Yes | 502 | Unexpected provider error |

### Error Normalization (`normalizeError`)

Non-GatewayError exceptions are classified by regex matching on the error message. This covers common provider SDK error patterns (timeouts, connection errors, status codes in messages).

**Note:** The regex `invalid.*key` in the auth check can over-match. A message like "model invalid key format" would be classified as `AuthenticationError`. This is a minor issue — in practice, adapter-specific errors are already thrown as proper `GatewayError` instances.

### Retry Behavior

- Default: 2 retries (`maxRetries` config)
- Backoff: exponential with jitter (250ms base, 10s max, 20% jitter)
- `Retry-After` header is honored when present
- Only retryable errors trigger retries (not auth errors, invalid requests)
- Each retry attempt marks the account as failed, which triggers cooldown

### Cooldown

After a failure, the account enters cooldown (`cooldownMs`, default 30s). During cooldown, the account is excluded from candidate selection. This prevents hammering a failing provider.

**Potential issue:** The cooldown is applied even for transient 5xx errors that succeed on retry. If the only provider gets a single 503, all requests within 30 seconds fail because there's no fallback provider. Consider reducing `cooldownMs` or only applying cooldown after all retries are exhausted.

---

## Security

### Authentication

- Gateway requires a Bearer token (`GATEWAY_API_KEY` env var)
- Constant-time comparison via SHA-256 hashing + `timingSafeEqual`
- Credentials never logged, redacted in observability events

### Outbound Request Safety

- `redirect: 'error'` — prevents credential-bearing requests from following redirects to unintended hosts
- `validateOutboundUrl()` checks HTTPS and allowlisted hosts
- Credential refs validated against `^[A-Za-z0-9._:/-]{1,256}$`

### Input Validation

- Request body size limit (`GATEWAY_REQUEST_BODY_LIMIT_BYTES`, default 1MB)
- Request ID format validation (`/^[A-Za-z0-9._:-]{1,128}$/`)
- Config validation: duplicate IDs, missing fields, invalid limits

---

## Provider Adapters

### Gemini

- Uses `x-goog-api-key` header authentication
- Direct API calls to `generativelanguage.googleapis.com/v1beta`
- Supports: generateContent, streamGenerateContent, listModels
- Health check: listModels (does not consume quota)

### Groq / OpenRouter (OpenAI-Compatible)

- Share `OpenAICompatibleAdapter` base class
- Bearer token auth, standard `/chat/completions` endpoint
- Health check: list models via `/models` endpoint
- OpenRouter adds `http-referer` and `x-title` headers

### Cloudflare Workers AI

- Uses Cloudflare API with account ID from `metadata.accountId`
- Health check: sends a minimal generation request (`max_tokens: 1`)
- Model discovery returns configured models (no API call)

---

## Observability

### Metrics (In-Memory)

| Metric | Type | Labels |
|---|---|---|
| `gateway_requests_total` | Counter | provider, accountId, model, operation, status, errorCategory |
| `gateway_request_latency_ms` | Histogram | provider, accountId, model, operation, status |
| `gateway_tokens_total` | Counter | provider, accountId, model, operation, status |
| `gateway_estimated_cost_total` | Counter | provider, accountId, model, operation, status |

### Request Tracing

Every request gets a `requestId` (UUID or client-supplied via `X-Request-ID` header). Returned in all responses and recorded in usage/observability.

### Usage Tracking

`UsageStore` records per-request token counts, latency, and estimated cost. `InMemoryUsageStore` provides queryable totals with filtering by account, provider, model, and time range.

---

## Known Issues & Recommendations

### Issues Found

1. **Gemini model deprecation** (fixed): `gemini-2.5-flash` was deprecated. Updated to `gemini-flash-latest`. Model names should be configurable and validated against live model discovery.

2. **Single-provider fragility**: With only one working provider (Gemini), any transient 5xx puts it into 30-second cooldown, causing cascading failures for all requests. Recommendations:
   - Add real API keys for Groq and OpenRouter as fallback providers
   - Reduce `cooldownMs` to 5-10 seconds for transient errors
   - Only apply cooldown after all retries are exhausted within a single request

3. **`normalizeError` regex over-matching**: The regex `/invalid.*key/` could classify unrelated error messages as `AuthenticationError`. Consider making the regex more specific or only matching adapter-thrown errors.

4. **`GEMINI_MODEL` env var unused**: The `.env` has `GEMINI_MODEL` but the config code ignores it (uses hardcoded `DEFAULT_MODELS`). The env var should either be respected or removed from `.env`.

5. **Health check for Cloudflare burns tokens**: Cloudflare's `healthCheck` sends a real generation request (`max_tokens: 1`). This consumes quota. Consider using a lighter health check endpoint or model listing.

6. **`markFailure` called during retries**: In `LLMGateway.generate()`, `markFailure` is called on each retry attempt. This sets cooldown even when the next retry succeeds. Only the final outcome should affect health state.

### Recommendations

1. **Add provider failover**: Configure at least 2-3 providers with real keys so the gateway can fall back when one provider is down.

2. **Reduce cooldown for server errors**: ServerError (5xx) cooldown should be shorter (5s) than rate-limit cooldown (60s).

3. **Add /v1/stream endpoint**: The gateway supports streaming internally but the HTTP layer only exposes `/v1/generate`. Add a streaming endpoint for real-time token delivery.

4. **Add request logging**: Currently, errors are only logged to stderr. Add structured request logging for debugging.

5. **Validate model names at startup**: Call `discoverModels` for each account at startup and warn if configured models aren't in the discovered list.

6. **Make `cooldownMs` per-error-type**: Different error categories should have different cooldown durations (auth failure: permanent, rate limit: from Retry-After, server error: 5s).

---

## File Reference

| File | Purpose |
|---|---|
| `src/domain.ts` | Core type definitions (ProviderAdapter, AccountConfig, etc.) |
| `src/gateway.ts` | LLMGateway — main orchestration logic |
| `src/sdk.ts` | GatewayClient — public SDK interface |
| `src/http.ts` | HTTP handler — request/response layer |
| `src/server.ts` | HTTP server — process management, health checks |
| `src/config.ts` | Configuration loading and validation |
| `src/router.ts` | Model routing strategies |
| `src/state.ts` | InMemoryStateStore + RedisStateStore |
| `src/health.ts` | HealthMonitor — health state machine |
| `src/errors.ts` | GatewayError + normalizeError |
| `src/retry.ts` | Retry policy, backoff, fallback selection |
| `src/security.ts` | Credential validation, constant-time comparison, URL validation |
| `src/usage.ts` | Usage tracking and cost estimation |
| `src/observability.ts` | Metrics collection |
| `src/limits.ts` | Rate limit tracking |
| `src/model-registry.ts` | Model discovery with TTL cache |
| `src/providers/gemini.ts` | Gemini adapter |
| `src/providers/openai-compatible.ts` | Groq + OpenRouter adapters |
| `src/providers/cloudflare.ts` | Cloudflare Workers AI adapter |
| `src/providers/http.ts` | Shared HTTP transport, SSE parsing, error mapping |
| `docs/openapi.yaml` | OpenAPI 3.0.3 specification |
| `docs/architecture.md` | Architecture overview |
| `docs/configuration.md` | Configuration guide |
