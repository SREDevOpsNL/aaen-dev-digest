# e2e/docs

How the suite works today. Deep dives too long for
[`../README.md`](../README.md) and too stable for
[`../LEARNINGS.md`](../LEARNINGS.md).

Good candidates: the hermetic runner's port map and teardown, the agent-browser
command vocabulary we actually use, debugging a flow from raw stderr, what the seed
guarantees and which flows depend on it.

Not here: the flow-format walkthrough (that is [`../README.md`](../README.md)),
intent for journeys not yet covered ([`../specs/`](../specs/README.md) — prose
specs live there alongside the flow files), rejected approaches
([`../LEARNINGS.md`](../LEARNINGS.md)).

## Cross-package context

- [Testing strategy](../../TESTING.md)
- [Architecture overview](../../docs/architecture/00_ARCHITECTURE_OVERVIEW.md)

## Documents

- [`runner-architecture.md`](runner-architecture.md) — how `run.ts` turns a
  flow into pass/fail, the shared session, the hermetic stack's lifecycle and
  teardown, and how CI differs.
- [`seed-and-flows.md`](seed-and-flows.md) — what the seed guarantees (and
  does not), which flow depends on which seeded data, and the stubbed run in
  `07a`.
- [`agent-browser-usage.md`](agent-browser-usage.md) — the commands the
  flows use as assertions, coordinate-safe pointer steps, and debugging a
  failing flow.
