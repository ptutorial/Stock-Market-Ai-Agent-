# 🚀 Stock Market AI Agent

A production-oriented TypeScript platform for building **multi-agent stock-market recommendations** on top of a multi-provider LLM gateway.

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-2ea44f?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-23.x-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Redis-atomic%20quotas-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/OpenAPI-3.0.3-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white" alt="OpenAPI" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Gemini-supported-4285F4?style=flat-square&logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/Groq-supported-F55036?style=flat-square" alt="Groq" />
  <img src="https://img.shields.io/badge/OpenRouter-supported-111827?style=flat-square" alt="OpenRouter" />
  <img src="https://img.shields.io/badge/Cloudflare%20AI-supported-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare AI" />
</p>

> **Status:** Production-candidate architecture. Core gateway, multi-account routing, Redis atomic quotas, market-data routing, shared stock evidence, specialist agents, recommendation validation, Swagger/OpenAPI, and load tooling are implemented. Full production readiness still requires target-environment database integration, live-provider contract validation, deployment/security validation, and final certification.

## 📌 What this project does

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

The five specialist agents execute against the same canonical market snapshot so independent agents do not repeatedly fetch potentially different market states.

## 🧠 Recommendation architecture

The pipeline separates **data acquisition**, **analysis**, and **decisioning**:

1. Resolve the requested stock/symbol.
2. Build one canonical market-data snapshot.
3. Preserve source and freshness metadata.
4. Run technical, fundamental, news, sector, and risk specialists.
5. Calculate deterministic quantitative scores outside the LLM.
6. Synthesize the evidence through the recommendation agent.
7. Run critic/final validation.
8. Fail closed when the final structured contract is invalid.
9. Return the recommendation with evidence/provenance suitable for audit.

### Specialist agents

| Agent | Responsibility |
|---|---|
| 📈 Technical | Trend, momentum, volatility, moving averages, RSI, volume, support/resistance |
| 💰 Fundamental | Valuation, growth, profitability, leverage, cash flow |
| 📰 News | Recent news and sentiment evidence |
| 🏭 Sector | Sector classification and relative sector strength |
| 🛡️ Risk | Beta and available risk metrics |

Agent tool access is explicitly registered. An agent cannot invoke a tool outside its declared permission set.

## 🗄️ Market data

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

`DataSourceRouter` supports ordered sources and freshness-aware fallback.

```text
                 DataSourceRouter
                       |
              +--------+--------+
              |                 |
              v                 v
          Local DB            Yahoo
          primary           fallback
```

The canonical snapshot retains source/freshness information such as `source`, `fetchedAt`, `observedAt`, `freshness`, and `fallback`.

### Local database

Most market data can be supplied through `SqlMarketDataRepository`.

The current adapter provides repository operations for:

- Quote
- Historical OHLCV
- Technical indicators
- Fundamentals
- News
- Sector information
- Risk metrics

The repository is schema-specific. Validate its SQL against the actual database schema before production deployment.

### Yahoo fallback

Yahoo can be configured as a fallback when local data is unavailable or outside the configured freshness window. It should be treated primarily as a raw market-data fallback; derived analytics must be validated before being treated as authoritative.

## 📊 Deterministic scoring & ML roadmap

The deterministic scoring layer produces reproducible components for:

```text
technical
fundamental
news
sector
risk
overall
```

The LLM interprets supplied evidence; deterministic calculations provide quantitative inputs.

> The current formulas are an initial deterministic layer, not a fully validated trading model. Calibration, backtesting, and out-of-sample validation remain required.

The architecture can also incorporate an ML/XGBoost model:

```text
Historical DB → Feature Engineering → ML/XGBoost
                                      |
                                      v
                              Prediction + Probability
                                      |
                                      v
                              Canonical Evidence
                                      |
                           Agents + Quant Score
                                      |
                                      v
                              Recommendation
```

## 🤖 Multi-provider LLM gateway

The gateway provides a common abstraction for generation and streaming across providers.

| Provider | Adapter |
|---|---|
| 🔵 Google Gemini | `GeminiAdapter` |
| 🟠 Groq | `GroqAdapter` |
| ⚫ OpenRouter | `OpenRouterAdapter` |
| 🟧 Cloudflare Workers AI | `CloudflareWorkersAIAdapter` |

Supported capabilities include:

- Capability-aware routing
- Multiple accounts per provider
- Priority/load-aware routing
- Retry/backoff
- Cooldowns
- Health state
- Provider/account fallback
- RPM/RPD/TPM/TPD controls
- Usage/cost accounting
- Streaming
- Normalized errors
- Redis-backed distributed state

## 🔑 Dynamic multi-account configuration

You can configure **any number of accounts per provider**. There is no hard-coded five-account limit.

Add numbered credentials to `.env`:

```env
GEMINI_API_KEY_1=your_gemini_key_1
GEMINI_API_KEY_2=your_gemini_key_2
GEMINI_API_KEY_3=your_gemini_key_3
GROQ_API_KEY_1=your_groq_key_1
GROQ_API_KEY_2=your_groq_key_2
OPENROUTER_API_KEY_1=your_openrouter_key_1
CLOUDFLARE_API_TOKEN_1=your_cloudflare_token_1
```

The gateway dynamically discovers the configured numbered credentials. You can add account `10` without creating accounts `4` through `9`; configured keys are discovered independently.

Conceptually:

```text
GEMINI_API_KEY_1  ─┐
GEMINI_API_KEY_2  ─┤
GEMINI_API_KEY_N  ─┤→ Dynamic Account Loader → Gemini accounts
                   │
GROQ_API_KEY_*    ─┤→ Dynamic Account Loader → Groq accounts
OPENROUTER_*      ─┤→ Dynamic Account Loader → OpenRouter accounts
CLOUDFLARE_*      ─┘→ Dynamic Account Loader → Cloudflare accounts
```

Each account can maintain its own model list, capabilities, priority, quotas, health state, cooldown state, usage, and credential reference.

Multiple accounts must represent legitimately authorized accounts and must not be used to circumvent provider terms, quotas, or access controls.

## 🧮 Redis & distributed quotas

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

Quota reservation uses atomic Redis Lua execution so concurrent instances cannot independently approve reservations beyond configured limits.

Supported dimensions:

```text
RPM  requests/minute
RPD  requests/day
TPM  tokens/minute
TPD  tokens/day
```

Redis quota failures are designed to fail closed.

## 🌐 HTTP API & Swagger

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness and healthy-account count |
| `POST` | `/v1/generate` | Generate an LLM response |

OpenAPI documentation:

```text
docs/openapi.yaml
docs/swagger-ui.html
```

The OpenAPI document is version **3.0.3** and includes interactive Bearer authorization through the static Swagger UI.

## 🔐 Environment & secrets

All local credentials belong in the root `.env` file:

```bash
cp .env.example .env
```

**Never commit `.env` or real credentials to GitHub.**

### Database

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stock_market
DB_USER=stock_user
DB_PASSWORD=change-me
```

Use the exact connection variables expected by the database adapter in `src/`.

### Redis

```env
REDIS_URL=redis://localhost:6379
```

Authenticated Redis:

```env
REDIS_URL=redis://:your_redis_password@localhost:6379
```

### Gateway API key

```env
GATEWAY_API_KEY=your_gateway_api_key
```

### LLM keys

```env
GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GROQ_API_KEY_1=...
OPENROUTER_API_KEY_1=...
CLOUDFLARE_API_TOKEN_1=...
```

For production, inject secrets through a deployment secret manager instead of storing them in a file.

## ▶️ Running locally

Requirements:

- Node.js **23.8.0**
- npm
- Redis
- Local SQL database
- Provider credentials for live-provider tests

```bash
npm install
cp .env.example .env
# Edit .env
npm run build
npm test
```

Recommendation tests:

```bash
npm run test:recommendation
```

## 🐳 Docker

```bash
docker build -t stock-market-ai-agent:local .
```

Pass secrets at runtime rather than baking them into the image:

```bash
docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  stock-market-ai-agent:local
```

## 🧰 Testing

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
```

## 📁 Project structure

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
├── test/
├── docs/
│   ├── openapi.yaml
│   ├── swagger-ui.html
│   └── architecture.md
├── .github/workflows/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── LICENSE
├── package.json
└── README.md
```

## 🛡️ Security

- Never commit `.env` or credentials.
- Never put API keys directly in source code.
- Use credential references for provider accounts.
- Use a secret manager in production.
- Use shared Redis for distributed quotas.
- Rotate exposed credentials immediately.
- Use explicit agent tool permissions.
- Keep provider credentials separate from the gateway API key.

## 📋 Production readiness

### Gateway

- [x] Provider abstraction
- [x] Dynamic multiple-account routing
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
- [ ] Validate against production database schema
- [ ] Live Yahoo contract validation
- [ ] End-to-end DB integration tests

## 📄 License

This project is licensed under the **MIT License**. See [`LICENSE`](LICENSE).

## ⚠️ Disclaimer

This software is an engineering system for market analysis and recommendation generation. It does not guarantee returns and should not be treated as financial advice. Quantitative models and recommendations require independent validation, monitoring, and appropriate risk controls before use with real capital.
