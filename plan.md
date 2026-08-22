# Multi-Provider LLM Gateway — Implementation Plan

## Purpose

This document is the phased implementation roadmap for the multi-provider cloud LLM gateway. Each phase is implemented independently and verified before the next phase is started.

## Target Architecture

```text
Application
    |
    v
LLM Gateway
    |
    +--> Request / Capability Resolver
    +--> Model Registry / Discovery
    +--> Model Router
    +--> Account Selector
    +--> Retry / Backoff
    +--> Provider Fallback
    +--> Usage / Cost Tracking
    +--> Health State
    |
    +--> Gemini Adapter
    +--> Groq Adapter
    +--> OpenRouter Adapter
    +--> Cloudflare Workers AI Adapter
```

Core application contract:

```text
generate(task, prompt, options)
stream(task, prompt, options)
```

The application must not contain provider-specific branching.

---

# Phase 0 — Repository Foundation

**Status:** Complete

---

# Phase 1 — Core Domain Model & Contracts

**Status:** Complete

---

# Phase 2 — Configuration & Credential Management

**Status:** Complete

---

# Phase 3 — Provider Adapter SDK

**Status:** Implemented — CI verification pending

### Completed

- Common HTTP transport abstraction.
- Request timeout and abort handling.
- SSE stream parsing.
- Normalized HTTP/provider errors.
- Retry-After extraction.
- Gemini adapter implementation.
- Groq/OpenRouter OpenAI-compatible adapter implementation.
- Cloudflare Workers AI adapter implementation.
- Completion and streaming support where provider capabilities allow it.
- Tool/function calling support where supported by the adapter contract.
- Usage extraction.
- Model discovery hooks.
- Health-check hooks.
- Provider adapter tests using mocked `fetch`.

### Exit criteria

- Authenticate securely. **Implemented.**
- Generate a completion. **Implemented.**
- Stream where supported. **Implemented.**
- Report capabilities/model information. **Implemented.**
- Return normalized usage/errors. **Implemented.**
- Be mocked without real network calls. **Implemented.**
- CI build and test verification. **Pending.**

---

# Phase 4 — Model & Capability Discovery

**Status:** Implemented — CI verification pending

### Goals

Stop assuming that every model supports every feature and provide a reusable model metadata/cache boundary for routing.

### Completed

- Added `ModelRegistry` in `src/model-registry.ts`.
- Added provider adapter discovery integration through the registry.
- Added TTL-based discovery caching.
- Added forced refresh support.
- Added explicit cache invalidation.
- Normalized discovered provider/model metadata.
- Intersected discovered capabilities with the account's configured capabilities.
- Preserved model availability metadata.
- Added account identity to normalized model metadata.
- Exported `ModelRegistry` from the public package API.
- Added unit tests for cache reuse, forced refresh, invalidation and capability filtering.

### Exit criteria

- Provider model discovery is available through a common registry. **Complete.**
- Static/account model metadata remains usable when provider discovery is limited. **Complete.**
- Model capabilities are represented by `ModelInfo`. **Complete.**
- Cached discovery avoids unnecessary provider calls. **Complete.**
- Capability filtering cannot add capabilities that the account does not permit. **Complete.**
- CI build and test verification. **Pending.**

---

# Phase 5 — Account Selection & Routing Engine

**Status:** Implemented — CI verification pending

### Goals

Build a provider-neutral routing engine that selects an eligible account/model using capability requirements, account health, availability and configurable routing strategy.

### Completed

- Added `src/router.ts` with `ModelRouter`.
- Added candidate generation from accounts, account states, provider adapters and discovered models.
- Added filtering for disabled accounts.
- Added filtering for unhealthy/disabled accounts.
- Added cooldown filtering.
- Added unavailable-model filtering.
- Added explicit model filtering.
- Added capability-aware filtering from request capabilities.
- Added task-to-capability mapping for vision and structured output tasks.
- Added priority routing.
- Added round-robin routing.
- Added least-recently-used routing.
- Added lowest-utilization routing.
- Added fastest routing hook.
- Added cheapest routing.
- Added deterministic ranking through a numeric routing score.
- Exported routing APIs from `src/index.ts`.
- Added routing tests covering eligibility, priority, round robin and candidate generation.

### Routing flow

```text
Generate Request
      |
      v
Candidate Generation
      |
      +--> account enabled?
      +--> account healthy?
      +--> cooldown expired?
      +--> model available?
      +--> model requested?
      +--> capabilities compatible?
      |
      v
Strategy Scoring
      |
      v
Selected Account + Model + Adapter
```

### Exit criteria

- Disabled/unhealthy/cooling-down capacity is excluded. **Complete.**
- Capability-incompatible models are excluded. **Complete.**
- Configurable routing strategy exists. **Complete.**
- Provider-specific branches are absent from application-facing routing. **Complete.**
- Selection does not expose credentials. **Complete.**
- Deterministic routing tests exist. **Complete.**
- CI build and test verification. **Pending.**

### Phase note

Rate-limit-aware capacity accounting, distributed state, retry/fallback and health transitions are deliberately deferred to Phases 6–10. The router currently consumes the `AccountState` supplied to it rather than owning distributed capacity state.

---

# Phase 6 — Rate-Limit & Quota Management

**Status:** Planned

### Goals

Respect provider limits while making efficient use of legitimately configured accounts.

### Tasks

- Normalize rate-limit information.
- Parse `Retry-After`.
- Parse provider-specific rate-limit headers.
- Track RPM.
- Track RPD.
- Track TPM.
- Track TPD.
- Track remaining quota where exposed.
- Track quota reset time where exposed.
- Implement cooldowns.
- Implement bounded retry scheduling.
- Prevent unnecessary retries.
- Prevent account rotation for quota/rate-limit circumvention.

### Important constraint

Multiple accounts may be used for legitimate separation such as projects, organizations, environments, billing ownership or provider-approved quota allocation. They must never be used to bypass provider restrictions.

### Exit criteria

The gateway respects known provider limits and returns a clear error when no eligible capacity remains.

---

# Phase 7 — Retry, Failure Classification & Fallback

**Status:** Planned

### Goals

Make failures recoverable without creating retry storms or incorrect fallbacks.

---

# Phase 8 — Concurrency & Distributed State

**Status:** Planned

### Goals

Make account selection safe when multiple workers issue requests concurrently.

---

# Phase 9 — Usage, Cost & Accounting

**Status:** Planned

### Goals

Create reliable request-level accounting.

---

# Phase 10 — Health Monitoring

**Status:** Planned

### Goals

Maintain reliable provider/account health state.

---

# Phase 11 — Observability

**Status:** Planned

### Goals

Provide metrics, structured logs and tracing without exposing credentials or sensitive prompt/response content.

---

# Phase 12 — Security Hardening

**Status:** Planned

### Goals

Protect credentials, sensitive request data and provider internals.

---

# Phase 13 — Comprehensive Testing

**Status:** Planned

### Goals

Build unit, adapter, integration and security test coverage across the complete gateway.

---

# Phase 14 — Developer API & SDK

**Status:** Planned

### Goals

Make the gateway easy to consume from applications through a stable provider-neutral API.

---

# Phase 15 — Service/API Layer

**Status:** Optional / Later

---

# Phase 16 — Redis & Production Scaling

**Status:** Optional / Later

---

# Phase 17 — Additional Providers

**Status:** Future

Add providers only through the adapter contract.

---

# Phase 18 — Production Readiness Review

**Status:** Future

### Required final checks

- No API keys in Git history.
- No credentials in logs.
- No provider-specific logic in application code.
- No quota/rate-limit circumvention behavior.
- All retries bounded.
- All fallback decisions capability-aware.
- Concurrent state updates safe.
- Tests pass.
- CI passes.
- Documentation matches implementation.

---

# Implementation Order

```text
Phase 0  Foundation                         [DONE]
   |
Phase 1  Core contracts                     [DONE]
   |
Phase 2  Configuration / credentials        [DONE]
   |
Phase 3  Provider adapter SDK               [IMPLEMENTED]
   |
Phase 4  Model / capability discovery       [IMPLEMENTED]
   |
Phase 5  Routing engine                     [IMPLEMENTED]
   |
Phase 6  Rate limits / quotas
   |
Phase 7  Retry / fallback
   |
Phase 8  Concurrency / distributed state
   |
Phase 9  Usage / cost
   |
Phase 10 Health monitoring
   |
Phase 11 Observability
   |
Phase 12 Security hardening
   |
Phase 13 Comprehensive testing
   |
Phase 14 Developer API / SDK
   |
Phase 15 Optional service API
   |
Phase 16 Optional Redis scaling
   |
Phase 17 Additional providers
   |
Phase 18 Production readiness
```

# Definition of Done for Every Phase

Before marking a phase complete:

- Implementation is committed.
- Tests for the phase are added.
- Existing tests still pass.
- No secrets are introduced.
- Documentation is updated.
- Provider-neutral architecture is preserved.
- No provider policy or quota is bypassed.
- The phase's exit criteria are explicitly verified.

# Working Rule

Implement **one phase at a time**. Do not prematurely implement later-phase infrastructure merely because the architecture anticipates it.

When starting a phase, first review the current repository state, identify the exact gap, implement only that phase, run the relevant tests, update this plan's status, and then commit the result.
