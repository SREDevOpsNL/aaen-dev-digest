# Engineering Insights

## What Works

- **2026-09-28** — PR-list cost is aggregated from persisted review runs rather than calculated by an LLM. Evidence: `server/src/modules/pulls/routes.ts:114`.

- **2026-09-28** — PR-list cost and popup findings deliberately have different scopes: cost sums all successful review runs, while severity counts and previews come from the newest completed review. Evidence: server/src/modules/pulls/routes.ts:114 (PR-list summaries).

- **2026-09-30** — PR-list finding previews are a transport projection, not
the stored finding. Normalize and bound preview rationale to 180 characters in
the pull-list route, while retaining the complete rationale in findings.
Evidence: server/src/modules/pulls/routes.ts:13,
server/src/vendor/shared/contracts/platform.ts:178.

- **2026-10-10** — Correction to the two 2026-09-28 PR-list entries above: their
  `server/src/modules/pulls/routes.ts:114` citations are stale, and the
  recorded behavior is unchanged. Successful-run cost is loaded and summed at
  the first two references below; the newest completed review is selected and
  only its findings are queried at the last two. Evidence:
  `server/src/modules/pulls/routes.ts:142` (`reviewRows`),
  `server/src/modules/pulls/routes.ts:167` (`summary.cost`),
  `server/src/modules/pulls/routes.ts:172` (`latestReviewIds`),
  `server/src/modules/pulls/routes.ts:178` (`findingRows`).

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions

- **2026-10-14** — Is the Intent Layer's classifier budget (30 s per request,
  35 s per derivation) enough for large PRs? It has only applied since the L03
  fix that aborts timed-out requests; before, OpenRouter ignored it. In a
  post-migration smoke test on the dev database with
  `deepseek/deepseek-v4-flash` via OpenRouter, Recompute on PR #2 (66 files,
  2,507 changed lines) failed with `Operation timed out after 35000ms` after
  35.1 s; no analysis was stored and the cost was marked incomplete. A first
  open on the seeded PR #482 (4 files, no patches, so no excerpts) succeeded in
  11.3 s (1,617 / 1,045 tokens, $0.00014). One attempt each, with different
  inputs, so this does not show that PR size caused the timeout. Measure
  classifier latency against PR size before changing the budget. Evidence:
  `server/src/modules/intent/constants.ts` (`INTENT_TIMEOUT_MS`,
  `INTENT_TIMEOUT_MARGIN_MS`); the general cancellation pitfall is in the root
  `LEARNINGS.md` (2026-10-14, `withTimeout`).
