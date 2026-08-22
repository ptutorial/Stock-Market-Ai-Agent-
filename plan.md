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
    +--> Concurrency / State Store
    +--> Usage / Cost Tracking
    +--> Health State
```

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

### Note

The Redis state boundary exists, but cross-process atomic quota reservation remains a production integration requirement.

# Phase 9 — Usage, Cost & Accounting

**Status:** Implemented — CI verification pending

### Goals

Normalize provider usage into a consistent request-level accounting model, estimate cost from model/account pricing, and provide aggregated usage reporting without coupling the application to a specific database.

### Completed

- Added `src/usage.ts`.
- Added provider-neutral `UsageRecord`.
- Added `UsageTotals` aggregation contract.
- Added `UsageStore` interface.
- Added usage normalization with derived `totalTokens`.
- Added model-level input/output price calculation.
- Added account-level pricing fallback when model pricing is unavailable.
- Added USD as the default accounting currency when no currency is supplied.
- Added `enrichUsage` for attaching estimated cost to provider usage.
- Added request-level usage record creation.
- Added `InMemoryUsageStore`.
- Added aggregation by account, provider, model and time range.
- Exported usage APIs from `src/index.ts`.
- Added tests for token normalization, cost calculation, account pricing fallback and filtered aggregation.

### Accounting flow

```text
Provider Result
      |
      v
Normalize Usage
      |
      +--> input tokens
      +--> output tokens
      +--> total tokens
      |
      v
Pricing Resolver
      |
      +--> model pricing
      +--> account pricing fallback
      |
      v
UsageRecord
      |
      v
UsageStore
      |
      +--> per-request history
      +--> account totals
      +--> provider totals
      +--> model totals
      +--> time-range totals
```

### Cost formula

```text
estimatedCost =
  (inputTokens  × inputCostPerMillion  / 1,000,000)
+ (outputTokens × outputCostPerMillion / 1,000,000)
```

### Exit criteria

- Provider usage can be normalized. **Complete.**
- Total tokens can be derived when providers omit them. **Complete.**
- Model pricing can produce estimated request cost. **Complete.**
- Account pricing can act as a fallback. **Complete.**
- Usage can be persisted behind a provider-neutral store interface. **Complete.**
- Usage can be aggregated by account/provider/model/time range. **Complete.**
- CI build and test verification. **Pending.**

### Phase note

Persistent database storage, budget enforcement and production-grade financial reconciliation are intentionally deferred. The accounting contract created here is the foundation for those later capabilities.

# Phase 10 — Health Monitoring
**Status:** Planned

# Phase 11 — Observability
**Status:** Planned

# Phase 12 — Security Hardening
**Status:** Planned

# Phase 13 — Comprehensive Testing
**Status:** Planned

# Phase 14 — Developer API & SDK
**Status:** Planned

# Phase 15 — Service/API Layer
**Status:** Optional / Later

# Phase 16 — Redis & Production Scaling
**Status:** Optional / Later

# Phase 17 — Additional Providers
**Status:** Future

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
Phase 10 Health monitoring
Phase 11 Observability
Phase 12 Security hardening
Phase 13 Comprehensive testing
Phase 14 Developer API / SDK
Phase 15 Optional service API
Phase 16 Optional Redis scaling
Phase 17 Additional providers
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
