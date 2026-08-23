# Stock Market AI Agent

A production-oriented TypeScript platform for building **multi-agent stock-market recommendations** on top of a multi-provider LLM gateway.

The system is designed around a simple principle: **market facts come from data tools and quantitative sources; LLM agents interpret the supplied evidence rather than inventing market data.**

> **Status:** Production-candidate architecture. Core gateway, multi-account routing, Redis atomic quotas, market-data routing, shared stock evidence, specialist agents, recommendation validation, Swagger/OpenAPI, and Batch-E load tooling are implemented. Full production certification still requires target-environment database integration, live-provider contract validation, E3-E6 load evidence, deployment/security validation, and the final certification record.

## Contents

- [What this project does](#what-this-project-does)
- [Recommendation architecture](#recommendation-architecture)
- [Shared market evidence](#shared-market-evidence)
- [Specialist agents](#specialist-agents)
- [Data sources](#data-sources)
- [Local database integration](#local-database-integration)
- [Yahoo fallback](#yahoo-fallback)
- [Deterministic scoring](#deterministic-scoring)
- [Multi-provider LLM gateway](#multi-provider-llm-gateway)
- [Multiple accounts per provider](#multiple-accounts-per-provider)
- [Redis and distributed quotas](#redis-and-distributed-quotas)
- [HTTP API and Swagger](#http-api-and-swagger)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Batch E production certification](#batch-e-production-certification)
- [Project structure](#project-structure)
- [Security](#security)
- [Production-readiness](#production-readiness)

## What this project does

The application combines structured market data, specialist agents, deterministic quantitative scoring, and an LLM decision layer to produce a validated recommendation.

```text
                         Stock / Symbol Request
                                  |
                                  v
                         +-------------------+
                         | Canonical Snapshot |
                         +---------+---------+
                                   |
       +---------------------------+---------------------------+
       |             |             |             |             |
       v             v             v             v             v
   Technical     Fundamental      News         Sector         Risk
     Agent          Agent         Agent         Agent         Agent
       |             |             |             |             |
       +-------------+-------------+-------------+-------------+
                                   |
                                   v
                       Deterministic Quant Score
                                   |
                                   v
                         Recommendation Agent
                                   |
                                   v
                              Critic Agent
                                   |
                                   v
                         Final Decision Validator
                                   |
                                   v
                           Recommendation +
                         Evidence + Provenance
```

The five specialist agents are intended to execute concurrently because they are independent analyses of the same market snapshot.

## Recommendation architecture

The recommendation pipeline separates **data acquisition**, **analysis**, and **decisioning**:

1. Resolve the requested stock/symbol.
2. Build one canonical market-data snapshot.
3. Preserve source and freshness metadata for every dataset.
4. Run technical, fundamental, news, sector, and risk specialists against the same evidence.
5. Calculate deterministic quantitative scores outside the LLM.
6. Ask the recommendation agent to synthesize the evidence and quantitative results.
7. Run a critic/validation stage.
8. Fail closed when the final recommendation does not satisfy the required structured contract.
9. Return the recommendation together with evidence/provenance suitable for audit.

This prevents each specialist from independently fetching potentially different market states and reduces duplicated data-source calls.

## Shared market evidence

The canonical snapshot contains the major datasets required by the recommendation pipeline:

```text
quote
history
technicals
fundamentals
news
sector strength
risk
```

The snapshot is collected concurrently and retains data-source metadata such as:

```text
source
fetchedAt
observedAt
freshness
fallback
```

Specialists consume the shared evidence rather than repeatedly querying the same market-data tools.

### Evidence principle

LLM agents are not authoritative market-data sources. They must reason from supplied tool evidence and clearly distinguish observations from inferences.

## Specialist agents

| Agent | Responsibility |
|---|---|
| Technical | Trend, momentum, volatility, moving averages, RSI, volume, support/resistance |
| Fundamental | Valuation, growth, profitability, leverage, cash flow |
| News | Recent news and sentiment evidence |
| Sector | Sector classification and relative sector strength |
| Risk | Beta and other available risk metrics |

Agent tool access is explicitly registered. An agent cannot invoke a tool that is outside its declared permission set.

The runtime also supports evidence-only execution when the canonical snapshot has already been created.

## Data sources

The application uses a provider-neutral market-data abstraction:

```text
MarketDataSource
    |
    +-- quote
    +-- history
    +-- technicals
    +-- fundamentals
    +-- news
    +-- sectorStrength
    +-- risk
```

`DataSourceRouter` supports ordered sources and fallback based on freshness state.

```text
                 DataSourceRouter
                       |
              +--------+--------+
              |                 |
              v                 v
          Local DB            Yahoo
          primary           fallback
```

A source can report `fresh`, `stale`, `missing`, or `unknown`. The router can fall back when configured freshness conditions are not satisfied.

## Local database integration

Most market data can be supplied from a local SQL database through the `SqlMarketDataRepository` adapter.

The current adapter provides repository operations for:

- Quote
- Historical OHLCV
- Technical indicators
- Fundamentals
- News
- Sector information
- Risk metrics

The current implementation expects a schema containing tables/columns represented by queries such as:

```text
stock_daily
fundamentals
news_articles
```

with fields for prices, OHLCV, technical indicators, fundamentals, news, sector, and risk data.

**Important:** the repository adapter is schema-specific. Before production deployment, its SQL queries must be validated against the actual local database schema and exercised through integration tests. Do not assume the example schema matches an arbitrary production database.

### Database boundary

The application keeps SQL-specific logic behind `SqlExecutor`/`SqlMarketDataRepository`, allowing the recommendation and agent layers to remain database-independent.

## Yahoo fallback

Yahoo can be configured as a fallback data source when local data is unavailable or outside the configured freshness window.

The intended model is:

```text
Local DB
   |
   +-- fresh data  ------> use it
   |
   +-- missing/stale ----> Yahoo fallback
                              |
                              v
                         routed evidence
```

Yahoo should be treated primarily as a raw market-data fallback. Derived analytics should only be considered authoritative when the corresponding data is actually available and validated.

## Deterministic scoring

The recommendation pipeline includes a deterministic scoring layer so the final decision is not based solely on an LLM-generated numerical score.

The scoring layer consumes structured evidence and produces quantitative components for:

```text
technical
fundamental
news
sector
risk
overall
```

The LLM is responsible for interpreting evidence and explaining a decision; deterministic calculations provide a reproducible quantitative input.

> **Production note:** the current scoring formulas are an initial deterministic layer, not a substitute for a fully validated quantitative trading model. Sector-specific calibration, backtesting, and ML integration remain required before using scores as a trading signal.

## ML integration roadmap

The architecture is intended to support an existing quantitative/ML model as another evidence source rather than replacing it with an LLM.

Target flow:

```text
Historical DB
     |
     v
Feature Engineering
     |
     v
ML / XGBoost Model
     |
     v
Prediction + Probability
     |
     v
Canonical Evidence
     |
     +--------------------+
     |                    |
     v                    v
Specialist Agents     Deterministic Score
     |                    |
     +---------+----------+
               |
               v
        Final Recommendation
```

The model should be evaluated separately using historical out-of-sample data and should not be considered production-certified merely because the LLM pipeline passes its software tests.

## Multi-provider LLM gateway

The gateway provides a common abstraction for generation and streaming across providers.

Current adapters include:

| Provider | Adapter |
|---|---|
| Google Gemini | `GeminiAdapter` |
| Groq | `GroqAdapter` |
| OpenRouter | `OpenRouterAdapter` |
| Cloudflare Workers AI | `CloudflareWorkersAIAdapter` |

The gateway supports:

- Capability-aware routing
- Account selection
- Priority and load-aware routing strategies
- Retry/backoff
- Cooldowns
- Health state
- Provider/account fallback
- RPM/RPD/TPM/TPD controls
- Usage/cost accounting
- Streaming
- Normalized errors
- Redis-backed distributed state

## Multiple accounts per provider

Multiple independently configured accounts can be registered for the same provider.

Example:

```ts
const accounts = [
  {
    id: 'gemini-account-1',
    provider: 'gemini',
    credentialRef: 'env:GEMINI_API_KEY_1',
    models: ['gemini-model-id'],
    capabilities: ['chat', 'streaming'],
    priority: 10,
    enabled: true,
    limits: { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 },
  },
  {
    id: 'gemini-account-2',
    provider: 'gemini',
    credentialRef: 'env:GEMINI_API_KEY_2',
    models: ['gemini-model-id'],
    capabilities: ['chat', 'streaming'],
    priority: 10,
    enabled: true,
    limits: { rpm: 60, rpd: 10000, tpm: 100000, tpd: 1000000 },
  },
];
```

Each account is independently eligible for routing, quota tracking, health state, and failure handling.

Multiple accounts are intended only for legitimately authorized accounts. They must not be used to circumvent provider terms, quotas, or access controls.

## Redis and distributed quotas

Redis provides atomic shared state for horizontally scaled gateway instances.

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

Quota reservation is performed atomically using Redis Lua execution so concurrent instances cannot independently approve reservations beyond the configured limits.

Supported dimensions include:

```text
RPM  requests/minute
RPD  requests/day
TPM  tokens/minute
TPD  tokens/day
```

Redis quota failures are designed to fail closed.

## HTTP API and Swagger

Current HTTP endpoints include:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness and healthy-account count |
| `POST` | `/v1/generate` | Generate an LLM response |

OpenAPI documentation is maintained in:

```text
docs/openapi.yaml
docs/swagger-ui.html
```

The OpenAPI document is version **3.0.3** and includes interactive Bearer authorization through the static Swagger UI.

When the HTTP contract changes, update the OpenAPI document and its contract tests in the same change.

## Environment configuration

```bash
cp .env.example .env
```

Typical configuration:

```text
NODE_ENV=production
PORT=3000
GATEWAY_API_KEY=<set-at-runtime>
REDIS_URL=redis://localhost:6379
GATEWAY_SHUTDOWN_TIMEOUT_MS=10000
```

Provider credentials should be supplied through the configured credential store/environment references. Never commit real API keys or production secrets.

## Running locally

### Requirements

- Node.js **23.8.0**
- npm
- Redis for distributed-state and load testing
- Local SQL database containing the expected market-data schema for DB integration
- Provider credentials for live provider contract tests

Install and build:

```bash
npm install
npm run build
```

Run the complete automated test suite:

```bash
npm test
```

Run recommendation-specific tests:

```bash
npm run test:recommendation
```

## Docker

The repository includes a production-oriented multi-stage Dockerfile.

```bash
docker build -t stock-market-ai-agent:local .
```

Redis and the local market-data database can be supplied as external services or through the development environment.

## Batch E production certification

Batch E is the load/concurrency certification track for the LLM gateway.

| Phase | Certification | Command | Status/evidence |
|---|---|---|---|
| E1 | Synthetic gateway load | `npm run load:test` | ✅ Passed |
| E2 | Redis atomic quota concurrency | `npm run load:redis` | ✅ Passed |
| E3 | Multi-instance shared quota | `npm run load:multi` | ⏳ Evidence required |
| E4 | Sustained load | `npm run load:sustained` | ⏳ Evidence required |
| E5 | Account fairness | `npm run load:fairness` | ⏳ Evidence required |
| E6 | Failure/recovery under load | `npm run load:failure` | ⏳ Evidence required |
| E7 | Certification report/evidence gate | `npm run certification:batch-e` | ⏳ Final gate |

### Recorded E1 result

```text
1,000 requests
50 concurrency
1,000 completed
0 failed
1,000 provider calls
29,212 RPS
p95 2.91 ms
1,000 state requests
```

### Recorded E2 result

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

E3-E6 must be executed against the target environment and their JSON outputs retained as release evidence before Batch E can be declared fully certified.

## Testing

Useful commands:

```bash
npm run build
npm test
npm run test:recommendation
npm run load:test
npm run load:redis
npm run load:multi
npm run load:sustained
npm run load:fairness
npm run load:failure
npm run certification:batch-e
```

The build and test suite must be green before proceeding to load certification.

## Project structure

```text
.
├── src/
│   ├── agents.ts
│   ├── agent-runtime.ts
│   ├── recommendation.ts
│   ├── recommendation-orchestrator.ts
│   ├── recommendation-scoring.ts
│   ├── tools.ts
│   ├── data-sources.ts
│   ├── local-db-repository.ts
│   ├── market-data.ts
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

## Security

Security boundaries include:

- Credential references instead of hard-coded provider secrets
- Provider-neutral authentication/error handling
- Request ID validation
- Request-size limits
- Constant-time gateway API-key comparison
- Outbound access controls and redirect protection
- Sanitized error metadata
- Fail-closed Redis quota behavior
- Non-root Docker execution
- Explicit agent tool permissions

Never commit API keys, access tokens, private keys, provider secrets, production `.env` files, or Redis credentials.

## Production-readiness

### Gateway

- [x] Provider abstraction
- [x] Multiple-account routing
- [x] Capability-aware selection
- [x] Retry/fallback handling
- [x] Health/quarantine state
- [x] Usage/cost normalization
- [x] HTTP API
- [x] SDK
- [x] Redis atomic quota implementation
- [x] Swagger/OpenAPI

### Recommendation system

- [x] Canonical market-data snapshot
- [x] Source/freshness provenance
- [x] Five specialist agents
- [x] Parallel specialist execution
- [x] Evidence-only specialist execution
- [x] Deterministic scoring layer
- [x] Recommendation synthesis
- [x] Critic/final validation
- [ ] Production-calibrated quantitative scoring
- [ ] ML/XGBoost prediction integration
- [ ] Historical out-of-sample validation

### Data integration

- [x] Local DB repository abstraction
- [x] SQL market-data adapter
- [x] Data-source routing
- [x] Freshness-aware fallback
- [ ] Validate SQL queries against the real production schema
- [ ] Production DB integration tests
- [ ] Live Yahoo fallback contract tests

### Certification

- [x] TypeScript build
- [x] Automated test suite
- [x] E1 synthetic load
- [x] E2 Redis atomic quota
- [ ] E3 multi-instance shared quota evidence
- [ ] E4 sustained-load evidence
- [ ] E5 account-fairness evidence
- [ ] E6 failure/recovery evidence
- [ ] E7 final certification report

### Deployment

- [x] Docker build path
- [x] CI build/test path
- [ ] Live provider contract tests
- [ ] Container vulnerability scan
- [ ] Production deployment smoke test
- [ ] Redis HA/backup validation
- [ ] Monitoring and alerting configuration
- [ ] Production secret-management integration

## Important production disclaimer

This project is a software and research platform for generating market-analysis recommendations. Passing software tests, load tests, or LLM evaluation does **not** establish that a recommendation is profitable or suitable for trading.

Before using recommendations for real capital, validate the quantitative model with historical and out-of-sample testing, account for transaction costs/slippage, establish risk limits, and independently verify market-data quality and freshness.

## License

Add the project's applicable license here before public distribution.
