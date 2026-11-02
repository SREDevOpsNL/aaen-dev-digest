# Upstream 429 policy for a future #17 confirmatory study (proposal)

> **Status: unapproved proposal (Agent D2, 2026-11-02).** It authorizes no
> spending, freezes nothing, and changes no frozen record. It changes none of
> these: the #17 rule, the fixture, the Skill, the prompts, the model, the
> historical results or the sealed adjudications. Adopting any policy here
> needs an owner decision, a reviewed runner change, and a new
> pre-registration with its own approval packet.

The numbers come from a pure model,
[`server/src/experiments/hw2/throttle-policy.ts`](../../../../server/src/experiments/hw2/throttle-policy.ts).
Its regression tests are in
[`server/test/hw2-throttle-policy.test.ts`](../../../../server/test/hw2-throttle-policy.test.ts).
The runner does not use the model.

## Why this is needed

- **The 429s.** Agent R's verified inventory (2026-11-02) counts 19 paid
  dispatches across HW2. All were `deepseek/deepseek-v4-flash` on the pinned
  `deepinfra/fp8` endpoint, with fallbacks off and one request in flight at a
  time. 14 completed, 1 was truncated (v3 `c-17-with-2`), and 4 got an HTTP
  429 from DeepInfra's shared upstream pool (`limit_source
  upstream_provider_shared_pool`):
  - two on `main` (Gate 3);
  - `x-17-without-1` in Phase 1;
  - `c-v4-17-with-2` in v4.
- **What every 429 looked like.**
  - It arrived 303–906 ms after submission.
  - It had no `Retry-After` header, no `X-RateLimit-*` headers, no response
    ID and no usage.
  - It was not billed: key usage equals the exact sum of the 15
    completed/truncated costs.
  - R's inference, at medium-high confidence: DeepInfra's shared capacity was
    saturated, and pinning one provider with fallbacks off removed
    OpenRouter's recovery path. It was not OpenRouter's own throttling.
- **How the paid #17 attempts ended.** Two of the three paid attempts ended on
  a 429 under a stop-on-429 rule (Phase 1 and v4). The third (v3) ended on a
  truncation, which v4 designed out.
- **The 429 rate, from R.** The intervals are 95% Clopper–Pearson.

  | Subset | 429s | Rate | 95% interval |
  | --- | --- | --- | --- |
  | Overall | 4/19 | 0.21 | [0.061, 0.456] |
  | #17 | 3/9 | 0.33 | [0.075, 0.701] |
  | Other experiments | 1/10 | 0.10 | [0.003, 0.445] |
  | With Skill | 2/10 | 0.20 | [0.025, 0.556] |
  | Without Skill | 2/8 | 0.25 | [0.032, 0.651] |

  - #17 against the rest: Fisher p = 0.30. With against without: p = 1.0.
  - R found no association with input size or with the gap between calls.
    Five v3 requests sent 1.3–4.9 s apart all completed.
  - The intervals are wide, so the tables keep the scenario grid p = 0.02 to
    0.40 and add rows at the two empirical point estimates.
- **An untested hypothesis, not a design input.** None of the 8 requests
  with a 4,000-token output cap got a 429, against 4 of 11 at higher caps
  (p ≈ 0.10). The 429s also cluster in the UTC evening. Both hints are weak
  and confounded with time and study, so this proposal does not use them.
  Lowering the cap is excluded in any case: v3 truncated at 4,000.

## The #17 rule is unchanged

- **The rule.** Detected only if at least 4 of 5 *with*-Skill trials and at
  most 1 of 5 *without*-Skill trials are adjudicated "detected", under the
  two-part rule (an error branch **and** the exact expiry boundary).
- **Code.** `experimentOutcome` in
  [`rules.ts`](../../../../server/src/experiments/hw2/rules.ts) applies the
  rule, and the model calls that function. It does not reimplement it.
- **Pass probability.** With no 429s, at true detection rates of 0.8 / 0.2,
  the pass probability is 0.73728² = **0.5436**. No 429 policy can raise
  that. A policy can only keep the study from losing trials.

## 1. The four policies, as protocols

Every policy shares these rules:

- **Schedule.** The seeded, balanced interleave of 5 *with* and 5 *without*
  trials, built by `buildSchedule` in
  [`schedule.ts`](../../../../server/src/experiments/hw2/schedule.ts). The
  seed is derived from the new manifest's fingerprint, as in v4.
- **Truncation.** The frozen v4 rule. An eligible truncation (known cost,
  frozen fingerprints, single-attempt provenance) is terminal and imputed
  against the hypothesis (*with* → no, *without* → yes). It is never
  re-attempted. An ineligible truncation stops the study.
- **Any other failure stops the study,** with no new attempt. That covers a
  timeout, a 5xx, a schema failure, a provenance gap, a fingerprint mismatch,
  unknown cost apart from a classified 429, and any ambiguity.
- **Which 429s count.** Only a 429 refused before generation is a
  *throttle*: no response ID, no usage, and origin `upstream_provider`. A 429
  that carries a response ID or any usage counts as a failure and stops the
  study.

| Policy | On a classified 429 | Max attempts (10 trials) |
| --- | --- | --- |
| **P1** stop (v4 status quo) | The trial is missing and the study stops. The remaining trials are not dispatched. | 10 |
| **P2** exclude | The trial is missing as an unobserved outcome. No re-attempt and no replacement. The study goes on to the next trial in the fixed order. | 10 |
| **P3** predeclared attempt pool | The trial's next predeclared attempt ID is used after the fixed backoff, up to K per trial. If all K get a 429, the trial is missing and the study goes on. A hard total cap M bounds the study. Reaching M stops it. | min(M, 10K) |
| **P4** sensitivity | Added to any of P1–P3. Every missing trial is imputed both ways and both verdicts are reported. | as the base policy |

P3 details (`planAttempts`, `execute`):

- **Attempt IDs.** `c-<tag>-17-<condition>-<trial>-a<k>`, for example
  `c-v5-17-with-3-a2`. Even the first attempt carries `-a1`, so no attempt ID
  can equal a v3 or v4 slot ID (`ATTEMPT_ID`). The tag and seed are chosen at
  freeze; `v5` in the code and tests is illustrative only.
- **Plan.** The plan is the seeded trial order, with a1 … aK inside each
  trial. It is built before any outcome exists and takes no outcome as input.
- **When the next ID is used.** Attempt a(k+1) of trial t is used only right
  after attempt a(k) of the same trial got a classified 429. A detection, a
  non-detection, a truncation or a failure never opens a new attempt.
- **What is scored.** The trial's outcome is that of its first attempt that
  was not a 429.
- **Considered and rejected:** a per-condition pool of spare attempts. Which
  trial a spare serves is decided at run time. One arm can drain its pool
  first, and then missingness depends on schedule position. A per-trial pool
  keeps every attempt ID tied to one trial in advance.

P4 details (`sensitivity`):

- **Worst case,** against the hypothesis: a missing *with* trial becomes no,
  and a missing *without* trial becomes yes.
- **Best case,** for the hypothesis: the opposite imputation.
- **Truncations.** v4-imputed truncations keep their frozen conservative value
  in both bounds.
- **Decided or not.** The result is *decided* when both bounds give the same
  verdict, and *undecided* otherwise.
- **Strict reading.** The frozen rule on observed trials alone is
  `undecidable` unless all 5 + 5 are counted.

## 2. Pacing, backoff, and why nothing adapts

`PROPOSED_PACING` sets the delays as data. A delay depends only on the
attempt's place in the plan (`delayBefore`):

| Before | Delay |
| --- | --- |
| The first attempt of trial 1 | 0 s |
| The first attempt of every later trial | 30 s |
| Attempt a2 (after a 429 on a1) | 60 s |
| Attempt a3 (after a 429 on a2) | 180 s |

- **No jitter, no adaptation.** No delay is shortened or lengthened by a
  detection, a condition, or the state of an arm.
- **Wall time.** For K = 3, the worst-case total wait is 9 × 30 s + 10 ×
  (60 s + 180 s) = 2,670 s, about 45 min, plus request time. That fits the
  3-hour capability lifetime used in v4.
- **Why pace at all.** The v4 429 arrived a few seconds after slot 1
  completed. A constant inter-trial delay gives every first attempt the same
  gap since the previous request, whichever condition it belongs to.

### Why adaptive allocation is excluded

- **What the randomization buys.** It makes the condition independent of
  everything that varies over the session: provider load, time, and
  position. Any rule that changes the allocation after seeing outcomes breaks
  that independence.
- **Three examples.** Each would make an arm's sample depend on the other
  arm's results or on load history, so the two arms would no longer be
  exchangeable:
  - reordering trials by condition;
  - skipping a condition while the pool is "hot";
  - extending only the arm that is behind.
- **What P3 does instead.** It never changes which trial comes next, never
  changes a trial's condition, and never adds a trial. The validator
  (`traceProblems`) rejects all of the following:
  - a re-attempt after anything but a 429;
  - a jump ahead in the order, including to catch up an arm;
  - skipping a trial's remaining attempts;
  - an ID outside the plan;
  - exceeding the cap;
  - a delay that differs from the plan.

  The tests check each rejection, and six code mutations of these guards each
  fail at least one test.

### Is a 429-triggered next attempt a "retry"?

In plain language, yes, and the pre-registration must say so. v4 froze
"Retries, reprompts, fallbacks, replacements: none". P3 would break that, so
P3 cannot be described as a v4 run. It must be a new pre-registration that
declares a **bounded re-attempt on a pre-generation HTTP 429 only**.

| It is defensible because | It is not |
| --- | --- |
| A classified 429 is a refusal before generation: no tokens, no response ID. The re-attempt therefore reacts to admission control, never to anything the model produced. | a reprompt or a structured-output repair |
| Every attempt ID is fixed before the study, reserved and recorded, with its own ledger line. | a silent SDK retry: experiment mode keeps SDK retries at 0 |
| It is bounded (K per trial, M in total) and identical for both conditions. | a replacement: no new trial is ever drawn |

The report must list every attempt, including each 429, next to the trial it
belongs to.

## 3. Provider: one pinned endpoint, unless the owner decides otherwise

- **Recommended.** Keep the single pinned endpoint (`deepinfra/fp8`, served
  model `deepseek/deepseek-v4-flash-20260423`, fallbacks off).
- **Another provider is a different configuration.** It may differ in
  quantization, hardware and served model, all of which can change outputs.
  It could only be:
  - a separately pre-registered configuration, with its own fingerprints and
    its own results, never pooled with the DeepInfra trials; or
  - a separate study.

  Falling back to it silently after a 429 is excluded.
- **A different route.** A route with its own provider quota (for example, a
  bring-your-own-key route) might avoid the shared pool, which is where the
  observed 429s came from. It would change the billing path and the
  provenance checks, and it would need a new secret. That is a configuration
  change to disclose, and it is not evaluated here.
- **A declared time window.** Running in a pre-declared, lower-load window
  keeps the configuration the same and may lower p. The window must be stated
  in advance. It does not replace a 429 policy.

## 4. Selection bias from missingness

**How a 429 could depend on the condition:**

- **Prompt size.** The *with* request is slightly larger: 1,142 against
  1,034 input tokens.
- **Timing.** Within a pair, the second request follows the first quickly
  unless the run is paced. The v4 429 hit the second slot of the session.
- **Order effects.** Under a cap that binds, later trials are more likely to
  be missing.

**Why the estimate is safe in principle.** A pre-generation 429 happens
before the model sees the request. Missingness therefore cannot depend on
the response the trial would have produced, except through a common cause,
such as a load period that affects both admission and the served replica's
behaviour.

| Missingness depends on | Effect |
| --- | --- |
| Nothing relevant (MCAR) | The observed rates are unbiased. Only n falls. |
| The condition only | Per-arm rates are still unbiased, but one arm loses more trials, so the rule becomes undecidable more often. |
| A common cause of load and output (MNAR) | Observed rates can be biased in either direction. P4's bounds are the only honest report. |

How the design exposes or limits each source:

- **Interleaving and an independent order.** The seeded pairs and coin-flip
  order spread conditions over the session. With 5 pairs, the counterbalance
  cannot be exact. The order is reported.
- **Constant pacing.** It removes the within-pair timing difference.
- **A symmetric attempt pool.** The same K, backoff and cap apply to both
  arms. A cap of M = 10K never binds, so missingness does not depend on
  position.
  - The model shows the effect of a binding cap. With K = 3 and M = 20 at
    p = 0.4, the expected missing counts on the illustrative order are 0.341
    (*with*) against 0.323 (*without*). With M = 30 they are 0.320 and 0.320.
- **Every attempt is recorded** with its timestamp, its outcome and its
  served-model provenance. A served-model change under load fails the
  existing provenance checks and stops the study.
- **Balance check, always reported.** The report gives the missing trials per
  condition and the two-sided Fisher exact p-value of missing × condition
  (`missingnessBalance`). With 5 per arm it can flag only gross imbalance: 3
  against 0 missing gives p = 0.167. It is reported, not used as a gate.

## 5. Completion and decidability probabilities

**Model.**

- Each attempt independently gets a 429 with probability p.
- Each scored trial detects with probability 0.8 (*with*) and 0.2 (*without*)
  under H1, or 0.2 / 0.2 under H0.
- No truncation or other failure.
- The values are exact: dynamic programming over the schedule
  (`exactMetrics`).
- They equal the closed forms to 10⁻¹² (`closedFormCompletion`):
  - P1: P(all observed) = (1−p)¹⁰, with a truncated-geometric count of
    observed trials;
  - P2: Binomial(10, 1−p);
  - uncapped P3: Binomial(10, 1−p^K).
- A seeded Monte Carlo through the real `execute` state machine (`simulate`,
  20,000 runs per case) agrees within 4.5 standard errors. That holds for
  every policy, including one with a binding cap and one with truncations and
  failures. With a fixed seed it gives fixed results.

Columns: P3/K2 is K = 2, M = 20; P3/K3 is K = 3, M = 30. K = 3 with M = 20
gives the same values to 3 decimals up to p = 0.3; at p = 0.4 it gives
0.5131.

**P(all 10 trials observed)**: the strict rule is decidable. P1 and P2 are
identical here.

| p | P1 = P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- |
| 0.02 | 0.8171 | 0.9960 | 0.9999 |
| 0.05 | 0.5987 | 0.9753 | 0.9988 |
| 0.10 | 0.3487 | 0.9044 | 0.9900 |
| 0.20 | 0.1074 | 0.6648 | 0.9228 |
| 0.30 | 0.0282 | 0.3894 | 0.7606 |
| 0.40 | 0.0060 | 0.1749 | 0.5161 |
| **R overall, 4/19 = 0.2105** | **0.0941** | **0.6355** | **0.9105** |
| **R #17 only, 3/9 = 0.3333** | **0.0173** | **0.3079** | **0.6856** |

**Expected number of observed trials (of 10).** The full distributions are
`counted_distribution` in the model. For example, at p = 0.2, P2 gives
P(10, 9, 8, 7, ≤6) = 0.107, 0.268, 0.302, 0.201, 0.122. P1 gives
P(0 observed) = 0.200, because it stops on the first trial.

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 8.96 | 9.80 | 9.996 | 9.9999 |
| 0.05 | 7.62 | 9.50 | 9.975 | 9.999 |
| 0.10 | 5.86 | 9.00 | 9.90 | 9.99 |
| 0.20 | 3.57 | 8.00 | 9.60 | 9.92 |
| 0.30 | 2.27 | 7.00 | 9.10 | 9.73 |
| 0.40 | 1.49 | 6.00 | 8.40 | 9.36 |
| R 4/19 | 3.40 | 7.89 | 9.56 | 9.91 |
| R 3/9 | 1.97 | 6.67 | 8.89 | 9.63 |

**P4: P(worst and best case agree)**, meaning the rule is decided whatever
the missing trials would have shown. Under H1 (0.8 / 0.2), then H0
(0.2 / 0.2):

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 0.850 / 0.924 | 0.940 / 0.998 | 0.999 / 1.000 | 1.000 / 1.000 |
| 0.05 | 0.664 / 0.818 | 0.854 / 0.994 | 0.993 / 1.000 | 1.000 / 1.000 |
| 0.10 | 0.437 / 0.666 | 0.720 / 0.984 | 0.970 / 0.999 | 0.997 / 1.000 |
| 0.20 | 0.184 / 0.433 | 0.501 / 0.952 | 0.882 / 0.995 | 0.976 / 0.999 |
| 0.30 | 0.076 / 0.272 | 0.346 / 0.897 | 0.745 / 0.986 | 0.920 / 0.997 |
| 0.40 | 0.031 / 0.162 | 0.239 / 0.811 | 0.580 / 0.967 | 0.815 / 0.991 |
| R 4/19 | 0.168 / 0.413 | 0.482 / 0.948 | 0.870 / 0.994 | 0.972 / 0.999 |
| R 3/9 | 0.056 / 0.230 | 0.306 / 0.872 | 0.692 / 0.981 | 0.891 / 0.995 |

**Pass probability under H1**, as strict (all observed and passing) / worst
case. The worst-case pass is the conservative verdict a P4 report could
claim. The ceiling is 0.5436.

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 0.444 / 0.452 | 0.444 / 0.496 | 0.541 / 0.543 | 0.544 / 0.544 |
| 0.10 | 0.190 / 0.209 | 0.190 / 0.325 | 0.492 / 0.520 | 0.538 / 0.541 |
| 0.20 | 0.058 / 0.072 | 0.058 / 0.168 | 0.361 / 0.450 | 0.502 / 0.524 |
| 0.40 | 0.003 / 0.006 | 0.003 / 0.027 | 0.095 / 0.222 | 0.281 / 0.397 |
| R 4/19 | 0.051 / 0.064 | 0.051 / 0.155 | 0.345 / 0.440 | 0.495 / 0.521 |
| R 3/9 | 0.009 / 0.014 | 0.009 / 0.054 | 0.167 / 0.304 | 0.373 / 0.457 |

**False positives.** Under H0 the worst-case pass probability never exceeds
0.0050 in any cell, so imputing against the hypothesis does not inflate false
positives.

### Limitation: the model assumes independent 429s

Shared-pool limits are probably bursty. Let ρ be the probability of a 429
given a 429 on the previous attempt of the same trial. A P3 trial is then
missing with probability p·ρ^(K−1), not p^K. At p = 0.2, K = 3:

- with ρ = 0.5, P(all observed) = 0.95¹⁰ = **0.599**;
- with ρ = 0.8, it falls to **0.254**.

The 60 s and 180 s backoffs aim to get past a burst, but nothing measured
shows that they do. The 429s carried no `Retry-After` header, so the
provider gave no hint either. R's inventory shows 429s clustering in the UTC
evening, but four events cannot estimate ρ.

**At the upper ends of R's intervals,** independence still gives these
values for P3 with K = 3:

- overall p = 0.456: P(all observed) = (1 − 0.456³)¹⁰ ≈ 0.37;
- #17 p = 0.701: P(all observed) ≈ 0.015.

At the #17 upper bound no policy here completes. Only a different time
window or route would.

## 6. Cost ceilings

**Inputs** (`COST_INPUTS_20261102`; recompute before any freeze):

| Input | Value |
| --- | --- |
| Reservation per attempt | $0.005. It covers 1.2 × the $0.00343899 worst case at the 8,000-token cap. |
| Measured actual cost per answered call | $0.00035–0.0008 |
| A 429 | Unbilled so far, but its cost stays unknown, so the ledger holds the full reservation (`charge` in [`budget.ts`](../../../../server/src/experiments/hw2/budget.ts)). The v4 429 still holds its $0.005 after settlement. |
| Ledger | $0.02174118 conservative, of which $0.0076964 is confirmatory |
| Caps | $1.00 confirmatory, $1.50 total |

**Ceilings.** The worst-case ledger impact equals the new reservations: every
attempt held at its reservation.

| Policy | Max attempts | New reservations (capability budget) | Cumulative conservative ceiling | Fits caps |
| --- | --- | --- | --- | --- |
| P1 | 10 | $0.05000000 | $0.07174118 | yes |
| P2 | 10 | $0.05000000 | $0.07174118 | yes |
| P3, K = 2, M = 20 | 20 | $0.10000000 | $0.12174118 | yes |
| P3, K = 3, M = 20 | 20 | $0.10000000 | $0.12174118 | yes |
| **P3, K = 3, M = 30** | 30 | **$0.15000000** | **$0.17174118** | yes |

**Expected spend** (`expectedSpend`, H1). "Actual" is answered calls × the
measured cost. "Ledger growth" adds $0.005 held for every expected 429.

| p | Policy | E[attempts] | E[429s] | Expected actual | Expected conservative ledger growth |
| --- | --- | --- | --- | --- | --- |
| 0.05 | P1 | 8.03 | 0.40 | $0.0027–0.0061 | $0.0047–0.0081 |
| 0.05 | P2 | 10.00 | 0.50 | $0.0033–0.0076 | $0.0058–0.0101 |
| 0.05 | P3/K3 | 10.52 | 0.53 | $0.0035–0.0080 | $0.0061–0.0106 |
| 0.20 | P1 | 4.46 | 0.89 | $0.0013–0.0029 | $0.0057–0.0073 |
| 0.20 | P2 | 10.00 | 2.00 | $0.0028–0.0064 | $0.0128–0.0164 |
| 0.20 | P3/K3 | 12.40 | 2.48 | $0.0035–0.0079 | $0.0159–0.0203 |
| 0.40 | P1 | 2.48 | 0.99 | $0.0005–0.0012 | $0.0055–0.0062 |
| 0.40 | P2 | 10.00 | 4.00 | $0.0021–0.0048 | $0.0221–0.0248 |
| 0.40 | P3/K3 | 15.60 | 6.24 | $0.0033–0.0075 | $0.0345–0.0387 |

**Where the money goes.** Actual spend stays under one cent for every policy,
because a 429 has not been billed. Most of the conservative ledger growth
under P3 is reservations held for unbilled 429s. Whether a settled key delta
that proves a 429 unbilled may release its reservation to $0 is an owner
decision, listed below. Ledger code does not do that today.

## 7. What stays unchanged, and what is new

**Unchanged:**

- the #17 rule text and `experimentOutcome`;
- fixture #501 `8e0ba133…`;
- the Skill body `82a7461e…` and its link;
- the reviewer, the system prompt and the output schema;
- the model, the provider pin and temperature 0;
- the 8,000-token cap and the v4 truncation rule;
- the rules file `bb8fb1d0…`;
- adjudication packet v2 with redaction r1;
- every historical result, ledger record and sealed adjudication.

**New:** the successor is a new pre-registration, with:

- a new study tag and slot-ID prefix, with `-a<k>` attempt IDs;
- a new seed, derived from the new manifest fingerprint;
- a new manifest and a new approval packet.

It is **never pooled** with Phase 1, v3 or v4.

**Runner changes adoption would need.** They are not made here, and each
needs its own reviewed PR with tests:

- **Attempt IDs.** Extend the slot-ID grammar and admission (`TAGGED_SLOT_ID`
  in `schedule.ts`) to the attempt IDs.
- **Throttle classification.** Classify a throttle strictly: HTTP 429, no
  response ID, no usage, origin `upstream_provider`.
- **The runner loop.** Implement P2 or P3 in `runSchedule`. Today a
  confirmatory slot that fails or has unknown cost stops the schedule, and
  the consecutive-unknown-cost rule (default 2) would also fire on 429s.
- **Pacing.** Apply the declared waits through the existing injectable
  `sleep`.
- **Manifest.** Freeze the policy, K, M and the pacing in the manifest's
  study block, so they are part of the fingerprint.
- **Reports.** Make report and adjudication count missing trials, print both
  P4 bounds and the balance check, and list every attempt.

## 8. Recommendation

**Recommended: P3 with K = 3 and M = 30, plus P4 reporting.**

- **Pacing.** 30 s between trials, with backoffs of 60 s and 180 s.
- **Strict result is primary.** The frozen rule on all 10 observed trials.
- **When a trial is missing,** report the worst-case and best-case bounds and
  the balance check, and claim "detected" only if the worst case passes.
- **Why M = 30.** It equals the plan length, so it never binds and
  missingness cannot depend on position. It still bounds spend at $0.15 of
  reservations.
- **What it gives.** For p ≤ 0.2, the strict rule is decidable with
  probability ≥ 0.92 and the bounds are decided with probability ≥ 0.97. At
  p = 0.4, those are 0.52 and 0.81.
- **At R's empirical rates:**
  - overall 4/19: 0.91 decidable and 0.97 bounded, against 0.09 under the
    status quo;
  - #17-only 3/9: 0.69 and 0.89, against 0.02 under the status quo.
- **Expected actual spend** is under $0.01 in every scenario.

**Alternatives:**

- **P3 with K = 3 and M = 20.** A $0.10 ceiling, with the same completion up
  to p = 0.3. At high p the cap can bind and introduce a small positional
  asymmetry.
- **P2 + P4.** Cheapest that does not stop. It is honest, but at p = 0.2
  the strict rule is decidable only 11% of the time and the bounds only 50%.
- **P1 (status quo).** Defensible only if p is really near 0.02. At R's
  overall rate it completes 9% of the time, and at the #17 rate 2%.

**Limitations:**

- The assumption of independent 429s (section 5).
- The 0.5436 ceiling at 0.8 / 0.2: no 429 policy turns n = 5 into a powered
  test, and no result may be called significant.
- The illustrative schedule. The real order comes from the frozen manifest.
- The re-attempt is still a retry in plain language, and must be declared as
  one.

## Owner decisions required

1. **The policy.** P3 (with K and M), P2 or P1, and whether P4's worst-case
   verdict may support a "detected" claim when trials are missing, or whether
   only a fully observed strict result may.
2. **Accepting the re-attempt.** Whether a bounded re-attempt on a
   pre-generation 429 is acceptable as a declared departure from v4's
   "no retries", in a new pre-registration.
3. **Pacing values,** including whether to also pre-declare a run window.
4. **The provider.** Keep the single pinned DeepInfra endpoint, or
   pre-register a second configuration or route as a separate, never-pooled
   arm.
5. **Settling unbilled 429s.** Whether a settled key delta proving a 429
   unbilled may release its reservation, or whether the conservative ledger
   keeps holding $0.005 per 429.
6. **Agent R's rate.** Whether to plan on R's overall rate (4/19) or on the
   #17-only rate (3/9) when choosing K. Also whether to pre-declare a run
   window outside the UTC evening. That would rest on R's weak clustering
   hint, would be disclosed as such, and would not be a tested design input.
7. **Runner work.** Approve the runner and manifest changes in section 7 as
   a separate PR before any freeze. A new approval packet would follow; it
   would state the capability budget and cumulative ceiling from section 6,
   recomputed against the ledger at that time.
