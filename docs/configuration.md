# Gateway Configuration

Phase 2 introduces externalized gateway configuration and credential references. Phase 3 provider adapters consume the same provider-neutral configuration.

## Credentials

The configuration stores a `credentialRef`, not an API key:

```json
{
  "id": "gemini-primary",
  "provider": "gemini",
  "credentialRef": "GEMINI_API_KEY"
}
```

At runtime, `EnvironmentCredentialStore` resolves that reference from the process environment. Secrets must never be placed in `gateway.example.json`, source code, logs, telemetry, or committed configuration.

## Account configuration

Each account defines:

- Unique account ID.
- Provider.
- Credential reference.
- Allowed models.
- Supported capabilities.
- Priority.
- Enabled/disabled state.
- Optional RPM/RPD/TPM/TPD limits.
- Optional cost metadata.
- Optional provider metadata.

Cloudflare Workers AI requires the Cloudflare account ID separately from the API token. Configure it as `metadata.accountId`; keep the API token in `credentialRef`.

## Provider adapter behavior

The adapters use a shared HTTP transport with bounded request timeouts and normalized provider errors. OpenAI-compatible providers use the common SSE parser for streaming. Provider-specific model capability refinement is handled by Phase 4.

## Validation

`validateConfig()` fails fast for invalid configuration, including duplicate account IDs, unknown providers/capabilities, missing credentials, missing models, invalid limits and provider/account mismatches.

## Environment loading

`loadConfigFromEnvironment()` reads `LLM_GATEWAY_CONFIG` as JSON and validates it. The JSON should contain references to environment variables rather than secret values.

## Multiple accounts

Multiple accounts are supported for legitimate project, organization, environment or billing separation. Account rotation must never be used to circumvent provider rate limits, quotas, or abuse controls.

## Example

See `config/gateway.example.json` for a complete non-secret configuration example and `.env.example` for credential variable names.
