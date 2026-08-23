# Stock Market AI Agent

A production-oriented TypeScript platform for building **multi-agent stock-market recommendations** on top of a multi-provider LLM gateway.

## Environment & Secrets

All local credentials belong in the root `.env` file. Start from the example:

```bash
cp .env.example .env
```

**Never commit `.env` or real credentials to GitHub.**

### 1. Database credentials

Configure the local market-data SQL database in `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stock_market
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

Use the variable names expected by the database adapter in the current implementation. If your database uses MySQL or another driver, configure the corresponding connection settings used by that adapter.

The SQL repository currently expects market-data tables such as:

```text
stock_daily
fundamentals
news_articles
```

Validate the SQL queries against your actual schema before production use.

### 2. Redis credentials

Configure Redis in `.env`:

```env
REDIS_URL=redis://localhost:6379
```

For authenticated Redis:

```env
REDIS_URL=redis://:your_redis_password@localhost:6379
```

For TLS-enabled Redis, use the connection URL required by your Redis deployment.

Redis is used for atomic distributed quota state, so all gateway instances in a deployment should point to the same Redis instance/cluster.

### 3. Gateway API key

The application API key is configured separately from provider keys:

```env
GATEWAY_API_KEY=your_gateway_api_key
```

Clients send it using the configured authentication header shown in the Swagger/OpenAPI documentation.

### 4. LLM provider API keys

Provider credentials are configured through environment variables and referenced by provider-account configuration.

Example:

```env
GEMINI_API_KEY_1=your_gemini_key
GEMINI_API_KEY_2=your_second_gemini_key
GROQ_API_KEY_1=your_groq_key
OPENROUTER_API_KEY_1=your_openrouter_key
CLOUDFLARE_API_TOKEN_1=your_cloudflare_token
```

Then configure each account with its credential reference:

```ts
{
  id: 'gemini-account-1',
  provider: 'gemini',
  credentialRef: 'env:GEMINI_API_KEY_1',
  models: ['gemini-model-id'],
  capabilities: ['chat', 'streaming'],
  enabled: true,
}
```

Multiple accounts for the same provider are supported:

```ts
{
  id: 'gemini-account-2',
  provider: 'gemini',
  credentialRef: 'env:GEMINI_API_KEY_2',
  models: ['gemini-model-id'],
  capabilities: ['chat', 'streaming'],
  enabled: true,
}
```

Each account can have its own model list, capabilities, priority, quotas, health state, and credential reference.

### Recommended `.env` layout

```env
# Application
NODE_ENV=development
PORT=3000
GATEWAY_API_KEY=change-me
GATEWAY_SHUTDOWN_TIMEOUT_MS=10000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stock_market
DB_USER=stock_user
DB_PASSWORD=change-me

# Redis
REDIS_URL=redis://:change-me@localhost:6379

# LLM provider accounts
GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GROQ_API_KEY_1=...
OPENROUTER_API_KEY_1=...
CLOUDFLARE_API_TOKEN_1=...
```

For production, inject these values through your deployment secret manager rather than storing them in a file.

## What this project does

The application combines structured market data, specialist agents, deterministic quantitative scoring, and an LLM decision layer to produce a validated recommendation.

```text
Stock Request
     |
     v
Canonical Market Snapshot
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
Recommendation Agent
     |
     v
Critic / Final Validation
     |
     v
Recommendation + Evidence
```

## Data sources

```text
Local DB
   |
   +-- fresh data  ------> use
   |
   +-- missing/stale ----> Yahoo fallback
```

The canonical snapshot contains quote, history, technicals, fundamentals, news, sector and risk data, together with source/freshness information.

## Multi-provider LLM gateway

Current adapters:

| Provider | Status |
|---|---|
| Google Gemini | Implemented |
| Groq | Implemented |
| OpenRouter | Implemented |
| Cloudflare Workers AI | Implemented |

The gateway supports capability-aware routing, multiple accounts, retry/fallback, health state, usage/cost accounting, streaming, and Redis-backed quotas.

## Redis quotas

Supported limits:

```text
RPM  requests/minute
RPD  requests/day
TPM  tokens/minute
TPD  tokens/day
```

Redis Lua scripts provide atomic reservation across multiple gateway instances. Quota failures fail closed.

## HTTP API and Swagger

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness |
| `POST` | `/v1/generate` | Generate an LLM response |

Documentation:

```text
docs/openapi.yaml
docs/swagger-ui.html
```

## Running locally

Requirements:

- Node.js **23.8.0**
- npm
- Redis
- Local SQL database
- Provider API keys

```bash
npm install
cp .env.example .env
# Edit .env and add database, Redis, gateway, and LLM credentials.
npm run build
npm test
```

## Docker

```bash
docker build -t stock-market-ai-agent:local .
```

Pass secrets at runtime; do not bake them into the image:

```bash
docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  stock-market-ai-agent:local
```

## Load and certification

```bash
npm run load:test
npm run load:redis
npm run load:multi
npm run load:sustained
npm run load:fairness
npm run load:failure
npm run certification:batch-e
```

## Security

- Never commit `.env` or credentials.
- Never put API keys directly in source code.
- Use separate provider-account credential references.
- Use a secret manager in production.
- Use the same Redis deployment for all gateway instances.
- Rotate exposed credentials immediately.

## Production status

Core gateway, multiple-account routing, Redis quotas, market-data routing, shared evidence, specialist agents, recommendation validation and Swagger/OpenAPI are implemented.

Remaining production work includes validating the real database schema, live-provider contract testing, complete Batch E evidence, ML/quantitative model validation and deployment/security validation.

## Disclaimer

This software generates market analysis and recommendations. It does not guarantee returns and is not financial advice. Validate quantitative models and risk controls independently before using real capital.
