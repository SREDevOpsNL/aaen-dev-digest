---
name: onion-architecture
description: Design and review DevDigest backend modules using Onion Architecture and ports-and-adapters. Use for Fastify modules, services, repositories, Drizzle persistence, external adapters, reviewer-core, dependency direction, and backend refactors. Not for frontend organization.
metadata:
  version: "1.0.0"
---

# Onion Architecture

Enforce one rule: source dependencies point inward toward policy; outer technology details depend on inner contracts, never the reverse.

## Workflow

1. Read the root and package `AGENTS.md`, then inspect the current module and its callers.
2. Classify each responsibility as core policy, port/contract, application orchestration, infrastructure adapter/persistence, transport, or composition.
3. Identify every dependency crossing that boundary. Reverse outward-pointing core dependencies with an interface/port only when a real seam exists.
4. Keep Fastify, Drizzle, SDK, filesystem, GitHub, and model-provider details at the outside.
5. Refactor in small behavior-preserving slices. Existing drift is not permission for new drift, but do not turn a feature change into an unrequested repository-wide rewrite.
6. Test the inner policy without infrastructure, then test the adapter or route at its boundary.

## Non-negotiable boundaries

- `reviewer-core/src/**` stays pure: no database, HTTP, GitHub, git, or filesystem access; the model call is behind an injected `LLMProvider`.
- Fastify route handlers validate and translate transport data, then call application services. They do not own SQL or business workflows.
- Drizzle queries stay in repositories or dedicated persistence adapters. Multi-write business operations that must succeed together use a transaction.
- External tools and SDKs are adapters behind ports resolved by `server/src/platform/container.ts`.
- Feature modules do not import sibling-module internals. Move genuinely shared policy to a stable shared owner or expose it through a port/facade.
- The composition root may know both ports and concrete adapters; ordinary services may not.

## Project routing

- Read [references/layers.md](references/layers.md) to place code in this repository.
- Read [references/change-checklist.md](references/change-checklist.md) when adding or reviewing a module, dependency, route, or persistence operation.
- Compose with `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, and `security` when their implementation details apply.

The source list and scope are in [SOURCES.md](SOURCES.md).
