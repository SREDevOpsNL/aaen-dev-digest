# Sources

Sources used to build version 1.0.0:

## Architecture

- [Jeffrey Palermo: The Onion Architecture, Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) and [parts 2-4](https://jeffreypalermo.com/tag/onion-architecture/) — original dependency-direction model.
- [Robert C. Martin: The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — policy/mechanism boundaries and inward dependencies.
- [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — ports, adapters, and application isolation.
- [Microsoft .NET Architecture: persistence infrastructure](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design) — repository and infrastructure boundary rationale, used conceptually rather than as .NET-specific implementation guidance.

## Project technologies

- [Fastify: Plugins](https://fastify.dev/docs/latest/Reference/Plugins/) — registration creates encapsulated scopes and ordered dependency visibility.
- [Fastify: Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) — plugin context and inheritance boundaries.
- [Fastify: TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/) — typed plugin and route patterns.
- [Drizzle ORM: Transactions](https://orm.drizzle.team/docs/transactions) — transaction and savepoint APIs for atomic application operations.
- [Drizzle ORM: Relations](https://orm.drizzle.team/docs/relations) — application relations and their distinction from database foreign keys.
- [dependency-cruiser documentation](https://github.com/sverweij/dependency-cruiser) — optional static enforcement of dependency rules; the skill does not assume a repository gate exists until configuration and scripts are present.

The attached lesson's `onion-architecture` package was used as reference input. Repository-specific facts were checked against the current `AGENTS.md`, package manifests, `server/src`, and `reviewer-core/src`; stale `npm` server commands and fixed violation counts were not carried forward.
