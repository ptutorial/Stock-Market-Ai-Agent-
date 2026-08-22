# Multi-Provider LLM Gateway

A production-oriented, provider-agnostic TypeScript gateway for applications that need to route LLM workloads across multiple providers and multiple legitimate API accounts without putting provider-specific logic into application code.

The gateway provides a common abstraction for generation and streaming, capability-aware routing, account selection, retries and fallback, health state, rate-limit/quota controls, usage accounting, observability, security boundaries, a developer SDK, an HTTP API, and an atomic Redis state implementation for multi-instance deployments.

> **Status:** Production-candidate architecture. The repository has a green CI build/test pipeline, but live provider, Redis, load, container-security, and deployment smoke tests still need to be performed before calling a deployment production-certified.

---

## Contents

- [Why this gateway](#why-this-gateway)
- [Core capabilities](#core-capabilities)
- [Supported providers](#supported-providers)
- [Architecture](#architecture)
- [Request lifecycle](#request-lifecycle)
- [Routing strategies](#routing-strategies)
- [Capabilities and tasks](#capabilities-and-tasks)
- [Accounts and credentials](#accounts-and-credentials)
- [Retries, cooldowns and fallback](#retries-cooldowns-and-fallback)
- [Rate limits and quotas](#rate-limits-and-quotas)
- [Redis and multi-instance scaling](#redis-and-multi-instance-scaling)
- [Usage and cost accounting](#usage-and-cost-accounting)
- [Health and observability](#health-and-observability)
- [Developer SDK](#developer-sdk)
- [HTTP API](#http-api)
- [Running locally](#running-locally)
- [Docker](#docker)
- [Testing and CI](#testing-and-ci)
- [Project structure](#project-structure)
- [Phased implementation](#phased-implementation)
- [Security model](#security-model)
- [Production-readiness checklist](#production-readiness-checklist)
- [Design principles](#design-principles)

---

## Why this gateway

Calling one LLM provider directly couples application code to that provider's API, authentication model, errors, limits, model names, streaming format, and availability characteristics.

This project puts a stable gateway boundary between the application and providers:

```text
Application
    |
    v
LLM Gateway API
    |
    +--> capability matching
    +--> account selection
    +--> quota / rate-limit checks
    +--> retry / cooldown / fallback
    +--> health state
    +--> usage / cost accounting
    |
    v
Provider Adapter
    |
    v
Provider API / Model
```

The application therefore asks for a task and prompt instead of implementing provider-specific branches such as `if provider === ...` throughout its business logic.

---

## Core capabilities

### Provider abstraction

Providers implement a common `ProviderAdapter` contract for:

- text generation
- streaming
- model discovery
- health checks
- normalized gateway results

### Multiple legitimate accounts

A provider can have multiple configured accounts. The gateway can select among eligible accounts while respecting their configured limits and health state.

### Capability-aware routing

Routing can consider capabilities such as:

- chat
- streaming
- structured output
- tool calling
- vision

### Routing strategies

The domain currently defines:

- `priority`
- `round_robin`
- `least_recently_used`
- `lowest_utilization`
- `fastest`
- `cheapest`

### Reliability controls

The gateway supports bounded retries, cooldowns, normalized failures, and provider fallback. Fallback remains capability-aware rather than blindly switching providers.

### Rate-limit and quota controls

Account-level limits can represent:

- RPM — requests per minute
- RPD — requests per day
- TPM — tokens per minute
- TPD — tokens per day

### Usage and cost tracking

Gateway results carry normalized usage information including input tokens, output tokens, total tokens, and optional estimated cost/currency data.

### Health state

Account health can be represented as:

- `healthy`
- `degraded`
- `rate_limited`
- `authentication_failure`
- `temporarily_unavailable`
- `disabled`

### HTTP boundary

The service layer provides a provider-neutral `POST /v1/generate` endpoint with request validation, optional Bearer authentication, request IDs, payload-size protection, and normalized HTTP errors.

### Redis-backed distributed state

`AtomicRedisStateStore` uses a Redis Lua `EVAL` operation to make quota checks and increments atomic. This is intended for multiple gateway instances sharing quota state.

---

## Supported providers

The current domain/provider implementation includes:

| Provider | Adapter | Status |
|---|---|---|
| Google Gemini | `GeminiAdapter` | Implemented |
| Groq | `GroqAdapter` | Implemented |
| OpenRouter | `OpenRouterAdapter` | Implemented |
| Cloudflare Workers AI | `CloudflareWorkersAIAdapter` | Implemented |

The architecture is designed so additional providers can be introduced through adapters without changing application-level routing logic.

Provider-specific credentials are supplied through credential references rather than being embedded in application telemetry or gateway responses.

---

## Architecture

```text
                         +----------------------+
                         |      Application     |
                         +----------+-----------+
                                    |
                         generate / stream
                                    |
                                    v
                         +----------------------+
                         |   GatewayClient /    |
                         |      HTTP API        |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |     LLMGateway       |
                         +----------+-----------+
                                    |
             +----------------------+----------------------+
             |                      |                      |
             v                      v                      v
       Capability              Routing                Reliability
       Matching                Strategy               Retry/Fallback
             |                      |                      |
             +----------------------+----------------------+
                                    |
                         +----------v-----------+
                         | Account / Model      |
                         | Candidate Selection  |
                         +----------+-----------+
                                    |
                  +-----------------+-----------------+
                  |                 |                 |
                  v                 v                 v
               Gemini             Groq          OpenRouter / CF
                  |                 |                 |
                  +-----------------+-----------------+
                                    |
                                    v
                              External APIs

                    Shared state when required:
                              Redis
```

The core gateway is provider-neutral. Provider adapters own translation to external provider APIs.

See [`docs/architecture.md`](docs/architecture.md) for the detailed architecture documentation.

---

## Request lifecycle

A normal generation request follows this conceptual path:

```text
1. Application submits task + prompt + options
2. Gateway validates the request
3. Capability requirements are determined
4. Eligible accounts/models are discovered or selected
5. Disabled/unhealthy/ineligible candidates are excluded
6. Rate-limit/quota policy is evaluated
7. Routing strategy scores/selects a candidate
8. Credential reference is resolved
9. Provider adapter executes the request
10. Result is normalized
11. Usage/cost state is recorded
12. Health state is updated
13. Response is returned to the application
```

If a provider failure is retryable, the gateway can retry within its configured bounds. If fallback is allowed and another eligible candidate exists, the request can move to the next provider/account.

---

## Routing strategies

The routing layer supports multiple selection policies.

| Strategy | Purpose |
|---|---|
| `priority` | Prefer explicitly higher-priority accounts/providers |
| `round_robin` | Distribute eligible requests across candidates |
| `least_recently_used` | Prefer candidates used least recently |
| `lowest_utilization` | Prefer candidates with lower observed utilization |
| `fastest` | Prefer candidates based on observed latency/health information |
| `cheapest` | Prefer candidates with lower configured cost |

Routing is constrained by capability, account configuration, health, and limits. A strategy does not override those eligibility rules.

---

## Capabilities and tasks

### Capabilities

```ts
'chat'
'streaming'
'structured_output'
'tool_calling'
'vision'
```

### Tasks

```ts
'coding'
'general'
'reasoning'
'fast'
'cheap'
'long_context'
'vision'
'structured_output'
```

Generation options can additionally specify a model, capability requirements, temperature, maximum tokens, tools, JSON schema, and an `AbortSignal`.

---

## Accounts and credentials

An account is represented by an `AccountConfig` similar to:

```ts
const account = {
  id: 'gemini-primary',
  provider: 'gemini',
  credentialRef: 'env:GEMINI_API_KEY',
  models: ['gemini-model-id'],
  capabilities: ['chat', 'streaming'],
  priority: 10,
  enabled: true,
  limits: {
    rpm: 60,
    rpd: 10000,
    tpm: 100000,
    tpd: 1000000,
  },
  costPerMillionInput: 0,
  costPerMillionOutput: 0,
};
```

`credentialRef` identifies how the credential should be resolved. The application should not place raw provider API keys into source code, logs, telemetry, configuration committed to Git, or README examples.

The gateway architecture deliberately separates credential resolution from provider execution.

---

## Retries, cooldowns and fallback

Provider failures are normalized so the gateway can make reliability decisions without exposing provider-specific error handling throughout the application.

Controls include:

- bounded retry count
- cooldown periods after failures/rate limits
- health transitions
- provider/account fallback
- capability-aware candidate selection

The gateway must not use retries or account rotation to bypass a provider's quota, rate limit, terms, or access controls. Multiple accounts are intended for legitimate accounts and independently permitted usage.

---

## Rate limits and quotas

The gateway models account limits as:

```ts
interface AccountLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
}
```

For a single process, state can be maintained through the configured state store. For multiple gateway instances, `AtomicRedisStateStore` provides atomic quota reservation using Redis Lua execution.

The Redis implementation creates minute/day request and token buckets with expiration so stale buckets are automatically removed.

---

## Redis and multi-instance scaling

For a horizontally scaled deployment:

```text
              Load Balancer
                    |
          +---------+---------+
          |         |         |
       Gateway   Gateway   Gateway
          |         |         |
          +---------+---------+
                    |
                 Redis
```

`AtomicRedisStateStore.reserve()` performs the relevant quota checks and increments inside a single Redis Lua script. This avoids the classic distributed race where two gateway instances independently perform `GET`, check, and `INCR` operations.

Example conceptual usage:

```ts
const stateStore = new AtomicRedisStateStore(redisClient, 'llm-gateway');

const allowed = await stateStore.reserve(
  'gemini-primary',
  estimatedTokens,
  { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 },
);
```

A real deployment should use a production Redis client that supports `EVAL` and should include live Redis integration testing before release.

---

## Usage and cost accounting

The normalized `Usage` structure supports:

```ts
interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
}
```

`GenerateResult` also identifies the selected provider, account, model, request ID, and latency.

This provides the basis for:

- per-provider usage reporting
- per-account usage reporting
- cost estimation
- latency analysis
- operational dashboards

---

## Health and observability

The gateway tracks account health and operational state so routing can avoid known unhealthy candidates.

The architecture also includes observability and usage boundaries for collecting normalized operational information without exposing provider credentials.

Request IDs are generated or propagated at the HTTP boundary using `X-Request-Id` and are included in gateway results.

---

## Developer SDK

The SDK provides a high-level interface for applications that do not need to know about the gateway's internal routing implementation.

### Direct client

```ts
import { GatewayClient } from 'multi-provider-llm-gateway';

const client = new GatewayClient({
  accounts,
  adapters,
  credentialStore,
  usageSink,
  strategy: 'lowest_utilization',
  maxRetries: 2,
  cooldownMs: 30_000,
});

const result = await client.generate({
  task: 'coding',
  prompt: 'Explain this function',
  options: {
    maxTokens: 1000,
  },
});

console.log(result.text);
```

### Fluent builder

```ts
import { gatewayClient } from 'multi-provider-llm-gateway';

const client = gatewayClient()
  .addAccount(account)
  .addAdapter(adapter)
  .credentialStore(credentialStore)
  .usageSink(usageSink)
  .strategy('priority')
  .fallbackProviders(['groq', 'openrouter'])
  .maxRetries(2)
  .cooldownMs(30_000)
  .build();
```

The builder validates that at least one account and one adapter exist and validates retry/cooldown values.

### Streaming

```ts
const stream = client.stream({
  task: 'general',
  prompt: 'Write a short explanation of Redis.',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

---

## HTTP API

The provider-neutral HTTP layer exposes:

```http
POST /v1/generate
```

Example request:

```http
POST /v1/generate HTTP/1.1
Content-Type: application/json
Authorization: Bearer <gateway-api-key>
X-Request-Id: request-123

{
  "task": "general",
  "prompt": "Explain event-driven architecture",
  "options": {
    "maxTokens": 500
  }
}
```

The endpoint supports:

- method validation
- request validation
- optional Bearer authentication
- request ID propagation/generation
- configurable request body limit (default 1 MiB)
- normalized `400`, `401`, `404`, `405`, `413`, and gateway-error responses

The HTTP handler itself is framework-neutral and can be embedded in a Node.js HTTP runtime or adapted to another HTTP framework.

---

## Running locally

### Requirements

- Node.js 20+
- npm
- Provider credentials for the providers you intend to exercise
- Redis only when testing the distributed state implementation

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

The repository's CI pipeline runs installation, TypeScript compilation, and the test suite.

---

## Docker

The repository includes a multi-stage production-oriented Dockerfile.

Build:

```bash
docker build -t multi-provider-llm-gateway:local .
```

The build stage installs dependencies, copies the source/tests, and runs the test suite before the runtime image is created.

Run:

```bash
docker run --rm \
  -p 3000:3000 \
  -e GATEWAY_API_KEY='replace-at-runtime' \
  multi-provider-llm-gateway:local
```

The runtime container:

- uses Node 20 Alpine
- sets `NODE_ENV=production`
- runs as the non-root `node` user
- exposes port `3000`
- receives the gateway API key at runtime

> The current standalone `src/server.ts` is a production-runtime skeleton. It intentionally does not invent provider credentials/configuration. A deployment must wire the actual account configuration, adapters, credential store, and usage/state dependencies before serving real provider traffic.

---

## Testing and CI

The CI workflow currently performs:

```text
npm install
    ↓
npm run build
    ↓
npm test
```

The project has been developed phase-by-phase with CI verification used as a gate before treating compiler/test failures as resolved.

The test suite covers gateway contracts, SDK behavior, HTTP validation, Redis atomic reservation behavior, and other core components included in the repository.

### Production verification still required

A green unit/build CI pipeline does not by itself prove production readiness. Before a production deployment, run:

- live Redis integration tests
- live provider contract tests
- container vulnerability scanning
- load/concurrency testing
- repository/history secret scanning
- production deployment smoke tests

---

## Project structure

```text
.
├── src/
│   ├── domain.ts                 # Core domain contracts and types
│   ├── gateway.ts                # Main gateway orchestration
│   ├── sdk.ts                    # Developer-facing client and builder
│   ├── http.ts                   # Provider-neutral HTTP handler
│   ├── server.ts                 # Minimal Node HTTP runtime
│   ├── redis.ts                  # Atomic Redis state implementation
│   ├── state.ts                  # State-store abstraction
│   ├── router.ts                 # Candidate selection/routing
│   ├── limits.ts                 # Rate-limit/quota logic
│   ├── retry.ts                  # Retry/failure behavior
│   ├── health.ts                 # Account/provider health
│   ├── usage.ts                  # Usage/accounting
│   ├── observability.ts          # Operational telemetry boundary
│   ├── security.ts               # Security-related helpers/boundaries
│   ├── config.ts                 # Configuration handling
│   ├── model-registry.ts         # Model/capability registry
│   └── providers/
│       ├── gemini.ts
│       ├── openai-compatible.ts
│       └── cloudflare.ts
├── test/                         # Automated tests
├── docs/
│   └── architecture.md           # Detailed architecture
├── .github/workflows/ci.yml      # CI pipeline
├── Dockerfile                    # Production container build
├── plan.md                       # Phase-by-phase implementation plan
├── package.json
└── tsconfig.json
```

---

## Phased implementation

The project has been implemented incrementally rather than as one large change.

| Phase | Area | Status |
|---|---|---|
| 0 | Repository foundation | Complete |
| 1 | Core domain model/contracts | Complete |
| 2 | Configuration/credentials | Complete |
| 3 | Provider adapter SDK | Implemented |
| 4 | Model/capability discovery | Implemented |
| 5 | Routing engine | Implemented |
| 6 | Rate limits/quotas | Implemented |
| 7 | Retry/fallback | Implemented |
| 8 | Concurrency/distributed state | Implemented |
| 9 | Usage/cost accounting | Implemented |
| 10 | Health monitoring | Implemented |
| 11 | Observability | Implemented |
| 12 | Security hardening | Implemented |
| 13 | Comprehensive testing | Implemented |
| 14 | Developer API/SDK | Implemented; CI green |
| 15 | Service/API layer | Implemented |
| 16 | Redis/production scaling | Implemented |
| 17 | Additional providers | Future |
| 18 | Production readiness baseline | Implemented; CI green |

See [`plan.md`](plan.md) for the detailed phase definitions, exit criteria, and remaining production verification work.

---

## Security model

Security is a first-class gateway boundary rather than provider-specific application logic.

### Credentials

- Use credential references instead of raw secrets in gateway configuration where possible.
- Supply runtime secrets through environment/secret-management mechanisms.
- Do not commit API keys.
- Do not return provider credentials through the HTTP API.
- Do not log raw provider credentials.

### Authentication

The HTTP layer supports an optional Bearer API key. The standalone production server requires `GATEWAY_API_KEY` to be configured before startup.

### Request protection

The HTTP boundary includes request validation and a configurable body-size limit to reduce accidental or abusive oversized requests.

### Quota integrity

The gateway does not attempt to bypass provider quotas or rate limits. Account rotation is only an orchestration mechanism across legitimately configured accounts and must remain within each provider's permitted usage and terms.

---

## Production-readiness checklist

### Completed in the repository

- [x] Provider-neutral gateway architecture
- [x] Capability-aware routing
- [x] Multiple account configuration
- [x] Retry/cooldown/fallback controls
- [x] Usage and cost model
- [x] Health state
- [x] Observability boundaries
- [x] Security boundaries
- [x] Developer SDK
- [x] HTTP API
- [x] Atomic Redis quota implementation
- [x] Production-oriented Docker image
- [x] Non-root runtime container
- [x] Runtime secret configuration
- [x] TypeScript build in CI
- [x] Automated tests in CI
- [x] CI currently green

### Required before production certification

- [ ] Live Redis integration testing
- [ ] Live provider contract testing
- [ ] Container vulnerability scan
- [ ] Load/concurrency testing
- [ ] Repository/history secret scan
- [ ] Production deployment smoke test
- [ ] Real provider/account configuration wired into `src/server.ts`

---

## Design principles

1. **Provider neutrality** — application business logic should not contain provider-specific branches.
2. **Capability first** — routing decisions must respect required capabilities.
3. **Legitimate account usage** — multiple accounts are for legitimate, authorized configurations, not quota circumvention.
4. **Bounded reliability** — retries and fallback must have explicit limits.
5. **Observable execution** — usage, latency, health, and request identity should be normalized.
6. **Credential isolation** — secrets belong in credential stores/runtime configuration, not business logic or telemetry.
7. **Distributed correctness** — shared quota state must use atomic operations when multiple gateway instances are active.
8. **Incremental implementation** — each phase is implemented, tested, documented, and verified before moving forward.
9. **Honest production status** — a green CI pipeline is necessary but is not equivalent to production certification.

---

## License

Add the project's chosen license here before publishing the package for external consumption.
