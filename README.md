# 🚀 Stock Market AI Agent

A TypeScript platform for multi-agent stock-market analysis and recommendations using market data, deterministic scoring, and a multi-provider LLM gateway.

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-2ea44f?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-23.x-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/MySQL-8.x-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
  <img src="https://img.shields.io/badge/Redis-6379-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
</p>

## 📌 What it does

The application combines structured market data, specialist agents, deterministic quantitative scoring, and an LLM decision layer to produce a validated recommendation.

```text
Stock Request
     ↓
Canonical Market Snapshot
     ↓
Technical ─ Fundamental ─ News ─ Sector ─ Risk
     ↓
Deterministic Quantitative Score
     ↓
Recommendation Agent
     ↓
Critic / Final Validation
     ↓
Recommendation + Evidence + Provenance
```

## 🤖 Multi-provider LLM gateway

Supported providers:

- 🔵 Google Gemini
- 🟠 Groq
- ⚫ OpenRouter
- 🟧 Cloudflare Workers AI

The gateway supports capability-aware routing, retries, cooldowns, health state, provider/account fallback, quotas, usage accounting, streaming, and normalized errors.

### 🔑 Dynamic multi-account configuration

There is **no hard-coded account limit**. Add as many numbered accounts as required:

```env
GEMINI_API_KEY_1=your_gemini_key_1
GEMINI_API_KEY_2=your_gemini_key_2
GEMINI_API_KEY_3=your_gemini_key_3

GROQ_API_KEY_1=your_groq_key_1
GROQ_API_KEY_2=your_groq_key_2

OPENROUTER_API_KEY_1=your_openrouter_key_1
OPENROUTER_API_KEY_2=your_openrouter_key_2

CLOUDFLARE_API_TOKEN_1=your_cloudflare_token_1
CLOUDFLARE_API_TOKEN_2=your_cloudflare_token_2
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Account numbering does not need to be contiguous. The gateway dynamically discovers the numbered credentials.

Use only accounts and credentials you are legitimately authorized to use; do not use multiple accounts to circumvent provider terms or quotas.

## 🗄️ Database configuration

The application uses MySQL for local database configuration.

Create your local environment file:

```bash
cp .env.example .env
```

Then configure:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=laravel
```

Make sure the MySQL database and user exist before starting the application.

## 🔴 Redis configuration

Redis is used for shared state and distributed quota/rate-limit coordination.

The local configuration is:

```env
REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379
```

For a password-protected Redis instance:

```env
REDIS_PASSWORD=your_redis_password
REDIS_URL=redis://:your_redis_password@127.0.0.1:6379
```

## 🔐 Environment and secrets

`.env.example` is the configuration template. For local development:

```bash
cp .env.example .env
```

Edit `.env` with your real database, Redis, gateway, and LLM credentials.

**Never commit `.env` or real API credentials to GitHub.**

For production, inject secrets through the deployment environment or a secret manager.

### Gateway API key

```env
GATEWAY_API_KEY=your_gateway_api_key
```

### LLM credentials

```env
GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GROQ_API_KEY_1=...
OPENROUTER_API_KEY_1=...
CLOUDFLARE_API_TOKEN_1=...
```

## 🧮 Market data and recommendation pipeline

The market-data layer is provider-neutral and supports quote, history, technicals, fundamentals, news, sector, and risk data. A canonical stock snapshot preserves source and freshness information so specialist agents work from a consistent evidence set.

Deterministic scoring produces reproducible technical, fundamental, news, sector, risk, and overall components. The LLM interprets supplied evidence rather than inventing market facts.

The current scoring formulas are an initial deterministic layer and require calibration, backtesting, and out-of-sample validation before use with real capital.

## 🌐 HTTP API and Swagger

The gateway API runs on the configured `PORT`. For the current local setup, use `PORT=3001` in `.env`:

```env
PORT=3001
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness |
| `POST` | `/v1/generate` | Generate an LLM response |

### Swagger UI on port 3005

Start the gateway first:

```bash
npm start
```

Then, in a second terminal, start Swagger UI:

```bash
npm run swagger
```

Open:

```text
http://localhost:3005/
```

Swagger serves the OpenAPI specification from:

```text
http://localhost:3005/openapi.yaml
```

The Swagger UI is configured to send API requests to the local gateway on `http://localhost:3001` by default. If the gateway is running on another port, pass it in the Swagger URL:

```text
http://localhost:3005/?api=http://localhost:3002
```

For example, to authenticate `/v1/generate`, click **Authorize** in Swagger UI and enter:

```text
Bearer YOUR_GATEWAY_API_KEY
```

Do not expose the gateway API key in source control.

## ▶️ Local setup

Requirements:

- Node.js **23.8.0**
- npm
- MySQL
- Redis
- Provider credentials for live-provider tests

Install dependencies:

```bash
npm install
```

Create configuration:

```bash
cp .env.example .env
```

Edit `.env`, then build and test:

```bash
npm run build
npm test
```

Start the API:

```bash
npm start
```

Start Swagger UI in another terminal:

```bash
npm run swagger
```

Recommendation tests:

```bash
npm run test:recommendation
```

## 🧪 Tests

Tests are organized by responsibility:

```text
test/
├── unit/
│   ├── agents/
│   ├── config/
│   ├── infrastructure/
│   ├── http/
│   └── llm/
└── integration/
    ├── database/
    └── recommendation/
```

Run the complete suite:

```bash
npm test
```

Other available checks:

```bash
npm run build
npm run test:recommendation
npm run load:test
npm run load:redis
npm run load:multi
npm run load:sustained
npm run load:fairness
npm run load:failure
```

## 🐳 Docker

```bash
docker build -t stock-market-ai-agent:local .
```

Run with environment configuration:

```bash
docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  stock-market-ai-agent:local
```

Do not bake credentials into Docker images.

## 📁 Project structure

```text
.
├── src/
│   ├── modules/
│   │   ├── agents/
│   │   ├── recommendation/
│   │   ├── market/
│   │   ├── tools/
│   │   └── llm/
│   │       ├── accounts/
│   │       ├── providers/
│   │       ├── policies/
│   │       ├── gateway/
│   │       └── agent/
│   ├── data-sources.ts
│   ├── local-db-repository.ts
│   ├── market-data.ts
│   ├── http.ts
│   ├── server.ts
│   └── index.ts
├── test/
│   ├── unit/
│   └── integration/
├── scripts/
│   ├── swagger-server.mjs
│   └── ...
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
- Keep provider credentials separate from the gateway API key.
- Rotate credentials immediately if they are exposed.
- Use explicit agent tool permissions.
- Do not use account rotation to bypass provider restrictions.

## 📄 License

This project is licensed under the **MIT License**. See [`LICENSE`](LICENSE).

## ⚠️ Disclaimer

This software is an engineering system for market analysis and recommendation generation. It does not guarantee returns and should not be treated as financial advice. Quantitative models and recommendations require independent validation, monitoring, and appropriate risk controls before use with real capital.
