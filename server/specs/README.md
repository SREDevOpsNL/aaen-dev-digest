# server/specs

Intent for API work that is not built yet. One file per feature:
`NN-feature-name.md`.

If the feature also changes a shared contract or needs UI, the spec belongs in the
root [`../../specs/`](../../specs/README.md) instead, so both sides stay in one
document. Contract changes land in `src/vendor/shared/` **first**, then in
consumers.

What does **not** belong here: how an endpoint works today (that is
[`../docs/`](../docs/README.md)) and approaches already rejected (that is
[`../LEARNINGS.md`](../LEARNINGS.md)).

Suggested shape:

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped

## Problem
## Module              <!-- src/modules/<name>, registered in src/modules/index.ts -->
## Endpoints           <!-- method, path, Zod schemas -->
## Data                <!-- tables touched, migration needed? -->
## Failure behaviour   <!-- what happens when GitHub / the LLM is unreachable -->
## Acceptance criteria <!-- incl. which suite proves it: unit or *.it.test.ts -->
```

Once shipped, delete the spec or set `Status: shipped` and move any durable
explanation into [`../docs/`](../docs/README.md). **Stale specs are worse than
missing ones** — an agent reads them as current intent.

## Index

No server specs yet.
