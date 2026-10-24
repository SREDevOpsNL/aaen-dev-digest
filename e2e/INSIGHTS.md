# Engineering Insights

## What Works

- **2026-09-28** — The seeded findings flow verifies severity filtering without a live model. Evidence: `e2e/specs/04-pr-findings.flow.json:14`.

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

- **2026-10-24** — `wait --url /pulls` does not mean the PR list has
  rendered: a `find text "<PR title>" click` right after it races
  `GET /repos/:id/pulls` and fails intermittently. On the L01 baseline the
  hermetic suite went 7/8 on flow 05, and once 05 was guarded the next run
  failed 07a the same way, so fixing the one failing flow was not enough.
  Precede every text click with `wait --text` for the same text (flow 02 already
  did), and audit all flows for the pattern rather than the one that failed.
  Evidence: `e2e/specs/02-repo-pulls-detail.flow.json:7` (the guard),
  `e2e/specs/04-pr-findings.flow.json:7`, `e2e/specs/05-pr-diff.flow.json:7`,
  `e2e/specs/07a-findings-preview-scroll.flow.json:13`; two consecutive 8/8
  runs after the guard.

## Session Notes

## Open Questions
