# Insights — server

API, persistence, and adapter dead ends. Read before changing the run lifecycle,
the container, or anything that touches Postgres.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into
[`docs/`](docs/README.md) and delete them here. A finding about
`src/vendor/shared/` is a **contract** change and belongs in
[`../INSIGHTS.md`](../INSIGHTS.md), because it reaches every package.

---

## Decisions

## What Works

## What Doesn't Work

- **2026-09-17** — Persisted `jobs` rows do not make the queue recoverable. The
  table exists and rows are written, but execution is an in-process `p-queue`: a
  restart loses every queued job and leaves its row behind. Do not design on the
  assumption that a job survives a crash. `src/db/schema/ops.ts:6`,
  `src/platform/jobs.ts`

## Codebase Patterns

- **2026-09-17** — `run-executor` fills only three of `assemblePrompt`'s optional
  slots — `callers`, `repoMap` and `prDescription`. `skills`, `memory` and `specs`
  are always null and the corresponding prompt sections are never emitted, so the
  trace showing them empty is correct, not a rendering bug.
  `src/modules/reviews/run-executor.ts:198-205,425`

## Tool & Library Notes

## Recurring Errors & Fixes

## Open Questions
