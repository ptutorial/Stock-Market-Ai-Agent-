# Stock Market AI Agent

Production-oriented TypeScript platform for multi-agent stock-market recommendations using a multi-provider LLM gateway.

## Features

- Multi-provider LLM gateway
- Multiple independently configured accounts per provider
- Capability-aware routing, retry, fallback, health and quota controls
- Redis-backed distributed quotas
- Local market database with Yahoo fallback
- Shared market-data snapshot for all specialist agents
- Technical, fundamental, news, sector and risk agents
- Deterministic scoring
- Recommendation and critic validation
- Swagger/OpenAPI

## Recommendation Flow

```text
Local DB
   |
   +-- Yahoo fallback
   |
   v
Shared Market Snapshot
   |
   +-- Technical
   +-- Fundamental
   +-- News
   +-- Sector
   +-- Risk
   |
   v
Deterministic Score
   |
   v
Recommendation
   |
   v
Critic
   |
   v
Final Decision
```

All specialists use the same market snapshot so they do not independently fetch different market states.

## Data Sources

```text
DataSourceRouter
      |
      +-- Local DB (primary)
      |
      +-- Yahoo (fallback)
```

The SQL adapter currently supports quote, history, technicals, fundamentals, news, sector and risk data. Its queries must be validated against the actual production database schema before deployment.

## LLM Providers

| Provider | Status |
|---|---|
| Google Gemini | Implemented |
| Groq | Implemented |
| OpenRouter | Implemented |
| Cloudflare Workers AI | Implemented |

### Multiple accounts

Each account has its own provider, credential reference, models, capabilities, health state and quotas.

```ts
{
  id: 'gemini-account-1',
  provider: 'gemini',
  credentialRef: 'env:GEMINI_API_KEY_1',
  models: ['gemini-model-id'],
  capabilities: ['chat', 'streaming'],
  limits: { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 }
}
```

Accounts must be legitimately authorized and must not be used to bypass provider limits or terms.

## Redis

Redis Lua scripts provide atomic RPM/RPD/TPM/TPD quota reservations across multiple gateway instances. Quota failures fail closed.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness |
| POST | `/v1/generate` | Generate response |

Swagger/OpenAPI:

```text
docs/openapi.yaml
docs/swagger-ui.html
```

## Configuration

```bash
cp .env.example .env
```

Typical settings:

```text
NODE_ENV=production
PORT=3000
GATEWAY_API_KEY=<set-at-runtime>
REDIS_URL=redis://localhost:6379
GATEWAY_SHUTDOWN_TIMEOUT_MS=10000
```

Never commit provider credentials or production secrets.

## Local Development

Requirements:

- Node.js **23.8.0**
- npm
- Redis for distributed tests
- Local SQL database for market-data integration
- Provider credentials for live-provider tests

```bash
npm install
npm run build
npm test
```

## Load and Certification

```bash
npm run load:test
npm run load:redis
npm run load:multi
npm run load:sustained
npm run load:fairness
npm run load:failure
npm run certification:batch-e
```

Batch E:

| Phase | Test |
|---|---|
| E1 | Synthetic gateway load |
| E2 | Redis atomic quota concurrency |
| E3 | Multi-instance shared quota |
| E4 | Sustained load |
| E5 | Account fairness |
| E6 | Failure/recovery |
| E7 | Certification evidence |

Recorded results:

```text
E1: 1,000 requests, 50 concurrency, 0 failures, p95 2.91 ms
E2: 100 attempts, 25 accepted, 75 rejected at RPM 25
```

E3-E6 require target-environment evidence before full certification.

## Docker

```bash
docker build -t stock-market-ai-agent:local .
```

## Project Structure

```text
src/
  agents.ts
  agent-runtime.ts
  recommendation.ts
  recommendation-orchestrator.ts
  recommendation-scoring.ts
  tools.ts
  data-sources.ts
  local-db-repository.ts
  gateway.ts
  http.ts
  redis.ts
  providers/

scripts/
test/
docs/
.github/workflows/
Dockerfile
docker-compose.yml
package.json
```

## Security

- Credential references instead of hard-coded secrets
- Agent tool permissions
- Request validation and size limits
- Constant-time API-key comparison
- Fail-closed Redis quotas
- Non-root Docker execution
- Sanitized error metadata

## Status

Core gateway, multi-account routing, Redis quotas, market-data routing, shared evidence, specialist agents, recommendation validation and Swagger/OpenAPI are implemented.

Remaining production work includes validating the real database schema, live-provider contract testing, complete Batch E evidence, ML/quantitative model integration and deployment/security validation.
