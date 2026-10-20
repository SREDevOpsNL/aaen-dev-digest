# Engineering Insights

## What Works

- **2026-09-28** — PR-list cost is aggregated from persisted review runs rather than calculated by an LLM. Evidence: `server/src/modules/pulls/routes.ts:114`.

- **2026-09-28** — PR-list cost and popup findings deliberately have different scopes: cost sums all successful review runs, while severity counts and previews come from the newest completed review. Evidence: server/src/modules/pulls/routes.ts:114 (PR-list summaries).

- **2026-09-30** — PR-list finding previews are a transport projection, not
the stored finding. Normalize and bound preview rationale to 180 characters in
the pull-list route, while retaining the complete rationale in findings.
Evidence: server/src/modules/pulls/routes.ts:13,
server/src/vendor/shared/contracts/platform.ts:178.

- **2026-10-20** — Correction to the 2026-09-28 "different scopes" entry above:
  severity counts and previews no longer come from the newest completed review.
  They are the union of **each agent's latest successful review run**. With
  several agents on one PR, the old rule silently dropped every agent but the
  last to finish (L01 mentor review).
  - **Identity:** `coalesce(reviews.agent_id, agent_runs.agent_id)`, with the
    agent name joined on that same expression, so grouping and the label cannot
    disagree.
  - **Decision on "latest":** order by `agent_runs.ran_at`, then
    `reviews.created_at`, then the review id. Ordering by `created_at` alone was
    rejected: two overlapping runs of one agent would let the run that
    *started* first win, because it *finished* last.
  - **Unchanged:** score still uses the newest review by `created_at`, and cost
    still sums every successful run.

  Evidence: server/src/modules/pulls/status.ts:81 (`compareReviewRuns`),
  server/src/modules/pulls/routes.ts:137 (agent identity), and
  server/test/reviews.it.test.ts ("takes the run that started last when two
  runs of an agent overlap").

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
