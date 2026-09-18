# reviewer-core/docs

How the engine works today. Deep dives too long for
[`../README.md`](../README.md).

Good candidates: the grounding heuristics and exactly which findings get dropped,
deterministic score recomputation, prompt slot ordering and token budget,
`parseWithRepair` failure modes (`src/llm/structured.ts`), the injection-fencing
rules, the map-reduce path and its reduce step.

Not here: the pipeline diagram and public API (that is
[`../README.md`](../README.md)), intent for unbuilt slots
([`../specs/`](../specs/README.md)), rejected approaches
([`../LEARNINGS.md`](../LEARNINGS.md)).

Built-in agent system prompts live in
[`docs/agent-prompts/`](../../docs/agent-prompts/README.md) at repo root —
link, do not copy.

## Cross-package context

- [Product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md)
- [Architecture overview](../../docs/architecture/00_ARCHITECTURE_OVERVIEW.md)

## Documents

None yet. Add one when a topic outgrows the module README.
