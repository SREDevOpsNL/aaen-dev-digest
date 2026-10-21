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

- **2026-10-20** — PR-list cost now sums each successful run **once**, even
  when several review rows link to it. No current code path creates such rows,
  so this is a defensive fix. See the matching
  [LEARNINGS entry](LEARNINGS.md#codebase-patterns--tool--library-notes).
  Evidence: server/src/modules/pulls/routes.ts:176.

## What Doesn't Work

- **2026-10-20** — HW2 experiment 17 could never have run, and three PRs of
  experiment tooling did not show it. The experiment executor refuses any
  reviewer with repo intel on. The seeded Test Quality Reviewer sets no
  `repoIntel`, so it got the schema default `true`.
  - Only experiment 18 (the API Contract Reviewer, seeded single-pass without
    repo intel) had a happy-path test.
  - The refusal test used the Test Quality Reviewer as its *negative* example,
    so a gap read as passing coverage.
  - The free preview and the Gate 4 `manifest` would have refused it too.

  It was found in a read-only Gate 3 review, before any paid request. Fixture
  mode now seeds that reviewer with the experiment shape. When one guard covers
  several actors, give each of them a positive test, and make a refusal test
  build an explicitly invalid input rather than reuse a real one. Evidence:
  `server/src/db/schema/agents.ts:31` (`repoIntel` default),
  `server/src/modules/reviews/experiment-run.ts` (`prepareExperimentSlot`),
  `server/src/db/seed.ts` (`EXPERIMENT_REVIEWER_SHAPE`),
  `server/test/experiments.it.test.ts`.

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

- **2026-10-21** — Is "a review batch never injects intent derived from an
  outdated linked issue" a flaky test or a real race? In 1 of 3 full DB-backed
  runs on the PR #28 merge of `main` `58dabc5`, the batch's trace held the
  superseded **v1** analysis (`source: 'derived'`, `status: 'used'`,
  `claimed_purpose: 'from issue v1'`) instead of `superseded`. The file passed
  5 of 5 times on its own, and the failing run had all 16 DB files in
  parallel. The branch changes no intent code. If the run order can really let
  a superseded derivation through, a review could use intent from an outdated
  issue, so investigate before treating it as test-only. The other bad run
  failed with `Failed to connect to Reaper`, because the previous run's
  testcontainers Ryuk container was still exiting. Waiting for it to exit
  fixed that. Evidence: `server/test/intent.it.test.ts:490`.
