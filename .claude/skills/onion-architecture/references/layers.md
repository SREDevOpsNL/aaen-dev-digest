# DevDigest backend layer map

Use this map to decide where code belongs. It describes intended dependency direction; it does not claim every existing file is already compliant.

## Center: reviewer core

`reviewer-core/src/**` owns deterministic review policy: prompt assembly, structured output, reduction, grounding, scoring, and review formatting. Inputs such as skills, memory, repository context, and diffs arrive already resolved. Tests inject a fake `LLMProvider`.

Allowed dependencies: its own pure modules and shared types/contracts. Forbidden dependencies: Fastify, Drizzle/Postgres, HTTP clients, Git/GitHub, filesystem, and server adapters.

## Ports and contracts

`server/src/vendor/shared/**` contains shared DTOs, Zod contracts, and adapter interfaces. Ports describe capabilities the application needs, such as `GitHubClient`, not the vendor that happens to implement them. The client mirror is hand-maintained; deliberate contract changes update the canonical server copy first and then its client consumer.

## Application services

`server/src/modules/<feature>/service.ts` and review orchestration coordinate use cases. They call repositories and ports, apply workspace scope, and decide transaction boundaries. Services should not depend on Fastify request/reply objects or concrete SDK adapters.

## Infrastructure

- `server/src/modules/<feature>/repository*.ts`: Drizzle persistence for the feature.
- `server/src/db/**`: connection, schema, generated migrations, and persistence rows.
- `server/src/adapters/**`: GitHub, git, LLM, indexing, secrets, tokenizer, and other technology implementations.

Repositories return application-shaped data rather than query builders. Database constraints remain authoritative even when an application relation exists.

## Transport

`server/src/modules/<feature>/routes.ts` is a Fastify plugin. It owns request/response schemas, status codes, authentication/context extraction, and mapping application errors to transport behavior. Fastify encapsulation scopes decorators and hooks to descendants, so registration order and plugin ownership matter.

## Composition

`server/src/platform/container.ts` binds ports to adapters and permits test overrides. `server/src/app.ts` installs cross-cutting plugins and active feature modules; `server/src/modules/index.ts` statically registers modules. A directory that is not registered is not operational.

## Dependency direction

```text
transport -----> application -----> core policy
     |                 |                 ^
     v                 v                 |
composition ------> ports <------ infrastructure adapters
                                  persistence repositories
```

Outer code may depend inward. Inner code never imports an outer implementation.
