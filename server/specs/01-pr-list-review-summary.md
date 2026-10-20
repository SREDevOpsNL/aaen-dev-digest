# PR list review summary

**Status:** shipped. L01 shipped the score, cost, counts, and previews. Per-agent
FINDINGS followed the L01 mentor review, on 2026-10-20.

How it works today is in
[`../docs/pr-list-summary.md`](../docs/pr-list-summary.md). This spec keeps the
acceptance criteria that the tests prove.

## Problem

The PR list must show, for every PR and without a model call:

- how good its latest review was;
- what reviewing it has cost;
- what the reviewers found.

When several agents review the same PR, the findings must not be limited to
whichever agent finished last.

## Module

`src/modules/pulls`: `routes.ts` holds the queries, and `status.ts` the pure
selection and ordering helpers.

## Endpoints

`GET /repos/:id/pulls` returns `PrMeta[]`
(`src/vendor/shared/contracts/platform.ts`). The summary fields are:

- `score`
- `cost_usd`
- `has_successful_review`
- `findings_by_severity` (`{ CRITICAL, WARNING, SUGGESTION }`)
- `finding_previews[]`, each with `severity`, `title`, `category`, `file`,
  `start_line`, `confidence`, `rationale` (≤180 characters), and `agent_name`
  (nullish).

## Data

These existing tables are read only: `reviews`, `agent_runs`, `findings`, and
`agents`. No migration is needed.

## Failure behaviour

- **GitHub:** unavailable or unconfigured, the persisted PRs are served
  unchanged.
- **Cost:** a run without a provider-reported cost makes `cost_usd` null
  (unknown), never zero or a partial sum.

## Acceptance criteria

1. **Successful runs only.** Score, cost, and FINDINGS read only reviews whose
   run is `done`. A PR without one has `has_successful_review: false`, `score`
   and `cost_usd` null, `findings_by_severity` null, and `finding_previews: []`.
   *Proof:* `test/reviews.it.test.ts`, "reports no cost, score, or findings for
   a PR without a successful review run".
2. **Score and cost.** Score is the newest successful review's score, and cost
   sums every successful run.
   *Proof:* "aggregates all successful review-run costs while preserving the
   newest review score".
3. **Agent identity.** The agent of a review is
   `coalesce(reviews.agent_id, agent_runs.agent_id)`, and reviews with neither
   form one group.
   *Proof:* "keeps one unattributed group when neither the review nor its run
   names an agent", "groups a review under its own agent when its run has none,
   and resolves that agent's name", and "uses the run's agent when the review
   has none".
4. **Latest successful run per agent.**
   - FINDINGS is the union of each agent's latest successful review.
     *Proof:* "includes the latest review of every agent, names each agent, and
     orders by severity", and "counts only an agent's newest review when it
     reviewed the PR twice".
   - A newer failed run does not hide the last successful one.
     *Proof:* "keeps an agent's last successful review when its newer run
     failed".
   - A clean latest review drops that agent's older findings.
     *Proof:* "drops an agent's older findings when its latest review found
     nothing".
5. **Latest means latest started.** Order by `agent_runs.ran_at`, then
   `reviews.created_at`, then the higher review id.
   *Proof:* "takes the run that started last when two runs of an agent
   overlap", "picks the higher review id when two runs of an agent share their
   timestamps", and `test/pulls-status.test.ts`, `latestReviewPerAgent`.
6. **Previews.**
   - Each preview carries its agent's name, or null when the agent no longer
     exists. *Proof:* "keeps the group of an agent that no longer exists,
     without a name".
   - Order is by severity, then the newer run, then file and line. *Proof:*
     `test/pulls-status.test.ts`, `sortFindingPreviews`.
   - The rationale is bounded to 180 characters. *Proof:* the
     unattributed-group test.
7. **UI.** The PR-list popover reads "N FINDINGS IN LATEST AGENT RUNS" and
   names each agent, or "Unknown agent".
   *Proof:* `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx`.
