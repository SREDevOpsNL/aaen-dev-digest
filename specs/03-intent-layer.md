# PR Intent Layer

**Status:** implemented (provisional, L03)\
**Packages touched:** reviewer-core, server, shared contracts, client, seed, e2e\
**Related:** [Skills for Review Agents](01-skills-for-review-agents.md)

This spec records the behaviour built for L03. It follows the L03 lab
demonstration and the approved design decisions; the official L03 homework
acceptance criteria were not available when it was written, so this is not a
claim that those criteria are met.

## Problem

Reviewers judge every change without knowing why the PR was opened, so they
spend findings on unrelated improvements and cannot tell an undeclared change
from an intended one.

## Behaviour

**Generation and cache**

- Opening a PR with no cached intent generates it once through
  `POST /pulls/:id/intent` (rate-limited, workspace-scoped). `GET
  /pulls/:id/intent` reads the cache and never calls a model.
- The intent is cached in `pr_intent` with the head SHA, a fingerprint of the
  local PR context (title, description, file list, linked-issue number), the
  linked-issue content hash and the prompt version.
- It is **stale** when the head SHA, the context fingerprint or the prompt
  version changes. The UI shows stale intent with its reasons and a manual
  Recompute; it never recomputes on its own.
- `POST /pulls/:id/intent/recompute` always derives. If it fails, the previous
  valid intent stays, with the error shown alongside.
- Concurrent requests share one classifier call only when they are for the same
  PR revision: the same PR, head SHA and context fingerprint. A request after
  the PR changes starts its own derivation instead of joining the older one.
- A result is written only if its derivation started no earlier than the stored
  one, so an older result never overwrites a newer one. A superseded result is
  reported as `superseded`, and its cost is still added to the PR's total. An
  older failure never overwrites the error or attempt time of a newer attempt.
- Single flight and the ordering guard are in-process: they assume one API
  process per database, as the rest of the server does. Running several
  instances against one database would need cross-instance coordination, such
  as a lease, which is not built.

**Classifier input (bounded, untrusted)**

- PR title and description, labelled as author claims.
- A linked issue only when a closing keyword (`fixes`, `closes`, `resolves`, …)
  identifies exactly one issue in the same repository; a bare `#N` never counts.
  Its text is capped and fingerprinted. External URLs and specs are not read.
- Tier 1: every changed file with its +/- counts and hunk headers. Tier 2:
  budgeted excerpts of changed lines, each with its line number. Omitted files
  and hunks are listed, and the file list states it may be incomplete.

**Output and validation**

- `claimed_purpose` (what the author says) is kept separate from
  `supported_points` (what the changes show).
- Every citation must point at lines the classifier was shown. Points without a
  valid citation move to `unverified_statements`; with no supported point the
  confidence is `low`. A valid citation proves presence, not correctness.

**Review integration**

- A review batch reuses fresh intent, refreshes stale intent once, or reviews
  without intent if that fails. It never uses stale intent, and it uses a
  derived result only if it matches the batch's own head SHA and context
  fingerprint; when its derivation was superseded, it reviews without intent
  (`status: superseded`) unless the stored intent matches that revision.
- If every run in the batch is cancelled before intent work begins, no
  classifier call is made.
- Reviewers receive the intent as an untrusted section; a trusted scope policy
  is added to the system message only when intent is present. Without intent the
  prompt is byte-identical to before.
- The policy never lets intent remove or downgrade a real defect; low-confidence
  or unverified intent is context only.
- Each run trace stores an immutable copy of the intent it used. Classifier
  cost stays on the cache, not in the run's cost or the PR-list total.

**Model:** the `review_intent` feature-model setting chooses the classifier;
its default is unchanged. The call asks for low reasoning effort with a
4,000-token output budget: reasoning tokens count against that budget, and
without the limit a reasoning model can spend all of it and return no answer.

## Out of scope

Plan/spec link ingestion, external URLs, the PR brief (blast radius, risks,
history), and automatic recomputation in the UI.

## Verification

- reviewer-core: evidence budgets and exact line sets, citation validation,
  prompt byte-identity without intent, policy placement, no post-model
  filtering.
- server: linked-issue identification and fingerprints (unit); cache, single
  flight, staleness, failed Recompute, no-key, authorization, ordering, review
  reuse/refresh/failure, trace immutability and cost separation (Postgres);
  deterministic gated tests for a PR update during an in-flight derivation, a
  superseded derivation never reaching a review, an older failure not
  overwriting newer metadata, and no classifier call when every run is
  cancelled first.
- client: every Intent card state.
- e2e: `10-pr-intent.flow.json` renders the seeded, fresh intent with no model
  call.
