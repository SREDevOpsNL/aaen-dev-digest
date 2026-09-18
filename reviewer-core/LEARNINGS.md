# Learnings — reviewer-core

Review-engine guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Genuinely cross-package findings belong in
[`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

- **2026-09-17** — A map-reduce run records one `PromptAssembly` — the whole-diff
  assembly — not the exact prompt of each per-file call. The trace is therefore
  representative, not a replayable log: do not debug a per-file prompt by reading
  the stored assembly. Evidence:
  `reviewer-core/src/review/run.ts:104-105` (`ReviewOutcome.assembly`),
  `reviewer-core/src/review/run.ts:142` (`reviewPullRequest`)

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
