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

### Discovery model

```text
Provider Adapter
      |
      v
ModelRegistry
      |
      +--> Discover models
      +--> Normalize metadata
      +--> Cache with TTL
      +--> Refresh / invalidate
      |
      v
Routing Engine
```

### Exit criteria

- Provider model discovery is available through a common registry. **Complete.**
- Static/account model metadata remains usable when provider discovery is limited. **Complete.**
- Model capabilities are represented by `ModelInfo`. **Complete.**
- Cached discovery avoids unnecessary provider calls. **Complete.**
- Capability filtering cannot add capabilities that the account does not permit. **Complete.**
- CI build and test verification. **Pending.**

### Phase note

The registry is intentionally introduced as a standalone component. Full routing integration and advanced capability-aware selection belong to Phase 5.

---

# Phase 5 — Account Selection & Routing Engine

**Status:** Planned

### Goals

Build the intelligent selection engine described in the specification.

### Routing strategies

Implement and test:

- Priority.
- Round robin.
- Least recently used.
- Lowest recent utilization.
- Fastest provider.
- Cheapest provider.
- Best model.
- Capability-based routing.

### Tasks

- Build candidate generation.
- Filter disabled accounts.
- Filter unhealthy accounts.
- Filter cooling-down accounts.
- Filter incompatible capabilities.
- Filter unavailable models.
- Calculate routing score.
- Make strategy configurable.
- Make provider fallback order configurable.
- Add deterministic routing tests.

### Exit criteria

For every request the router can explain why a provider/account/model was selected without exposing credentials.

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

### Retryable failures

- Rate limit.
- Timeout.
- Connection failure.
- Temporary provider outage.
- Provider 5xx.
- Temporarily unavailable model.

### Non-blind-fallback failures

- Invalid request.
- Authentication failure.
- Unsupported capability.
- Malformed input.

### Tasks

- Normalize errors.
- Define retryability.
- Add exponential backoff.
- Add jitter.
- Respect `Retry-After`.
- Limit retry count.
- Configure fallback chain.
- Track retry count.
- Track fallback count.
- Prevent retry storms.
- Test provider outage scenarios.

### Example

```text
Gemini
  -> Groq
  -> OpenRouter
  -> Cloudflare
```

### Exit criteria

Temporary failures can recover through retry or fallback while invalid requests are not silently transformed into unrelated provider requests.

---

# Phase 8 — Concurrency & Distributed State

**Status:** Planned

### Goals

Make account selection safe when multiple workers issue requests concurrently.

### Tasks

- Define atomic account-state updates.
- Prevent concurrent over-allocation.
- Protect rate-limit counters.
- Protect cooldown state.
- Protect health transitions.
- Protect routing cursors.
- Define in-memory implementation for single process.
- Define Redis-backed state implementation for distributed deployments.
- Add locking/reservation strategy where necessary.
- Test concurrent requests.

### Exit criteria

Multiple workers cannot incorrectly treat one account as having unlimited capacity.

---

# Phase 9 — Usage, Cost & Accounting

**Status:** Planned

### Goals

Create reliable request-level accounting.

### Request metadata

Track:

- Request ID.
- Provider.
- Account identifier.
- Model.
- Task type.
- Start time.
- End time.
- Latency.
- Input tokens.
- Output tokens.
- Total tokens.
- HTTP status.
- Success/failure.
- Retry count.
- Fallback count.
- Error category.

### Cost tracking

Track when pricing is available:

- Provider.
- Model.
- Input tokens.
- Output tokens.
- Estimated cost.
- Currency.
- Pricing version/source metadata.

Do not permanently classify a model as free without current provider evidence.

### Exit criteria

Usage can be queried without exposing credentials or sensitive prompt/response content.

---

# Phase 10 — Health Monitoring

**Status:** Planned

### Goals

Maintain reliable provider/account health state.

### Health states

- Healthy.
- Degraded.
- Rate limited.
- Authentication failure.
- Temporarily unavailable.
- Disabled.

### Tasks

- Track successful requests.
- Track failures.
- Track consecutive failures.
- Add cooldowns.
- Add health checks.
- Recover accounts automatically after successful checks/requests.
- Avoid repeatedly probing known-bad providers.
- Add provider health metrics.

### Exit criteria

The router automatically avoids unhealthy capacity and can restore recovered capacity.

---

# Phase 11 — Observability

**Status:** Planned

### Metrics

- Requests/provider.
- Requests/account.
- Requests/model.
- Success rate.
- Failure rate.
- Average latency.
- P95 latency.
- Token usage.
- Retry rate.
- Fallback rate.
- Rate-limit events.
- Provider availability.
- Estimated cost.

### Tasks

- Add structured logging.
- Add metrics abstraction.
- Add tracing hooks.
- Add OpenTelemetry integration.
- Add Prometheus-compatible metrics endpoint if deployed as a service.
- Correlate logs using request IDs.
- Ensure credentials and sensitive content never enter telemetry.

### Exit criteria

A failed request can be traced from gateway request through provider/account/model selection without exposing secrets.

---

# Phase 12 — Security Hardening

**Status:** Planned

### Tasks

- Secret redaction middleware.
- Authorization-header protection.
- Secure configuration validation.
- Credential rotation support.
- Credential-provider abstraction.
- Audit logging without secrets.
- Prompt/response retention controls.
- Input-size limits.
- Output-size limits where appropriate.
- SSRF protection for provider configuration if custom endpoints are ever supported.
- Dependency vulnerability scanning.
- Static analysis.
- Security-focused tests.

### Exit criteria

Security review confirms that credentials, sensitive request data and provider internals are not unintentionally exposed.

---

# Phase 13 — Comprehensive Testing

**Status:** Planned

### Test layers

#### Unit tests

- Account selection.
- Provider selection.
- Capability filtering.
- Priority routing.
- Round robin.
- LRU.
- Utilization routing.
- Cost routing.
- Retry logic.
- Backoff.
- Fallback.
- Health transitions.
- Cooldowns.
- Usage accounting.
- Cost accounting.
- Error normalization.

#### Adapter tests

Use mocked HTTP/provider responses only.

Test:

- Successful completion.
- Streaming.
- Authentication error.
- Rate limit.
- Timeout.
- 4xx.
- 5xx.
- Invalid response.
- Usage extraction.
- Rate-limit header extraction.
- Capability reporting.

#### Integration tests

- Multiple providers.
- Multiple accounts.
- Fallback chains.
- Concurrent requests.
- Recovery after failure.
- Configuration validation.

#### Security tests

- Secret leakage.
- Log redaction.
- Error-message redaction.
- Credential isolation.
- Sensitive telemetry protection.

### Exit criteria

All tests run without real provider API calls in CI unless an explicitly separate integration environment is introduced.

---

# Phase 14 — Developer API & SDK

**Status:** Planned

### Goals

Make the gateway easy to consume from applications.

### Tasks

- Stable public API.
- `generate()` API.
- `stream()` API.
- Model discovery API.
- Health API.
- Usage API.
- Typed errors.
- Typed configuration.
- Provider-neutral options.
- Examples.
- Migration documentation.

### Example

```ts
const result = await gateway.generate('coding', prompt, {
  capabilities: ['chat', 'structured_output']
});
```

Application code must not need provider-specific branches.

---

# Phase 15 — Service/API Layer

**Status:** Optional / Later

### Goals

Expose the gateway as a standalone internal service when multiple applications need to share it.

---

# Phase 16 — Redis & Production Scaling

**Status:** Optional / Later

### Goals

Support multiple gateway instances safely.

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
Phase 5  Routing engine
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
