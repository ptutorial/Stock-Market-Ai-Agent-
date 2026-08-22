# Architecture

## Core flow

```text
Application
    |
    v
LLM Gateway
    |
    +--> Capability Resolver
    +--> Model Router
    +--> Account Selector
    +--> Retry / Fallback Policy
    +--> Usage & Health Tracking
    |
    +--> Gemini Adapter ------> Gemini API
    +--> Groq Adapter --------> Groq API
    +--> OpenRouter Adapter --> OpenRouter API
    +--> Cloudflare Adapter -> Workers AI API
```

## Provider-neutral contract

The application should depend on a single gateway contract. Provider-specific SDKs, authentication, error parsing, rate-limit interpretation and model metadata remain inside adapters.

The gateway resolves a request in this order:

1. Requested capability/task.
2. Compatible providers.
3. Compatible models.
4. Healthy and enabled accounts.
5. Configured limits and cooldowns.
6. Routing strategy.
7. Request execution.
8. Usage and response metadata recording.
9. Health and rate-limit state update.

## Account model

Each configured account has an opaque identifier, provider, credential reference, model capabilities, priority, limits, health state, cooldown state and usage metadata. Raw credentials are never part of logs, API responses or usage records.

Multiple accounts are supported for legitimate separation such as projects, organizations, development/production, billing ownership and provider-approved quota allocation. The gateway must not rotate accounts to evade provider limits or abuse controls.

## Routing

Routing policies are configurable. Supported policy concepts include priority, round robin, least recently used, lowest utilization, latency, cost, best model, capability matching and fallback chains.

Fallback is restricted to failures where another provider/model is a valid substitute. Invalid requests, authentication failures and unsupported capabilities must not blindly trigger fallback.

## Capability discovery

Providers expose different feature sets. Adapters report capabilities such as streaming, structured output, tool calling and vision. The router uses those capabilities rather than assuming feature parity.

## Error normalization

Provider errors are mapped to common categories:

- AuthenticationError
- RateLimitError
- TimeoutError
- ProviderUnavailableError
- ModelUnavailableError
- InvalidRequestError
- UnsupportedCapabilityError
- ServerError
- UnknownProviderError

## Reliability

Rate-limit responses and `Retry-After` information are honored where available. Retries use bounded exponential backoff and cooldowns. Concurrent selection and state updates require atomic/locked operations so workers do not overcommit an account's known capacity.

## Observability

Request telemetry records request ID, provider, opaque account ID, model, task, timestamps, latency, token counts when available, status, retries, fallback count and normalized error category. Prompt/response content is not persisted unless explicitly configured.

Metrics include provider/account/model request counts, success and failure rates, average/P95 latency, token usage, fallback/retry rates, rate-limit events, availability and estimated cost.
