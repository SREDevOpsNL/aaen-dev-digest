# specs/ — cross-package

Forward-looking specs for work that spans more than one package. One file per
feature: `NN-feature-name.md`. Work that lives inside a single package goes in
that package's `specs/` instead —
[client](../client/specs/README.md) ·
[server](../server/specs/README.md) ·
[reviewer-core](../reviewer-core/specs/README.md) ·
[e2e](../e2e/specs/README.md).

A spec describes **what to build and why it is done** — not how the code works
today (that is [`../docs/`](../docs/README.md)) and not what we already rejected
(that is [`../LEARNINGS.md`](../LEARNINGS.md)).

Typical cross-package work: repository registration across UI, API, job queue and
indexer; review dispatch and its SSE completion path; finding disposition versus
GitHub publication; offline degradation when GitHub or the LLM is unreachable;
authentication, if it is introduced; the Export-to-CI workflow.

Suggested shape:

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped
**Packages touched:** server, client

## Problem
## Scope — in / out
## Contract changes        <!-- @devdigest/shared, server side first, always -->
## Acceptance criteria     <!-- how we know it is done -->
## Open questions
```

Once shipped, either delete the spec or set `Status: shipped` and move any
durable explanation into [`../docs/`](../docs/README.md). **Stale specs are worse
than missing ones** — an agent reads them as current intent.

A richer template and a formal status vocabulary can come later, when the first
real spec shows what is actually missing from this one.

## Index

- [`01-skills-for-review-agents.md`](01-skills-for-review-agents.md) - **implemented; Docker verification pending**: reusable text-only skills, agent attachment, prompt wiring, and the updated Skills editor design.
- [`02-conventions-extractor.md`](02-conventions-extractor.md) - **in progress; runtime verification pending**: bounded repository sampling, grounded convention candidates, human triage, and conversion of accepted rules into a Skill draft.
