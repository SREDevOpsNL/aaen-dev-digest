# server/docs

How the API works today. Deep dives that are too long for
[`../README.md`](../README.md) and too stable for
[`../LEARNINGS.md`](../LEARNINGS.md).

Good candidates: the run lifecycle and orphan reaping, the DI container and how to
add an adapter, the secrets read path, the migration and seed workflow, SSE run
traces, rate-limit tiers, the job queue's actual durability guarantees.

Not here: the API route map (that is [`../README.md`](../README.md)), intent for
unbuilt work ([`../specs/`](../specs/README.md)), rejected approaches
([`../LEARNINGS.md`](../LEARNINGS.md)).

`src/modules/repo-intel/` keeps its own README next to the code — link to
[it](../src/modules/repo-intel/README.md) rather than copying it.

## Cross-package context

- [Product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md)
- [Architecture overview](../../docs/architecture/00_ARCHITECTURE_OVERVIEW.md)
- [Testing strategy](../../TESTING.md)

## Documents

None yet. Add one when a topic outgrows the module README.
