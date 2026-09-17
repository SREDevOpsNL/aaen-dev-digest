# Insights — client

UI decisions and dead ends. Read before restructuring pages, state, or the data
layer.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.tsx:42`
```

Roughly 5 entries per section. Promote stable entries into
[`docs/`](docs/README.md) and delete them here. Cross-package findings go in
[`../INSIGHTS.md`](../INSIGHTS.md) instead.

---

## Decisions

## What Works

## What Doesn't Work

- **2026-09-17** — The Settings field `polling_interval_min` does not control the
  PR-list refetch. It exists in the platform contract and the seed, but the hook
  hard-codes a 60-second interval, so changing the setting appears to do nothing.
  Wire the setting through before treating it as functional.
  `src/lib/hooks/core.ts:109`, `src/vendor/shared/contracts/platform.ts:88`,
  `server/src/db/seed.ts:61`

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Open Questions
