# Multi-Provider LLM Gateway

Production-oriented, provider-agnostic cloud LLM gateway designed for applications that need multiple providers and multiple legitimate API accounts without local GPU requirements.

## Initial providers

- Google Gemini
- Groq
- OpenRouter
- Cloudflare Workers AI

## Architecture

`Application → LLM Gateway → Provider Adapter → Model`

The application uses a provider-neutral API such as `generate(task, prompt, options)` and does not contain provider-specific branching.

## Design principles

- Multiple providers and multiple legitimate accounts per provider.
- Capability-aware model and provider routing.
- Configurable priority, round-robin, utilization-aware and latency-aware selection.
- Safe retries, cooldowns and provider fallback.
- No quota or rate-limit circumvention.
- Credential references rather than raw API keys in application logs or telemetry.
- Normalized errors, usage tracking, health state and observability.
- Provider adapters isolated from the core gateway.
- New providers added through adapters without changing application business logic.

## Implementation

The repository starts with a TypeScript package layout that can be embedded into a Node.js application or exposed later as a standalone service.

See `docs/architecture.md` for the detailed design and `src/` for the core implementation.
