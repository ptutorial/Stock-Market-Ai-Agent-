# Multi-Provider LLM Gateway — Implementation Plan

## Purpose

This document is the phased implementation roadmap for the multi-provider cloud LLM gateway. Each phase is implemented independently and verified before the next phase is started.

# Phase 0 — Repository Foundation
**Status:** Complete
# Phase 1 — Core Domain Model & Contracts
**Status:** Complete
# Phase 2 — Configuration & Credential Management
**Status:** Complete
# Phase 3 — Provider Adapter SDK
**Status:** Implemented — CI verification pending
# Phase 4 — Model & Capability Discovery
**Status:** Implemented — CI verification pending
# Phase 5 — Account Selection & Routing Engine
**Status:** Implemented — CI verification pending
# Phase 6 — Rate-Limit & Quota Management
**Status:** Implemented — CI verification pending
# Phase 7 — Retry, Failure Classification & Fallback
**Status:** Implemented — CI verification pending
# Phase 8 — Concurrency & Distributed State
**Status:** Implemented — CI verification pending
# Phase 9 — Usage, Cost & Accounting
**Status:** Implemented — CI verification pending
# Phase 10 — Health Monitoring
**Status:** Implemented — CI verification pending
# Phase 11 — Observability
**Status:** Implemented — CI verification pending
# Phase 12 — Security Hardening
**Status:** Implemented — CI verification pending
# Phase 13 — Comprehensive Testing
**Status:** Implemented — CI verification pending
# Phase 14 — Developer API & SDK
**Status:** Implemented — CI verification pending
# Phase 15 — Service/API Layer
**Status:** Implemented — CI verification pending
# Phase 16 — Redis & Production Scaling
**Status:** Implemented — CI verification pending

# Phase 17 — Additional Providers
**Status:** Future

# Phase 18 — Production Readiness Review
**Status:** Hardening in progress

## Phase 18 Hardening — Batch 1 of 3

### Completed in this batch

1. **Production runtime wiring** — `src/server.ts` now loads `LLM_GATEWAY_CONFIG`, flattens enabled accounts, registers all implemented adapters, resolves credentials from environment variables, and fails startup if configured providers have no adapter.
2. **Gateway quota enforcement** — `LLMGateway` now uses the configured `StateStore.reserve()` before provider execution instead of leaving quota state disconnected from request execution.
3. **Redis integration** — `REDIS_URL` now selects `AtomicRedisStateStore` for the production runtime. Redis quota reservation also persists account request/token state atomically.
4. **Model discovery cache** — `LLMGateway` now uses `ModelRegistry`, preventing provider model discovery on every request and allowing TTL-based refresh.
5. **Credential failure isolation** — credential lookup/discovery failures are handled per candidate and do not consume quota before provider execution.
6. **Multi-account verification** — tests cover two-account independent RPM quotas and model-discovery caching. `.env.example` now contains a complete two-Gemini-account configuration example.

### Runtime configuration

The production server now follows:

```text
.env
  ↓
LLM_GATEWAY_CONFIG
  ↓
AccountConfig[]
  ↓
CredentialStore
  ↓
ProviderAdapters
  ↓
StateStore
  ├── Redis when REDIS_URL is set
  └── InMemory otherwise
  ↓
GatewayClient / HTTP API
```

### Remaining Phase 18 hardening batches

**Batch 2 — Routing, health and distributed correctness**

- Fix round-robin cursor advancement.
- Implement real latency-based `fastest` routing.
- Improve utilization scoring and window semantics.
- Add scheduled health checks/recovery.
- Make Redis account-state updates atomic.
- Add distributed health/cooldown state where appropriate.

**Batch 3 — Streaming, HTTP, deployment and verification**

- Harden streaming reliability and usage accounting.
- Add `/health` and `/ready` endpoints.
- Complete graceful shutdown semantics.
- Complete live Redis/provider integration tests.
- Add Docker vulnerability scanning, load/concurrency testing and secret-history scanning.
- Run production deployment smoke tests.

### Important status rule

The repository must not be described as production-certified until the remaining live integration, deployment, security and load checks have passed. A green TypeScript/unit-test CI run is necessary but not sufficient.

# Required final checks

- No API keys in Git history.
- No credentials in logs.
- No provider-specific logic in application code.
- No quota/rate-limit circumvention behavior.
- All retries bounded.
- All fallback decisions capability-aware.
- Concurrent state updates safe.
- Cross-process quota reservations atomic.
- Tests pass.
- CI passes.
- Documentation matches implementation.

# Implementation Order

```text
Phase 0  Foundation                         [DONE]
Phase 1  Core contracts                     [DONE]
Phase 2  Configuration / credentials        [DONE]
Phase 3  Provider adapter SDK               [IMPLEMENTED]
Phase 4  Model / capability discovery       [IMPLEMENTED]
Phase 5  Routing engine                     [IMPLEMENTED]
Phase 6  Rate limits / quotas               [IMPLEMENTED]
Phase 7  Retry / fallback                   [IMPLEMENTED]
Phase 8  Concurrency / distributed state    [IMPLEMENTED]
Phase 9  Usage / cost                       [IMPLEMENTED]
Phase 10 Health monitoring                  [IMPLEMENTED]
Phase 11 Observability                     [IMPLEMENTED]
Phase 12 Security hardening                [IMPLEMENTED]
Phase 13 Comprehensive testing             [IMPLEMENTED]
Phase 14 Developer API / SDK               [IMPLEMENTED]
Phase 15 Service/API layer                 [IMPLEMENTED]
Phase 16 Redis / production scaling        [IMPLEMENTED]
Phase 17 Additional providers
Phase 18 Production readiness              [HARDENING IN PROGRESS]
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
