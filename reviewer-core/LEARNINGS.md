# Learnings — reviewer-core

Review-engine guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Genuinely cross-package findings belong in
[`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-22** — Do not judge a prompt revision by fewer findings, lower cost,
  or citation grounding alone. On the same PR, General Reviewer version 2 cut
  findings from 8 to 4 and output tokens from 2,064 to 1,264, but lost three
  valid issues and introduced a false “missing await” finding. It cost 37.6%
  less but took 188.8 seconds instead of 67.5 seconds—about 2.8 times slower.
  Returning a promise from an `async` function already adopts its result and
  rejection.
  Evaluate prompt changes against an expected-finding matrix that separately
  scores false positives, false negatives, severity, duplication, latency,
  tokens, and cost, preferably over repeated runs. Evidence: DevDigest runs
  `fe0e6160-830a-4196-9f8c-0af6fcabbc49` (prompt v1) and
  `0be27a60-2c8a-41a3-9f78-d75b8c76e3e1` (prompt v2) on PR #3.

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
