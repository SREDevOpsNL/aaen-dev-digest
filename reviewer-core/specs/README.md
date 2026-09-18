# reviewer-core/specs

Intent for engine work that is not built yet. One file per capability:
`NN-feature-name.md`.

Because the engine is pure and consumed as source by `server/`, most engine specs
are really cross-package: if the change adds an input the caller must resolve, or
alters a shared contract or a public export, the spec belongs in the root
[`../../specs/`](../../specs/README.md) instead.

What does **not** belong here: how the pipeline works today (that is
[`../docs/`](../docs/README.md)) and approaches already rejected (that is
[`../LEARNINGS.md`](../LEARNINGS.md)).

Suggested shape:

```markdown
# <Capability>

**Status:** draft | agreed | in progress | shipped

## Problem
## Public surface       <!-- what src/index.ts gains or changes -->
## Inputs              <!-- what the caller must resolve and pass in -->
## Purity impact       <!-- must stay: no DB / HTTP / FS, injected LLMProvider only -->
## Grounding & scoring <!-- effect on the gate and the deterministic score -->
## Acceptance criteria <!-- incl. the hermetic test that proves it -->
```

Once shipped, delete the spec or set `Status: shipped` and move any durable
explanation into [`../docs/`](../docs/README.md). **Stale specs are worse than
missing ones** — an agent reads them as current intent.

## Index

No reviewer-core specs yet.
