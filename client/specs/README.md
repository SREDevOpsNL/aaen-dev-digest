# client/specs

Intent for UI work that is not built yet. One file per feature:
`NN-feature-name.md`.

If the feature also needs a new endpoint or a contract change, the spec belongs in
the root [`../../specs/`](../../specs/README.md) instead, so both sides stay in
one document.

What does **not** belong here: how a screen works today (that is
[`../docs/`](../docs/README.md)) and approaches already rejected (that is
[`../INSIGHTS.md`](../INSIGHTS.md)).

Suggested shape:

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped

## Problem
## Route(s)          <!-- src/app/**/page.tsx path -->
## Data              <!-- which hook in src/lib/hooks, which endpoint -->
## States            <!-- loading / empty / error / success -->
## Copy              <!-- keys to add under messages/<locale>/ -->
## Acceptance criteria
```

Once shipped, delete the spec or set `Status: shipped` and move any durable
explanation into [`../docs/`](../docs/README.md). **Stale specs are worse than
missing ones** — an agent reads them as current intent.

## Index

No client specs yet.
