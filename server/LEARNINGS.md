# Learnings — server

API and persistence guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Repo-intel remains server-scoped;
`*/src/vendor/shared/**` belongs in [`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-17** — Persisted `jobs` rows do not make the queue recoverable. The
  table exists and rows are written, but execution is an in-process `p-queue`: a
  restart loses every queued job and leaves its row behind. Do not design on the
  assumption that a job survives a crash. Evidence:
  `server/src/db/schema/ops.ts:6` (`jobs`),
  `server/src/platform/jobs.ts:30` (`JobRunner`)

## Codebase Patterns & Tool / Library Notes

- **2026-09-17** — `run-executor` fills only three of `assemblePrompt`'s optional
  slots — `callers`, `repoMap` and `prDescription`. `skills`, `memory` and `specs`
  are always null and the corresponding prompt sections are never emitted, so the
  trace showing them empty is correct, not a rendering bug. Evidence:
  `server/src/modules/reviews/run-executor.ts:198-205`
  (`ReviewRunExecutor.runOneAgent`),
  `server/src/modules/reviews/run-executor.ts:425`
  (`ReviewRunExecutor.traceFromBuffer`)

- **2026-09-18** — Drizzle's migrator (`drizzle-orm` 0.38.4) runs a
  `meta/_journal.json` entry only if its `when` is newer than the latest
  `created_at` in `drizzle.__drizzle_migrations`. It never compares the stored
  `hash`, and never reads a `.sql` the journal does
  not list. So an edit to an applied migration reaches only DBs that have not
  run it yet, and an entry older than a DB's latest (restored or merged from
  another branch) is silently skipped there — apply its DDL by hand. Evidence:
  `server/src/db/migrate.ts:30` (`runMigrations`); `migrate()` in
  `drizzle-orm/pg-core/dialect.js`; commit `2006964`.

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
