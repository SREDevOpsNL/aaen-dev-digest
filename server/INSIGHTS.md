# Engineering Insights

## What Works

- **2026-09-28** — PR-list cost is aggregated from persisted review runs rather than calculated by an LLM. Evidence: `server/src/modules/pulls/routes.ts:114`.

- **2026-09-28** — PR-list cost and popup findings deliberately have different scopes: cost sums all successful review runs, while severity counts and previews come from the newest completed review. Evidence: server/src/modules/pulls/routes.ts:114 (PR-list summaries).

- **2026-09-30** — PR-list finding previews are a transport projection, not
the stored finding. Normalize and bound preview rationale to 180 characters in
the pull-list route, while retaining the complete rationale in findings.
Evidence: server/src/modules/pulls/routes.ts:13,
server/src/vendor/shared/contracts/platform.ts:178.

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
