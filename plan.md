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
    +--> Rate Limit / Quota Tracker
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

---

# Phase 4 — Model & Capability Discovery

**Status:** Implemented — CI verification pending

### Completed

- `ModelRegistry` with TTL cache.
- Forced refresh and invalidation.
- Model metadata normalization.
- Capability filtering against account configuration.
- Model availability tracking.
- Registry tests.

---

# Phase 5 — Account Selection & Routing Engine

**Status:** Implemented — CI verification pending

### Completed

- Provider-neutral `ModelRouter`.
- Candidate generation.
- Account/model eligibility filtering.
- Capability-aware selection.
- Health and cooldown filtering.
- Priority, round-robin, LRU, utilization, fastest and cheapest strategy hooks.
- Deterministic routing tests.

---

# Phase 6 — Rate-Limit & Quota Management

**Status:** Implemented — CI verification pending

### Goals

Respect configured provider limits and normalize rate-limit signals without attempting to bypass provider restrictions.

### Completed

- Added `src/limits.ts` with `RateLimitTracker`.
- RPM enforcement.
- RPD enforcement.
- TPM enforcement.
- TPD enforcement.
- Minute and daily rolling windows.
- Request/token accounting per account.
- `Retry-After` parsing for seconds and HTTP-date values.
- Common `X-RateLimit-*` header parsing.
- Account cooldown tracking after rate-limit responses.
- Rate-limited state merge helper.
- Public export through `src/index.ts`.
- Unit tests for RPM/TPM, RPD, cooldowns and header parsing.

### Rate-limit flow

```text
Provider Response
      |
      +--> Rate-limit headers
      +--> Retry-After
      |
      v
RateLimitTracker
      |
      +--> record request/tokens
      +--> enforce RPM/RPD
      +--> enforce TPM/TPD
      +--> calculate cooldown
      |
      v
Routing eligibility
```

### Important constraint

Multiple accounts may be used for legitimate separation such as projects, organizations, environments, billing ownership or provider-approved quota allocation. They must never be used to bypass provider restrictions.

### Exit criteria

- RPM/RPD limits are enforced. **Complete.**
- TPM/TPD limits are enforced. **Complete.**
- Provider `Retry-After` information can create cooldown state. **Complete.**
- Common rate-limit headers can be normalized. **Complete.**
- Account capacity can be checked before routing. **Complete.**
- Rate-limit tracking does not rotate accounts as a quota-bypass mechanism. **Complete.**
- CI build and test verification. **Pending.**

### Phase note

Distributed atomic counters and cross-worker quota coordination belong to Phase 8. Retry scheduling and provider fallback belong to Phase 7. This phase deliberately provides the local rate-limit/quota boundary those phases will consume.

---

# Phase 7 — Retry, Failure Classification & Fallback

**Status:** Planned

### Goals

Make failures recoverable without creating retry storms or incorrect fallbacks.

---

# Phase 8 — Concurrency & Distributed State

**Status:** Planned

### Goals

Make account selection and quota state safe when multiple workers issue requests concurrently.

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
Phase 6  Rate limits / quotas               [IMPLEMENTED]
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
