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

- **2026-10-20** — PR-list cost now sums each successful run **once**, even
  when several review rows link to it. No current code path creates such rows,
  so this is a defensive fix. See the matching
  [LEARNINGS entry](LEARNINGS.md#codebase-patterns--tool--library-notes).
  Evidence: server/src/modules/pulls/routes.ts:176.

## What Doesn't Work

- **2026-10-24** — A prompt-content assertion can pass through an unrelated
  prompt section. Porting L02 without L03 broke the seed test asserting that a
  fixture PR is "reviewed from the stored patch": on `main` it had passed only
  because the L03 intent block cited the file, while the mock git diff was used.
  Assert on text only the intended source contains and on the absence of the
  decoy. Details: the 2026-10-24 entry in `LEARNINGS.md`. Evidence:
  `server/test/seed.it.test.ts` (fixture review case).

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
