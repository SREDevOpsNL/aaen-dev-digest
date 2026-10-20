# PR list summary

`GET /repos/:id/pulls` ([`src/modules/pulls/routes.ts`](../src/modules/pulls/routes.ts))
returns one `PrMeta` per persisted pull request of a repository. Besides the
GitHub fields, each row carries a review status, a score, a cost, and the
FINDINGS counts with their previews. The contract is `PrMeta` in
[`src/vendor/shared/contracts/platform.ts`](../src/vendor/shared/contracts/platform.ts).
The acceptance criteria are in
[`../specs/01-pr-list-review-summary.md`](../specs/01-pr-list-review-summary.md).

## 1. Sync, then read (local-first)

1. **Scope:** the repository is looked up inside the caller's workspace. An
   unknown id is a 404.
2. **Sync:** if a GitHub client can be built (a token is configured), the
   repository's PRs are listed and upserted on `(repo_id, number)`
   (`routes.ts:79`).
   - A missing token or a GitHub failure is only logged. Persisted and seeded
     PRs are still served offline.
3. **Diff-stat backfill:** GitHub's list payload has no diff stats, so freshly
   imported PRs read 0/0/0. Up to 10 of them per request are backfilled from
   the PR detail endpoint (`BACKFILL_LIMIT`, `routes.ts:103`). Later polls
   chip away at the remainder.

## 2. Review status

`deriveReviewStatus` ([`status.ts:41`](../src/modules/pulls/status.ts)):

- **Merged or closed** PRs keep GitHub's state.
- **Open** PRs become one of:
  - `needs_review`: never reviewed, or the head moved since the last review
    (`last_reviewed_sha`, stamped by every successful run).
  - `stale`: the current head was reviewed, but the PR has not been updated for
    more than `STALE_DAYS` (7).
  - `reviewed`: otherwise.

## 3. Score, cost, and FINDINGS

All three read only **successful review runs**: `reviews.kind = 'review'` whose
`agent_runs.status = 'done'`. A review without a run (like the seed's sample
review) or with a failed or cancelled run never contributes. Each field has its
own scope:

| Field | Scope | Rule |
| --- | --- | --- |
| `score` | Newest successful review overall, by `reviews.created_at` | Its 0–100 score. |
| `cost_usd` | **All** successful runs | Sum of provider-reported `agent_runs.cost_usd`, **once per distinct run** (`routes.ts:179`). If any of them has no reported cost, the total is `null` (unknown), never a partial sum. |
| `has_successful_review` | Any successful run | Lets the UI tell "no review" (empty Cost cell) from "unknown cost" (`—`). |
| `findings_by_severity`, `finding_previews` | **Each agent's latest successful run** | The union of those reviews' findings (below). `null` / `[]` when the union is empty. |

Cost is summed per **run**, not per review row. Today every successful run
writes exactly one `kind = 'review'` row (`run-executor.ts`, one
`insertReview` per `runOneAgent`), but `reviews.run_id` has no unique
constraint, so the route deduplicates by run id rather than rely on that.

### Each agent's latest run

The selection rules are pure functions in
[`status.ts`](../src/modules/pulls/status.ts), so they are unit-tested without a
database:

- **Agent identity** is `coalesce(reviews.agent_id, agent_runs.agent_id)`
  (`routes.ts:141`).
  - The agent's name is joined on that **same** expression (`routes.ts:156`),
    so grouping and the shown name never disagree.
  - Rows where both ids are null form one unattributed group.
- **"Latest"** is decided by `compareReviewRuns` (`status.ts:81`):
  1. The run that **started** last (`agent_runs.ran_at`).
  2. Then the review written last (`reviews.created_at`).
  3. Then the higher review id.

  An overlapping run that started later therefore wins even if it finished
  first, and ties resolve the same way every time. `latestReviewPerAgent`
  (`status.ts:95`) keeps one review per `(PR, agent)` (`routes.ts:187`).
- **No fallback:** an agent's latest review replaces its older findings even
  when it found nothing. A newer *failed* run is not eligible, so that agent's
  last successful review stays.
- **Previews:**
  - Each preview names its agent in `agent_name`, which is `null` when the agent
    row no longer exists or for the unattributed group.
  - They are sorted by `sortFindingPreviews` (`status.ts:106`): severity
    (Critical, Warning, Suggestion, then unknown), the newer run, file, and
    line (`routes.ts:237`).
  - The rationale is whitespace-collapsed and cut to 180 characters with `…`
    (`FINDING_PREVIEW_MAX_LENGTH`, `routes.ts:16`). The stored rationale is
    unchanged.

The findings query loads only the winning reviews' findings, so its cost does
not grow with review history, and it is skipped entirely when a PR list has no
successful review.

## Where it shows up

The studio renders these fields in the PR list's Score, Cost, and FINDINGS
columns. The FINDINGS popover reads "N FINDINGS IN LATEST AGENT RUNS" and names
each finding's agent; see
[`../../client/docs/findings-preview.md`](../../client/docs/findings-preview.md).

## Tests

- `test/pulls-status.test.ts` (hermetic): status derivation, the latest-run
  comparator, the per-agent grouping, and the preview order.
- `test/reviews.it.test.ts` (Docker): cost aggregation, a run's cost counted
  once when two reviews share it, unknown cost when that shared run has no
  reported cost, a PR with no successful run, and the
  per-agent matrix. The matrix covers two agents, a re-review, a newer failed
  run, review-only and run-only agent ids, no agent at all,
  identical timestamps, a clean latest review, overlapping runs, and a deleted
  agent.
