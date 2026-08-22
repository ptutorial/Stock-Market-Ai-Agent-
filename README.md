# Multi-Provider LLM Gateway

A production-oriented, provider-agnostic TypeScript gateway for routing LLM workloads across multiple providers and multiple legitimate API accounts without coupling application code to provider-specific APIs.

The gateway provides a common abstraction for generation and streaming, capability-aware routing, account selection, retries and fallback, health state, rate-limit/quota controls, usage and cost accounting, observability, security boundaries, a developer SDK, an HTTP API, and atomic Redis state for multi-instance deployments.

> **Status:** Production-candidate architecture. Build and CI are green, and Batch E load/Redis certification is being executed incrementally. A production deployment should still complete live-provider contract tests, container/security scanning, deployment smoke tests, and the remaining Batch E evidence checks in the target environment.

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
- [Swagger / OpenAPI](#swagger--openapi)
- [Environment configuration](#environment-configuration)
- [Running locally](#running-locally)
- [Docker](#docker)
- [Load and production certification](#load-and-production-certification)
- [Testing and CI](#testing-and-ci)
- [Project structure](#project-structure)
- [Security model](#security-model)
- [Production-readiness checklist](#production-readiness-checklist)

## Why this gateway

Calling one LLM provider directly couples application code to that provider's authentication model, errors, limits, model names, streaming format, and availability characteristics.

This project puts a stable gateway boundary between application and providers:

```text
Application
    |
    v
Gateway SDK / HTTP API
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

Applications request a task and prompt rather than implementing provider-specific branches throughout their business logic.

## Core capabilities

- Provider abstraction for generation, streaming, model discovery, health checks, and normalized results.
- Multiple independently configured accounts per provider.
- Capability-aware routing for chat, streaming, structured output, tool calling, and vision.
- Routing strategies: `priority`, `round_robin`, `least_recently_used`, `lowest_utilization`, `fastest`, `cheapest`.
- Bounded retries, exponential backoff, cooldowns, health transitions, and capability-aware fallback.
- RPM, RPD, TPM, and TPD quota controls.
- Normalized usage and estimated cost accounting.
- Provider-neutral HTTP API with authentication, request IDs, payload limits, and normalized errors.
- Atomic Redis state for horizontally scaled deployments.

## Supported providers

| Provider | Adapter | Status |
|---|---|---|
| Google Gemini | `GeminiAdapter` | Implemented |
| Groq | `GroqAdapter` | Implemented |
| OpenRouter | `OpenRouterAdapter` | Implemented |
| Cloudflare Workers AI | `CloudflareWorkersAIAdapter` | Implemented |

Additional providers can be introduced through the adapter contract without changing application-level routing logic.

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
                         | GatewayClient / HTTP |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |      LLMGateway       |
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
                                    |
                                    v
                              External APIs

                    Shared state when required:
                              Redis
```

See [`docs/architecture.md`](docs/architecture.md) for detailed architecture documentation.

## Request lifecycle

1. Application submits task, prompt, and options.
2. Gateway validates the request.
3. Capability requirements are determined.
4. Eligible accounts/models are selected.
5. Disabled, unhealthy, incompatible, or cooling-down candidates are excluded.
6. Quota/rate-limit policy is evaluated.
7. Routing strategy selects a candidate.
8. Credential reference is resolved.
9. Provider adapter executes the request.
10. Provider result is normalized.
11. Usage and cost state is recorded.
12. Health state is updated.
13. Response is returned.

## Accounts and credentials

Example account configuration:

```ts
const account = {
  id: 'gemini-primary',
  provider: 'gemini',
  credentialRef: 'env:GEMINI_API_KEY',
  models: ['gemini-model-id'],
  capabilities: ['chat', 'streaming'],
  priority: 10,
  enabled: true,
  limits: { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 },
  costPerMillionInput: 0,
  costPerMillionOutput: 0,
};
```

For multiple accounts of the same provider, configure separate account IDs and credential references. The routing layer then treats them as independently eligible candidates while applying health and quota policy.

Multiple accounts are intended for legitimate, independently authorized provider accounts and must not be used to bypass provider limits or terms.

## Retries, cooldowns and fallback

Provider failures are normalized so reliability decisions remain provider-neutral. Controls include bounded retry count, exponential backoff, `Retry-After` handling, cooldown periods, health transitions, provider/account fallback, and capability-aware candidate selection.

Authentication failures are not treated as ordinary retryable failures.

## Rate limits and quotas

```ts
interface AccountLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
}
```

`AtomicRedisStateStore` performs quota checks and increments atomically using Redis Lua execution. Quota failures are designed to fail closed rather than silently bypass distributed limits.

## Redis and multi-instance scaling

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

This prevents the distributed race where several gateway instances independently check and increment the same provider quota.

Example:

```ts
const stateStore = new AtomicRedisStateStore(redisClient, 'llm-gateway');

const allowed = await stateStore.reserve(
  'gemini-primary',
  estimatedTokens,
  { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 },
);
```

## Usage and cost accounting

```ts
interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
}
```

Normalized results identify provider, account, model, request ID, latency, usage, and optional estimated cost.

## Health and observability

Account health states include `healthy`, `degraded`, `rate_limited`, `authentication_failure`, `temporarily_unavailable`, and `disabled`.

The HTTP boundary validates or generates `X-Request-Id` and returns it with the response. Operational telemetry is normalized without exposing provider credentials.

## Developer SDK

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
  options: { maxTokens: 1000 },
});
```

### Fluent builder

```ts
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

### Streaming

```ts
const stream = client.stream({ task: 'general', prompt: 'Explain Redis briefly.' });
for await (const chunk of stream) process.stdout.write(chunk.text);
```

## HTTP API

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| `GET` | `/health` | Liveness | None |
| `GET` | `/ready` | Readiness and healthy-account count | None |
| `POST` | `/v1/generate` | Generate an LLM response | Optional Bearer |

Example:

```http
POST /v1/generate HTTP/1.1
Content-Type: application/json
Authorization: Bearer <gateway-api-key>
X-Request-Id: request-123

{
  "task": "general",
  "prompt": "Explain event-driven architecture",
  "options": { "maxTokens": 500 }
}
```

The HTTP layer provides method/request validation, optional constant-time Bearer API-key comparison, request IDs, a configurable body limit (default 1 MiB), and normalized `400`, `401`, `404`, `405`, `413`, `429`, and `502` responses.

## Swagger / OpenAPI

The API is documented using **OpenAPI 3.0.3**.

```text
docs/
├── openapi.yaml
└── swagger-ui.html
```

- [OpenAPI specification](docs/openapi.yaml)
- [Interactive Swagger UI](docs/swagger-ui.html)

The Swagger UI loads the OpenAPI document and supports interactive Bearer authorization. The static page is documentation tooling and is not automatically exposed as a production route.

When `src/http.ts` changes, update `docs/openapi.yaml` in the same change and update the HTTP contract tests.

## Environment configuration

```bash
cp .env.example .env
```

Never commit real provider credentials or production `.env` files.

Typical runtime configuration:

```text
NODE_ENV=production
PORT=3000
GATEWAY_API_KEY=<set-at-runtime>
REDIS_URL=redis://localhost:6379
GATEWAY_SHUTDOWN_TIMEOUT_MS=10000
```

Provider account credentials should be injected through the configured credential store/environment references.

## Running locally

### Requirements

- Node.js **23.8.0** for the current project baseline
- npm
- Redis for distributed-state/load certification
- Provider credentials for live provider tests

Install and build:

```bash
npm install
npm run build
```

Run tests:

```bash
npm test
```

## Docker

The repository includes a production-oriented multi-stage Dockerfile.

```bash
docker build -t multi-provider-llm-gateway:local .
```

```bash
docker run --rm \
  -p 3000:3000 \
  -e GATEWAY_API_KEY='replace-at-runtime' \
  multi-provider-llm-gateway:local
```

The container is designed to run as a non-root user with production dependencies. Redis can be supplied as an external service for distributed state.

## Load and production certification

Batch E defines the production load/concurrency certification track:

| Phase | Certification | Command | Current evidence |
|---|---|---|---|
| E1 | Synthetic gateway load | `npm run load:test` | ✅ Passed |
| E2 | Redis atomic quota concurrency | `npm run load:redis` | ✅ Passed |
| E3 | Multi-instance shared quota | `npm run load:multi` | ⏳ Execute/retain evidence |
| E4 | Sustained load | `npm run load:sustained` | ⏳ Execute/retain evidence |
| E5 | Account fairness | `npm run load:fairness` | ⏳ Execute/retain evidence |
| E6 | Failure/recovery under load | `npm run load:failure` | ⏳ Execute/retain evidence |
| E7 | Certification evidence/report | `npm run certification:batch-e` | ⏳ Evidence gate |

### E1 recorded result

```text
1,000 requests
50 concurrency
1,000 completed
0 failed
29,212 RPS
p95 2.91 ms
1,000 provider calls
1,000 state requests
```

### E2 recorded result

```text
100 attempts
RPM limit: 25
Accepted: 25
Rejected: 75
Minute requests: 25
Minute tokens: 25
Day requests: 25
Day tokens: 25
```

`npm run certification:batch-e` currently prints the certification checklist and acceptance criteria. E3-E6 must be executed and their JSON output retained as release evidence before declaring Batch E fully certified.

## Testing and CI

Useful commands:

```bash
npm run build
npm test
npm run load:test
npm run load:redis
npm run load:multi
npm run load:sustained
npm run load:fairness
npm run load:failure
npm run certification:batch-e
```

CI gates changes on dependency installation, TypeScript compilation, tests, and the configured security/container checks. A green unit/build pipeline is necessary but not sufficient for production certification.

## Project structure

```text
.
├── src/
│   ├── domain.ts
│   ├── gateway.ts
│   ├── sdk.ts
│   ├── http.ts
│   ├── server.ts
│   ├── redis.ts
│   ├── state.ts
│   ├── routing.ts
│   └── providers/
├── scripts/
│   ├── load-test.mjs
│   ├── load-redis-test.mjs
│   ├── load-multi-instance.mjs
│   ├── load-sustained.mjs
│   ├── load-fairness.mjs
│   ├── load-failure-recovery.mjs
│   └── production-certification.mjs
├── test/
├── docs/
│   ├── openapi.yaml
│   ├── swagger-ui.html
│   └── architecture.md
├── .github/workflows/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Security model

Security controls include credential separation, normalized authentication errors, outbound access controls, redirect protection, constant-time API-key comparison, request-size limits, request-ID validation, sanitized error metadata, fail-closed Redis quotas, and non-root Docker execution.

Never commit API keys, access tokens, private keys, provider secrets, production `.env` files, or Redis credentials.

Multiple provider accounts are intended for legitimate accounts with independently permitted usage, not for bypassing quotas or provider access controls.

## Production-readiness checklist

### Application

- [x] Provider abstraction
- [x] Multiple-account routing
- [x] Capability-aware selection
- [x] Retry/fallback handling
- [x] Health/quarantine state
- [x] Usage/cost normalization
- [x] HTTP API
- [x] SDK
- [x] Redis atomic quota implementation
- [x] Swagger/OpenAPI documentation

### Verification

- [x] TypeScript build
- [x] Normal test suite green
- [x] E1 synthetic load passed
- [x] E2 Redis atomic quota passed
- [ ] E3 multi-instance evidence
- [ ] E4 sustained-load evidence
- [ ] E5 fairness evidence
- [ ] E6 failure/recovery evidence
- [ ] E7 automated certification gate

### Deployment

- [x] Docker build path
- [x] CI/CD build/test path
- [ ] Live provider contract tests
- [ ] Container vulnerability scan
- [ ] Production deployment smoke test
- [ ] Redis HA/backup validation
- [ ] Monitoring and alerting configuration
- [ ] Production secret-management integration

## Design principles

1. **Provider neutrality** — application code should not need provider-specific branches.
2. **Explicit eligibility** — routing cannot override health, capabilities, limits, or disabled state.
3. **Fail closed** — quota and security failures must not silently become bypasses.
4. **Observable without leaking secrets** — telemetry should be useful without exposing credentials.
5. **Deterministic behavior** — routing and tests should have predictable tie-breaking.
6. **Horizontal scalability** — shared state belongs in a distributed store when multiple instances are used.
7. **Test the boundaries** — compiler, unit, HTTP, Redis, load, container, and deployment behavior should be validated independently.
8. **Documentation follows the contract** — OpenAPI changes should accompany HTTP implementation changes.

## License

See the repository license file for project licensing terms.
