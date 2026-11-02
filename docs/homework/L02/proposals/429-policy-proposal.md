# Upstream 429 policy for a future #17 confirmatory study (proposal)

> **Status: unapproved proposal (Agent D2, 2026-11-02; revised after two
> independent reviews).** It authorizes no spending, freezes nothing, and
> changes no frozen record. It changes none of these: the #17 rule, the
> fixture, the Skill, the prompts, the model, the historical results or the
> sealed adjudications. Adopting any policy here needs an owner decision, a
> reviewed runner change, and a new pre-registration with its own approval
> packet.

**Sources.**

- **The numbers** come from a pure model,
  [`server/src/experiments/hw2/throttle-policy.ts`](../../../../server/src/experiments/hw2/throttle-policy.ts).
  The runner does not use it.
- **The tests** are in
  [`server/test/hw2-throttle-policy.test.ts`](../../../../server/test/hw2-throttle-policy.test.ts).
  They pin every table cell printed below.
- **The empirical 429 record** is Agent R's
  [provider reliability analysis](429-reliability-analysis.md).

## Why this is needed

- **The 429s.** R's inventory counts 19 paid dispatches across HW2. All were
  `deepseek/deepseek-v4-flash` on the pinned `deepinfra/fp8` endpoint, with
  fallbacks off and one request in flight at a time. 14 completed, 1 was
  truncated (v3 `c-17-with-2`), and 4 got an HTTP 429 from DeepInfra's shared
  upstream pool (`limit_source upstream_provider_shared_pool`):
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
- **The 429 rate, from R.** The intervals are 95% Clopper–Pearson, from R's
  section 4.1.

  | Subset | 429s | Rate | 95% interval |
  | --- | --- | --- | --- |
  | Overall | 4/19 | 0.21 | [0.061, 0.456] |
  | #17 | 3/9 | 0.33 | [0.075, 0.701] |
  | `max_tokens` 8,000 or 16,000 (the successor's configuration) | 4/11 | 0.36 | [0.109, 0.692] |
  | Other experiments | 1/10 | 0.10 | [0.003, 0.445] |
  | With Skill | 2/10 | 0.20 | [0.025, 0.556] |
  | Without Skill | 2/8 | 0.25 | [0.032, 0.651] |

  - #17 against the rest: Fisher p = 0.30. With against without: p = 1.0.
  - R found no association with input size or with the gap between calls.
    Five v3 requests sent 1.3–4.9 s apart got no 429: four completed and one,
    `c-17-with-2`, was truncated.
  - The intervals are wide, so the tables keep the scenario grid p = 0.02 to
    0.40 and add rows at three empirical point estimates.
  - **The planning rate.** The successor runs at the 8,000-token cap, so the
    planning numbers below lead with the #17-only (3/9) and high-cap (4/11)
    rates. The overall 4/19 rate is context: it includes 8 requests at a
    4,000-token cap that the successor will not use.
- **Two untested hypotheses, not design inputs.**
  - **The output cap.** None of the 8 requests at a 4,000-token cap got a
    429, against 4 of 11 at higher caps (p ≈ 0.10). This is confounded with
    campaign and date, and lowering the cap is excluded in any case: v3
    truncated at 4,000.
  - **Time of day.** The 429s cluster in the UTC evening, which is also when
    the operator worked.
- **Position in session** (R §4.2). Each of the four 429s was the 2nd paid
  request of its session (X1, X2, Phase 1, v4). R rates this "probably
  coincidence", since v3 then ran six back to back without a 429. It is still
  the strongest positional signal in the record, and section 4 treats it as a
  scenario.

## The #17 rule is unchanged

- **The rule.** Detected only if at least 4 of 5 *with*-Skill trials and at
  most 1 of 5 *without*-Skill trials are adjudicated "detected", under the
  two-part rule (an error branch **and** the exact expiry boundary).
- **Code.** `experimentOutcome` in
  [`rules.ts`](../../../../server/src/experiments/hw2/rules.ts) applies the
  rule. It returns `success`, `negative`, `inconclusive` or `incomplete`. The
  model calls that function and does not reimplement it.
- **Pass probability.** With no 429s, at true detection rates of 0.8 / 0.2,
  the pass probability is 0.73728² = **0.5436**. No 429 policy can raise
  that. A policy can only keep the study from losing trials.
- **What a non-detection means.** With n = 5 per arm, even a Skill that works
  as hoped yields "detected" only about half the time. A failure to detect is
  therefore **uninformative** about the Skill, and no result may be called
  significant.

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
- **Any other failure stops the study,** with no new attempt, and leaves it
  `incomplete`, exactly as in v4. That covers a timeout, a 5xx, a schema
  failure, a provenance gap, a fingerprint mismatch, unknown cost apart from
  a classified 429, and any ambiguity.
- **Which 429s count.** Only a 429 refused before generation is a
  *throttle*: no response ID, no usage, and origin `upstream_provider`. A 429
  that carries a response ID or any usage counts as a failure and stops the
  study. Section 7 gives the exact classification rule.

| Policy | On a classified 429 | Max attempts (10 trials) |
| --- | --- | --- |
| **P1** stop (v4 status quo) | The trial is missing and the study stops. The remaining trials are not dispatched. | 10 |
| **P2** exclude | The trial is missing as an unobserved outcome. No re-attempt and no replacement. The study goes on to the next trial in the fixed order. | 10 |
| **P3** predeclared attempt pool | The trial's next predeclared attempt ID is used after the fixed backoff, up to K per trial. If all K get a 429, the trial is missing and the study goes on. A hard total cap M bounds the study. Reaching M stops it. | min(M, 10K) |
| **P4** sensitivity | Added to any of P1–P3. Missing trials are imputed both ways and both outcomes are reported. A claim is allowed only when every missing trial was lost to a classified 429. | as the base policy |

**Optional outage stop** (`maxConsecutiveThrottles`, P2 and P3):

- The study stops after L classified 429s in a row, counted across trials and
  reset by any response.
- Like the P1 stop and the cap, it is a 429-caused stop. It depends only on
  429s, never on detections or conditions.
- **The recommended value is L = 6.** That is two trials' full pools, so an
  outage stop always implies at least one fully throttled trial. It
  therefore cannot lower P(all observed). A persistent outage then holds six
  reservations, not thirty.

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
- **What is reported.** Each bound is the frozen rule's own four-valued
  outcome (`experimentOutcome`), never a binary pass/fail. "Fail" is never to
  be read as `negative`.
- **What may be claimed** (`claim`):
  - all 5 + 5 counted: the strict rule;
  - otherwise, only when **every missing trial was lost to a classified
    pre-generation 429**:
    - `detected` if the worst case is `success`;
    - `not_detected` if even the best case is not.

    Trials lost to a 429 include those not dispatched after a P1 stop, the
    cap or the outage stop.
  - anything else, including any non-429 stop: `incomplete`, as in v4. The
    bounds are then descriptive only.
- **Why a worst-case claim is safe under any mechanism.** The rule is
  monotone: more *with* detections or fewer *without* detections never turn
  a success into a non-success. A worst-case success therefore implies a
  full-data success for **every** possible value of the missing trials,
  whatever caused them to be missing, MNAR included. The same holds for a
  best-case non-success. A test enumerates every tally to check this.
- **P1 + P4 changes v4's semantics.** Under v4, a 429 stop leaves the study
  `incomplete` with no claim. P1 combined with P4 would let a 429-stopped
  study make a bounded claim. That would be a disclosed change in a new
  pre-registration, not v4.

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
  detection, a condition, or the state of an arm. The tests check that every
  attempt gets the same delay in every outcome sequence, and that both
  conditions get the same delay at the same index.
- **Wall time.** For K = 3, the worst-case total wait is 9 × 30 s + 10 ×
  (60 s + 180 s) = 2,670 s, about 45 min, plus request time. That fits the
  3-hour capability lifetime used in v4.
- **Why pace at all.** A constant inter-trial delay gives every first attempt
  the same gap since the previous request, whichever condition it belongs
  to. R found no association between the gap and a 429, so pacing is a
  courtesy and a control, not a cure.

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
  - continuing after a stop;
  - a delay that differs from the plan;
  - **a trace that ends before the protocol terminates**: optional stopping
    after some trials, or a last trial abandoned with a predeclared attempt
    still owed.

  The tests check each rejection.
- **Mutation record.** The test file's header lists ten code mutations of
  these guards and of the model, each verified to fail at least one test.
  They can be rerun by hand.

### Is a 429-triggered next attempt a "retry"?

In plain language, yes, and the pre-registration must say so. v4 froze
"Retries, reprompts, fallbacks, replacements: none". P3 would break that, so
P3 cannot be described as a v4 run. It must be a new pre-registration that
declares a **bounded re-attempt on a pre-generation HTTP 429 only**.

| It is defensible because | It is not |
| --- | --- |
| A classified 429 is a refusal before generation: no tokens, no response ID. The re-attempt therefore reacts to admission control, never to anything the model produced. | a reprompt or a structured-output repair |
| Every attempt ID is fixed before the study, reserved and recorded, with its own ledger line. | a silent SDK retry: experiment mode keeps SDK retries at 0 |
| It is bounded (K per trial, M in total, L in a row) and identical for both conditions. | a replacement: no new trial is ever drawn |

The report must list every attempt next to the trial it belongs to. For each
429 it must also give the schedule position and the condition.

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
  1,034 input tokens. R judges this mechanically implausible as a cause.
- **Position in session.** All four observed 429s were the 2nd paid request
  of their session (R §4.2). Through the seeded order, position maps to
  condition: in the illustrative schedule, position 2 is a *with* trial.
- **Order effects.** Under a cap that binds, later trials are more likely to
  be missing.

**Why the estimate is safe in principle.** A pre-generation 429 happens
before the model sees the request. Missingness therefore cannot depend on
the response the trial would have produced, except through a common cause,
such as a load period that affects both admission and the served replica's
behaviour.

| Missingness depends on | Effect |
| --- | --- |
| Nothing relevant (MCAR) | Only n falls. |
| Condition or position only | The outcomes the arm would have shown are unaffected, but one arm loses more trials, so a decision is reached less often. |
| A common cause of load and output (MNAR) | Observed rates can be biased in either direction. P4's claim stays valid, because a worst-case success implies success for every value of the missing trials. |

**A position-hazard scenario** (`throttleByPosition`; H1). The 429
probability is 0.6 at schedule position 2 and 0.15 elsewhere. Expected
missing trials, *with* / *without*, and P(claim decided):

| Policy | Expected missing with / without | P(claim decided) |
| --- | --- | --- |
| P1 | 3.919 / 3.490 | 0.134 |
| P2 | 1.200 / 0.750 | 0.503 |
| P3, K = 2, M = 20 | 0.450 / 0.112 | 0.834 |
| P3, K = 3, M = 30 | 0.229 / 0.017 | 0.926 |
| P3, K = 3, M = 30, L = 6 | 0.235 / 0.023 | — |

A non-binding cap removes the *cap* channel of position dependence, but not
position dependence itself. The arm that holds position 2 loses more trials.
P4's claim stays valid; only the per-arm balance suffers.

**An optional warm-up** (owner decision 3):

- **What it is.** One or more predeclared, unscored warm-up dispatches before
  trial 1. Each has its own ID, reservation and ledger line. A warm-up is
  never scored, never adjudicated, never pooled and never re-attempted, and
  it is disclosed as a design choice driven by a hypothesis.
- **How many.** Under a "2nd request of the session" hazard, *one* warm-up
  only moves trial 1 into position 2. *Two* warm-ups absorb positions 1 and
  2. Every trial then faces the base rate: expected missing per arm is about
  5 × 0.15³ ≈ 0.017 under P3 with K = 3.
- **Cost.** Two warm-ups add at most $0.01 of reservations and about
  $0.0007–0.0016 of actual spend.

How the design exposes or limits each source:

- **Interleaving and an independent order.** The seeded pairs and coin-flip
  order spread conditions over the session. With 5 pairs, the counterbalance
  cannot be exact. The order is reported.
- **Constant pacing.** It gives both conditions the same gap since the
  previous request.
- **A symmetric attempt pool.** The same K, backoff, cap and outage stop
  apply to both arms. A cap of M = 10K never binds, so the cap introduces no
  position dependence.
- **The cap's effect is small; P1's is large.** Across 200 seeds:
  - a binding cap (K = 3, M = 20, p = 0.4) shifts the expected-missing
    difference, *with* − *without*, by at most ±0.018 (mean 0.002);
  - **P1 is the most position-biased design of the four.** At p = 0.2, its
    difference reaches ±0.40 trials for a given order, because everything
    after the first 429 is lost.
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
  every policy, including cases with a binding cap, truncations and
  failures, a burst, a position hazard and an outage stop. With a fixed seed
  it gives fixed results.
- An independent reviewer's dynamic program reproduces the values.

**Columns.**

- P3/K2 is K = 2, M = 20; P3/K3 is K = 3, M = 30.
- **K = 3 with M = 20** gives the same values to 3 decimals up to p = 0.2. At
  p = 0.3 it gives P(all observed) = 0.7600 (against 0.7606); at p = 0.4,
  0.5131.
- **The outage stop L = 6** leaves P(all observed) unchanged. It lowers
  P(claim decided) by at most 0.01: 0.805 against 0.815 at p = 0.4, and
  0.887 against 0.891 at 3/9.

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
| **R #17 only, 3/9 = 0.3333** | **0.0173** | **0.3079** | **0.6856** |
| **R high cap, 4/11 = 0.3636** | **0.0109** | **0.2421** | **0.6109** |
| R overall, 4/19 = 0.2105 | 0.0941 | 0.6355 | 0.9105 |

**Expected number of observed trials (of 10).** The full distributions are
`counted_distribution` in the model. For example, at p = 0.2, P2 gives
P(10, 9, 8, 7, ≤6) = 0.107, 0.268, 0.302, 0.201, 0.121. P1 gives
P(0 observed) = 0.200, because it stops on the first trial.

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 8.96 | 9.80 | 9.996 | 9.9999 |
| 0.05 | 7.62 | 9.50 | 9.975 | 9.999 |
| 0.10 | 5.86 | 9.00 | 9.90 | 9.99 |
| 0.20 | 3.57 | 8.00 | 9.60 | 9.92 |
| 0.30 | 2.27 | 7.00 | 9.10 | 9.73 |
| 0.40 | 1.49 | 6.00 | 8.40 | 9.36 |
| R 3/9 | 1.97 | 6.67 | 8.89 | 9.63 |
| R 4/11 | 1.73 | 6.36 | 8.68 | 9.52 |
| R 4/19 | 3.40 | 7.89 | 9.56 | 9.91 |

**P4: P(claim decided)** means the claim is `detected` or `not_detected`
whatever the missing trials would have shown, not `incomplete`. Under H1
(0.8 / 0.2), then H0 (0.2 / 0.2):

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 0.850 / 0.923 | 0.940 / 0.998 | 0.999 / 1.000 | 1.000 / 1.000 |
| 0.05 | 0.664 / 0.818 | 0.854 / 0.993 | 0.992 / 1.000 | 1.000 / 1.000 |
| 0.10 | 0.437 / 0.666 | 0.720 / 0.984 | 0.970 / 0.999 | 0.997 / 1.000 |
| 0.20 | 0.184 / 0.433 | 0.501 / 0.952 | 0.882 / 0.995 | 0.976 / 0.999 |
| 0.30 | 0.076 / 0.272 | 0.345 / 0.897 | 0.745 / 0.986 | 0.920 / 0.997 |
| 0.40 | 0.031 / 0.162 | 0.239 / 0.811 | 0.580 / 0.967 | 0.815 / 0.991 |
| R 3/9 | 0.056 / 0.230 | 0.305 / 0.872 | 0.692 / 0.981 | 0.891 / 0.995 |
| R 4/11 | 0.043 / 0.197 | 0.273 / 0.846 | 0.642 / 0.976 | 0.859 / 0.994 |
| R 4/19 | 0.168 / 0.413 | 0.482 / 0.948 | 0.870 / 0.994 | 0.972 / 0.999 |

**Same four-valued outcome.** The stricter requirement is that both bounds
give the same `experimentOutcome`, for example both `negative` rather than
one `negative` and one `inconclusive`. Under P3/K3, H1, that holds with
probability 0.971 at p = 0.2, 0.863 at 3/9 and 0.822 at 4/11
(`bounded_same_outcome`).

**Pass probability under H1**, as strict (all observed and `success`) /
claim `detected` (strict, or a worst-case `success` with only 429s missing).
The ceiling is 0.5436.

| p | P1 | P2 | P3/K2 | P3/K3 |
| --- | --- | --- | --- | --- |
| 0.02 | 0.444 / 0.452 | 0.444 / 0.496 | 0.541 / 0.543 | 0.544 / 0.544 |
| 0.10 | 0.190 / 0.208 | 0.190 / 0.325 | 0.492 / 0.520 | 0.538 / 0.541 |
| 0.20 | 0.058 / 0.072 | 0.058 / 0.168 | 0.361 / 0.450 | 0.502 / 0.524 |
| 0.40 | 0.003 / 0.006 | 0.003 / 0.027 | 0.095 / 0.222 | 0.281 / 0.397 |
| R 3/9 | 0.009 / 0.014 | 0.009 / 0.054 | 0.167 / 0.304 | 0.373 / 0.457 |
| R 4/11 | 0.006 / 0.009 | 0.006 / 0.040 | 0.132 / 0.267 | 0.332 / 0.432 |
| R 4/19 | 0.051 / 0.064 | 0.051 / 0.155 | 0.345 / 0.440 | 0.495 / 0.521 |

**False positives.**

- **The rule's own false-positive rate.** Under a null with equal detection
  rates q in both arms, the full-data rate is P(Bin(5, q) ≥ 4) ·
  P(Bin(5, q) ≤ 1). It peaks at **0.0352 at q = 0.5**, and is 0.005 at
  q = 0.2.
- **P4 does not raise it.** A worst-case `success` implies a full-data
  success for any values of the missing trials, so P4 cannot raise the rate
  under any missingness mechanism. For example, the P3/K3 claim rate at
  p = 0.2, q = 0.5 is 0.0333. Over a grid of q × p × policy, the claim rate
  never exceeds the full-data rate; its maximum is 0.0352.

### Limitation: the model assumes independent 429s

Shared-pool limits are probably bursty.

**The burst model** (`burst`): P(429 | the previous dispatched attempt got a
429) = ρ, carried across trials as well as within them. The 30 s
inter-trial gap is shorter than the backoffs, so carry-over across trials is
plausible. At p = 0.2, H1:

| | ρ = 0.5 | ρ = 0.8 |
| --- | --- | --- |
| P3/K3: P(all observed) | 0.599 | 0.254 |
| P3/K3: P(claim decided) | 0.846 | 0.564 |
| P3/K3: P(claim `detected`) | 0.423 | 0.228 |
| P3/K3 + L = 6: P(claim decided) / P(`detected`) | 0.832 / 0.419 | 0.487 / 0.216 |
| P3/K2: P(claim decided) | 0.694 | 0.449 |
| P2: P(claim decided) | 0.422 | 0.304 |

Under independence, P3/K3 gives 0.976 decided and 0.524 `detected` at the
same p.

**What the record can and cannot tell us.**

- The 60 s and 180 s backoffs aim to get past a burst, but nothing measured
  shows that they do.
- The 429s carried no `Retry-After` header, so the provider gave no hint
  either.
- Four events cannot estimate ρ.

**At the upper ends of R's intervals,** independence still gives these
values for P3 with K = 3:

- overall p = 0.456: P(all observed) = (1 − 0.456³)¹⁰ ≈ 0.37;
- #17 p = 0.701: P(all observed) ≈ 0.015.

At the #17 upper bound no policy here completes. Only a different time
window or route would.

## 6. Cost ceilings

**Inputs** (`COST_INPUTS_20261102`).

- These are an **illustrative snapshot** for 2026-11-02, not a ledger
  reading.
- Every cost function takes them as a parameter. Before any freeze, the
  approval packet must recompute them from the live ledger, the live prices
  and the caps.

| Input | Value |
| --- | --- |
| Reservation per attempt | $0.005. It covers 1.2 × the $0.00343899 worst case at the 8,000-token cap. |
| Measured actual cost per answered call | $0.00035–0.0008 |
| A 429 | Unbilled so far (four events). Its cost stays unknown, so the ledger holds the full reservation (`charge` in [`budget.ts`](../../../../server/src/experiments/hw2/budget.ts)). The v4 429 still holds its $0.005 after settlement. |
| Ledger (snapshot) | $0.02174118 conservative, of which $0.0076964 is confirmatory |
| Caps | $1.00 confirmatory, $1.50 total |

**Ceilings.**

- **The hard ceiling** is the reservations: every attempt held at $0.005.
- **The billed-429 bound** is what real spend could reach if every attempt,
  429s included, were billed at the per-attempt worst case. It does not
  depend on 429s staying unbilled.

| Policy | Max attempts | New reservations (capability budget) | Cumulative conservative ceiling | Billed-429 bound | Fits caps |
| --- | --- | --- | --- | --- | --- |
| P1 | 10 | $0.05000000 | $0.07174118 | $0.03438990 | yes |
| P2 | 10 | $0.05000000 | $0.07174118 | $0.03438990 | yes |
| P3, K = 2, M = 20 | 20 | $0.10000000 | $0.12174118 | $0.06877980 | yes |
| P3, K = 3, M = 20 | 20 | $0.10000000 | $0.12174118 | $0.06877980 | yes |
| **P3, K = 3, M = 30 (± L = 6)** | 30 | **$0.15000000** | **$0.17174118** | **$0.10316970** | yes |

The outage stop does not lower the declared ceiling, because 429s spread
out with responses in between can still reach M. It caps a persistent
outage at 6 attempts, which hold $0.03.

**Expected spend** (`expectedSpend`, H1).

- "Actual" is answered calls × the measured cost.
- "Ledger growth" adds $0.005 held for every expected 429.

| p | Policy | E[attempts] | E[429s] | Expected actual | Expected conservative ledger growth |
| --- | --- | --- | --- | --- | --- |
| 0.05 | P1 | 8.03 | 0.40 | $0.0027–0.0061 | $0.0047–0.0081 |
| 0.05 | P2 | 10.00 | 0.50 | $0.0033–0.0076 | $0.0058–0.0101 |
| 0.05 | P3/K3 | 10.52 | 0.53 | $0.0035–0.0080 | $0.0061–0.0106 |
| 0.20 | P1 | 4.46 | 0.89 | $0.0013–0.0029 | $0.0057–0.0073 |
| 0.20 | P2 | 10.00 | 2.00 | $0.0028–0.0064 | $0.0128–0.0164 |
| 0.20 | P3/K3 | 12.40 | 2.48 | $0.0035–0.0079 | $0.0159–0.0203 |
| 4/11 | P3/K3 | 14.96 | 5.44 | $0.0033–0.0076 | $0.0305–0.0348 |
| 0.40 | P1 | 2.48 | 0.99 | $0.0005–0.0012 | $0.0055–0.0062 |
| 0.40 | P2 | 10.00 | 4.00 | $0.0021–0.0048 | $0.0221–0.0248 |
| 0.40 | P3/K3 | 15.60 | 6.24 | $0.0033–0.0075 | $0.0345–0.0387 |

**Where the money goes.**

- **Actual spend.** It stays under one cent for every policy, **provided
  429s stay unbilled**. That rests on four events. If they were billed, the
  billed-429 bound above applies: $0.103 at M = 30.
- **Conservative ledger growth.** Under P3 it is mostly reservations held for
  unbilled 429s.
- **Releasing held reservations.** Whether a settled key delta that proves a
  429 unbilled may release its reservation to $0 is an owner decision,
  listed below. The ledger code does not do that today.

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

- a new study tag and slot-ID prefix, with `-a<k>` attempt IDs, plus warm-up
  IDs if the owner chooses warm-ups;
- a new seed, derived from the new manifest fingerprint;
- a new manifest and a new approval packet.

It is **never pooled** with Phase 1, v3 or v4.

**Runner changes adoption would need.** They are not made here, and each
needs its own reviewed PR with tests:

- **Attempt IDs.** Extend the slot-ID grammar and admission (`TAGGED_SLOT_ID`
  in `schedule.ts`) to the attempt IDs, and to warm-up IDs if chosen.
- **Throttle classification, strict and structured.**
  - **What counts.** A throttle is classified only from the numeric HTTP
    status (429) together with the structured `origin` and `limit_source`
    fields, checked against an exact allowlist (`upstream_provider`,
    `upstream_provider_shared_pool`). It is never classified from a message
    or body text.
  - **Anything ambiguous** counts as `failed` and stops the study. That
    covers a 429 with a response ID or any usage, an unknown or missing
    `limit_source`, and an OpenRouter-origin 429.
  - **Never persist the raw provider body.** Keep the sanitized,
    closed-vocabulary fields only.
- **The runner loop.** Implement P2 or P3 in `runSchedule`, including the
  attempt cap and the hard outage stop: a global consecutive-429 limit, so a
  persistent outage cannot consume the full M. Today a confirmatory slot
  that fails or has unknown cost stops the schedule, and the
  consecutive-unknown-cost rule (default 2) would also fire on 429s. A
  classified-429 exception must be explicit and narrow.
- **Pacing.** Apply the declared waits through the existing injectable
  `sleep`.
- **Spending checks.**
  - Keep the cumulative-ceiling check against the **live** ledger at
    authorization, never against the snapshot in this document.
  - Keep reservation holds for 429s unless the owner approves a release
    rule.
- **Manifest.** Freeze the policy, K, M, L, the pacing and any warm-ups in
  the manifest's study block, so they are part of the fingerprint.
- **Reports.**
  - Make report and adjudication count missing trials and print both P4
    outcomes (four-valued), the claim and the balance check.
  - List every attempt, with each 429's position and condition.
  - Mark the claim `incomplete` whenever a missing trial is not a
    classified 429.

## 8. Recommendation

**Recommended: P3 with K = 3, M = 30 and an outage stop at L = 6, plus P4
reporting.**

- **Pacing.** 30 s between trials, with backoffs of 60 s and 180 s.
- **Strict result is primary.** The frozen rule on all 10 observed trials.
- **When a trial is missing,** report both four-valued bounds and the
  balance check.
  - Claim "detected" only if the worst case is `success` and every missing
    trial is a classified 429.
  - Any non-429 stop leaves the study `incomplete`.
- **Why M = 30.** It equals the plan length, so the cap never binds and adds
  no position dependence. It still bounds the reservations at $0.15.
- **Why L = 6.** It caps a persistent outage at six held reservations. It
  costs at most 0.01 in decidability, and nothing in completion.
- **What it gives, at the planning rates** (P(all observed) / P(claim
  decided)):
  - **#17 only, 3/9:** 0.686 / 0.887, against 0.017 / 0.056 under the status
    quo;
  - **high cap, 4/11:** 0.611 / 0.853, against 0.011 / 0.043 under the
    status quo;
  - for context, overall 4/19: 0.911 / 0.972.
- **Its own success probability** under H1 (0.8 / 0.2), P(claim
  `detected`), is about 0.46 at 3/9, 0.43 at 4/11 and 0.52 at p = 0.2. A
  failure to detect is uninformative about the Skill, and no result may be
  called significant.
- **Spend.** Expected actual spend is under $0.01 in every scenario, while
  429s stay unbilled. The hard ceiling is $0.15 in reservations, and $0.103
  if every attempt were billed at the worst case.

**Alternatives:**

- **P3 with K = 3 and M = 20.** A $0.10 ceiling, with the same values to 3
  decimals up to p = 0.2. At higher p the cap can bind and introduce a small
  positional asymmetry: at most ±0.018 expected missing trials across seeds.
- **P2 + P4.** Cheapest that does not stop. It is honest, but at 3/9 the
  strict rule is decidable 1.7% of the time and the claim 31%.
- **P1 (status quo).** Defensible only if p is really near 0.02. At the
  planning rates it completes 1–2% of the time, and it is the most
  position-biased design.
- **Two warm-ups** (section 4), on top of any policy. They answer the
  position-2 pattern for at most $0.01 of reservations.

**Limitations:**

- The assumption of independent 429s. Under bursts, decidability falls to
  0.85 (ρ = 0.5) or 0.56 (ρ = 0.8) at p = 0.2 (section 5).
- The position-2 pattern. It is untested and may be coincidence. If it is
  real, it unbalances the arms unless warm-ups are used.
- The 0.5436 ceiling at 0.8 / 0.2: no 429 policy turns n = 5 into a powered
  test.
- The illustrative schedule. The real order comes from the frozen manifest.
- The re-attempt is still a retry in plain language, and must be declared as
  one.

## Owner decisions required

1. **The policy.** P3 (with K, M and L), P2 or P1. Also whether P4's
   worst-case claim may support "detected" when trials are missing (only to
   classified 429s), or only a fully observed strict result may.
2. **Accepting the re-attempt.** Whether a bounded re-attempt on a
   pre-generation 429 is acceptable as a declared departure from v4's
   "no retries", in a new pre-registration.
3. **Warm-ups.** Whether to add zero, one or two predeclared, unscored
   warm-up dispatches for R's position-2 pattern. Two are needed to absorb
   position 2.
4. **Pacing and run window.** The pacing values, and whether to pre-declare a
   run window outside the UTC evening. That would rest on R's weak
   clustering hint and be disclosed as such.
5. **The provider.** Keep the single pinned DeepInfra endpoint, or
   pre-register a second configuration or route as a separate, never-pooled
   arm.
6. **Settling unbilled 429s.** Whether a settled key delta proving a 429
   unbilled may release its reservation, or whether the conservative ledger
   keeps holding $0.005 per 429.
7. **The planning rate.** This proposal leads with the #17-only (3/9) and
   high-cap (4/11) rates.
8. **Runner work.** Approve the runner and manifest changes in section 7 as
   a separate PR before any freeze. A new approval packet would follow. It
   would state the capability budget and cumulative ceiling from section 6,
   recomputed against the live ledger at that time.
