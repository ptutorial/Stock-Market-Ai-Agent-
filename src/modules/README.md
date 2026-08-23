# Modular architecture

The `src/modules` directory is the public architectural boundary for the application. New features should be added to the appropriate module instead of creating another top-level `src/*.ts` file.

```text
modules/
├── agents/            # Agent registry, runtime and specialist execution
├── config/            # Environment/configuration validation
├── infrastructure/    # Redis and external infrastructure adapters
├── http/              # HTTP server, API and SDK boundary
├── llm/               # Gateway, routing, limits, retries and LLM providers
├── market/             # Market data, snapshots and data-source routing
├── recommendation/    # Recommendation orchestration, scoring and schemas
├── shared/             # Domain types, common errors and cross-cutting types
└── tools/              # Tool registry and stock-market tools
```

## Dependency direction

```text
interfaces/http
      |
      v
application/recommendation / agents
      |
      +----> tools
      |
      +----> market
      |
      +----> llm
      |
      v
infrastructure

shared is dependency-light and must not depend on application or infrastructure modules.
```

## Rules for new code

1. Keep business logic inside its feature module.
2. Keep provider-specific implementations inside infrastructure/provider boundaries.
3. Do not place database or Redis access inside agents or recommendation logic.
4. Agents call tools; tools call application/domain services; infrastructure adapters perform I/O.
5. Avoid importing implementation files across unrelated modules when a module boundary exists.
6. Add a new tool under `modules/tools` rather than expanding a monolithic stock-tools file.
7. Add a new LLM provider under the LLM provider boundary and keep account routing provider-neutral.
8. Preserve the root entrypoint as the package compatibility surface.

## Migration note

The current top-level files are retained as compatibility implementations while the modular boundaries are introduced. They should be migrated feature-by-feature into these directories rather than moved in one large breaking change. The package entrypoint now exports through the modular boundaries.
