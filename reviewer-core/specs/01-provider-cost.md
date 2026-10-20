# Provider cost contract

**Status:** shipped (L01 Run Cost).

How the cost fields work today is in
[`../docs/review-engine.md`](../docs/review-engine.md#providers-and-cost). This
spec keeps the contract and the tests that prove it.

## Problem

The studio shows a USD cost for every review run and sums it in the PR list.
That number must be what the provider actually charged. A token-price estimate
can drift from real billing (cached tokens, discounts, price changes), so it
must never be presented as the authoritative cost.

## Public surface

- `StructuredResult` (the shared contract) carries two fields:
  - `providerCostUsd: number | null`, the authoritative cost;
  - `costUsd: number | null`, the best available cost.
- `ReviewOutcome` from `reviewPullRequest` carries the same two fields,
  aggregated over every call of the review.

## Inputs

`OpenRouterProvider` takes an optional injected
`estimateCost(model, tokensIn, tokensOut)`. The studio wires it to its live
price book (`server/src/platform/container.ts`). Only `costUsd` ever uses it.

## Purity impact

None. Cost comes from each response's `usage.cost`, which is requested with
`usage: { include: true }` on the same call, or from the injected estimator. The
engine makes no extra HTTP calls and holds no pricing table.

## Grounding and scoring

Unaffected. Cost depends neither on the findings nor on the score.

## Acceptance criteria

1. **Retries.** Within one `completeStructured` call, `providerCostUsd` is the
   sum of every attempt's finite, non-negative `usage.cost`, including repair
   retries.
   *Proof:* `test/openrouter-cost.test.ts`, "sums provider cost across
   structured-output retries".
2. **All or nothing.** If any attempt lacks a provider cost,
   `providerCostUsd` is `null`, even when other attempts reported one.
   `costUsd` keeps the partial provider total, and the estimator is not called.
   *Proof:* "keeps authoritative cost missing but preserves the legacy partial
   provider total".
3. **Estimator only as a fallback.** The estimator is used for `costUsd` only
   when no attempt reported a cost; `providerCostUsd` stays `null`.
   *Proof:* "uses the estimator only when no response reports cost".
4. **Zero is a real cost.** A reported `0` is authoritative, not missing.
   *Proof:* "preserves a provider-reported zero as authoritative".
5. **Across a review.** `reviewPullRequest` sums `providerCostUsd` over every
   map-reduce chunk, and returns `null` if any chunk is `null`.
   *Proof:* `test/run.test.ts`, "aggregates provider cost only when every
   map-reduce call reports it".
6. **The caller persists only the authoritative cost.** The studio stores
   `providerCostUsd` in `agent_runs.cost_usd` and never `costUsd`. A failed or
   cancelled run stores `null`.
   *Proof:* `server/test/reviews.it.test.ts`, "does not persist an estimated
   cost when authoritative provider cost is unavailable".
