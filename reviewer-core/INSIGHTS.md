# Engineering Insights

## What Works

- **2026-09-28** — Provider-reported cost and estimated cost remain distinct fields through map-reduce aggregation. Evidence: `reviewer-core/src/review/run.ts:188`.

## What Doesn't Work

- **2026-10-21** — HW2 Gate 3 slot `x-18-without-1` failed with HTTP 429,
  and the cause could not be determined: the engine had kept only the status
  and the message, so OpenRouter-level and DeepInfra-level limiting were
  indistinguishable. Failed experiment attempts now carry a sanitized
  `errorDetail`. Details:
  [`LEARNINGS.md`](LEARNINGS.md#codebase-patterns--tool--library-notes)
  (2026-10-21, both entries).

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
