# #17: why the Edge Cases and Error Paths Skill has not shown an advantage

Agent A (#17 Skill Effectiveness Analyst), 2026-11-03. This analysis is
read-only and unpaid. It made no provider call and opened no secret. It was
then independently reviewed (see the [review record](17-18-21-review-record.md)).

Labels: **[V]** verified from a recorded artifact · **[I]** inference ·
**[U]** cannot be verified.

## Bottom line

- **Formal status of each study, kept separate from the counts below.**
  - v3: formally **incomplete** (slot `c-17-with-2` truncated at the 4,000
    cap, output not kept).
  - v4: **stopped** on a 429 before the *with* slot completed.
  - v5: adjudicated claim `not_detected`; formal claim **incomplete**
    because of the pacing deviation.

  Three categories are reported and never merged: per-slot observations
  [V], each study's adjudicated claim, and each study's formal status. The
  pooled counts in this file are an exploratory, post-hoc summary across
  studies; they are not a study result.
- **No detectable difference in part (b)** (1/5 vs 1/4; underpowered). The
  reviewer named the exact equality boundary (`now == expiresAt`) in **1/5**
  system-role reviews with the Skill (v3 1/1, v5 0/4) and in **1/4** without
  it (v3 0/2, v4 0/1, v5 1/1). Per-slot counts [V]; the pooled Fisher
  p = 1.0 is exploratory (see "Pooling caveat").
- **Phase 1 is not pooled.** Its one with-Skill review (0/1) put the Skill in
  the user role.
- **Part (a) is at its ceiling in both arms.** The error branches were named
  in 9/9 reviews, so the whole #17 contrast rests on part (b). [V]
- **The model often writes the on-point test but does not name it.** In 6 of
  9 reviews it quotes `>=` or mentions changing "the comparison operator".
  The exact on-point instant (`2027-01-01T00:00:00Z`) appears in a finding's
  suggestion or rationale in 5/5 *with* reviews and 2/4 *without*, but only
  2/9 reviews name the equality boundary as such in the title or rationale.
  [V] for the counts; [I] for the reading. See "The `suggestion` field".
- **Exploratory signals that the Skill changes emphasis.** All post hoc,
  uncorrected, pooled across studies:
  - all 5 with-Skill summaries echo "error paths, edge cases, and boundary
    conditions"; none of the 4 without do (p = 0.008) [V] count;
  - the unknown-code and expired gaps were rated CRITICAL in 5/5 with-Skill
    reviews and 2/4 without (p = 0.17);
  - the on-point instant appears somewhere in a finding in 5/5 *with* and
    2/4 *without* (p = 0.167).

  None of these changes an official verdict.
- **What this shows:** "hypothesis not supported on fixture #501 with
  `deepseek/deepseek-v4-flash` and Skill v1". It is not evidence that the
  Skill, or Skills in general, are ineffective. #17 stays Implemented.

## Inputs [V]

- **Skill v1** (`server/src/db/seed-skills.ts`, 197 characters; allowlist
  digest `82a7461e…d48ed17f`):

  > Look for untested empty, missing, malformed, boundary, authorization,
  > and dependency-failure inputs relevant to this diff. Require fail-closed
  > behavior where security or data integrity is involved.

  It is sent as `### Edge Cases and Error Paths` plus the body. In the
  *with* arm it is the only Skill.
- **Reviewer prompt** (`server/src/db/seed-prompts.ts`). It asks to report
  concrete missed behaviours, not to demand coverage or details "that
  cannot affect confidence", and to cite an exact changed file and line
  range. The task line adds "only the distinct, high-value findings … do
  not pad or repeat" (`server/src/modules/reviews/helpers.ts`).
- **Placement** (`reviewer-core/src/prompt.ts`), in this order:
  - the reviewer prompt;
  - `## Skills / rules`, with the Skill in an `<untrusted>` wrapper;
  - the injection guard, always last. It describes Skill text as data
    describing review criteria.
- **Schema** (`findings.ts`): one file and line range per finding, a title
  and a rationale. There is no count limit.
- **Fixture #501** (`server/src/db/seed-fixtures.ts`):
  - production line 12 is `if (now >= coupon.expiresAt) throw …`;
  - the single test uses a `now` five months before expiry;
  - there are several distractors: a case-insensitive code, a clamp at
    100, rounding, a floor at 0, and a second coupon.

## Per-review evidence

Category codes:
- **U** unknown-code throw · **E** expired throw · **R** rounding
- **C** clamp at 100 · **F** floor at 0 · **CI** case-insensitive code
- **H** second coupon · **D** hardcoded test date
- **Z** total 0 · **N** negative total · **T1** total 1 · **P0** 0 % off
- **B** equality boundary

**On-point anywhere** = the exact instant `2027-01-01T00:00:00Z` appears in
some finding's suggestion or rationale (exploratory; not the frozen rule).

| Slot | Cond | Findings | Categories, in order | U/E severity | B | On-point anywhere | Adjudicated | Output tokens |
|---|---|---|---|---|---|---|---|---|
| Phase 1 `x-17-with-3` (user role) | with | 10 | U, E, …, D | CRIT/CRIT | no | — | half rule | 2,540 |
| v3 `c-17-with-1` | with | 7 | U, E, F, C, CI, R, **B** (last) | CRIT/CRIT | **yes** | yes | yes | 1,736 |
| v3 `c-17-with-2` | with | — | truncated at 4,000; output not kept | — | — | — | not counted | 4,000 |
| v3 `c-17-without-1` | without | 7 | E, U, CI, C, F, R, H | WARN/WARN | no | no | no | 1,992 |
| v3 `c-17-without-2` | without | 5 | U, E, R, F+C, H | CRIT/CRIT | no (quotes `>=`) | yes | no | 1,456 |
| v4 `c-v4-17-without-2` | without | 5 | E, U, R, F, CI | WARN/WARN | no | no | no | 1,454 |
| v4 `c-v4-17-with-2` | with | — | 429 | — | — | — | not counted | — |
| v5 `with-1` | with | 7 | U, E, C, F, R, CI, D | CRIT/CRIT | no (quotes `>=`) | yes | no | 1,834 |
| v5 `without-1` a2 | without | 10 | U, E, C, F, CI, Z, T1, P0, C(100), **B** (last) | CRIT/CRIT | **yes** | yes | yes | 2,452 |
| v5 `with-5` | with | 6 | U, E, F, C, CI, R | CRIT/CRIT | no | yes | no | 1,415 |
| v5 `with-3` a3 | with | 10 | U, E, C, F, CI, R, Z, N, H, D | CRIT/CRIT | no (quotes `>=`) | yes | no | 2,850 |
| v5 `with-4` | with | 6 | U, E, C, F, CI, R | CRIT/CRIT | no ("changes the comparison operator") | yes | no | 1,767 |

Every one of the 63 system-role findings (7+7+5+5+7+10+6+10+6) is anchored to the test file;
none is on the production comparison at `discount.ts:12`. [V]

### Aggregates (n = 5 with, n = 4 without)

| Measure | With | Without |
|---|---|---|
| Part (a) met | 5/5 | 4/4 |
| Part (b) met | 1/5 (95 % CI 0.5–72 %) | 1/4 (0.6–81 %) |
| On-point instant anywhere (exploratory) | 5/5 | 2/4 |
| F (floor at 0) and C (clamp at 100) | 5/5 | 4/4 |
| Mean findings | 7.2 | 6.75 |
| Mean output tokens | 1,920 | 1,839 |
| Summary says "boundary" | 5/5 | 0/4 |

- **Where B appears.** In both detections it is the *last* finding of the
  longest list in its arm. [V]
- **What "boundary" means to the model.** Of 8 uses of the word in
  findings, 6 are numeric (0, 1, 100) and 2 temporal. [V]

### Pooling caveat [I]

Per-slot counts are [V]. Every pooled *with*/*without* contrast in this file
(v3 + v4 + v5), and every Fisher p computed on it, is **exploratory and post
hoc**: the studies differ in output caps (4,000 vs 8,000), missing-data rules
and pre-registration, and none pre-registered a pooled test.

## The `suggestion` field [V] counts, [I] reading

The frozen #17 rule credits a finding that **explicitly names** the equality
boundary in its title or rationale, which is what adjudicators see. A
coordinator check of the private findings looked for the exact on-point
instant (SAVE10's `expiresAt`, `2027-01-01T00:00:00Z`) anywhere in a finding,
including the `suggestion` field:

| Measure | With | Without |
|---|---|---|
| On-point instant in a finding's suggestion or rationale | 5/5 (v3 `c-17-with-1`; v5 `with-1`, `with-5`, `with-3`, `with-4`) | 2/4 (v3 `c-17-without-2`; v5 `without-1` a2) |
| Equality boundary explicitly named in title or rationale | 1/5 (v3 `with-1`) | 1/4 (v5 `without-1`) |

- **Reading [I].** The model often writes the on-point test (5/5 vs 2/4,
  exploratory, not significant) inside the expired finding's suggested test, but does not
  report it as a separate equality boundary. The gap is mostly one of
  explicitness and reporting, not of seeing the comparison.
- **Status.** This is an exploratory, post-hoc sensitivity analysis on a
  pooled, non-pre-registered contrast: Fisher 5/5 vs 2/4, p = 0.167. It does
  **not** change any official verdict; the frozen rule and the adjudicated
  claims stand.

## Root causes, kept separate

1. **Explicitness and reporting: v1 gives no procedure for naming a
   comparison's on-point test.** [V]/[I]
   - v1 lists "boundary" as one of six input classes. It never says "for
     each comparison", "on-point" or "`>=` vs `>`".
   - The model already does what v1 literally asks: it names the 0 and 100
     limits in 9/9 reviews. [V]
   - It often writes the on-point test (7/9 reviews put the exact instant in
     a suggestion or rationale) but files it under the "expired" error-path
     finding instead of naming a separate equality boundary. Five reviews
     mention `>=` inside the expired finding; four stop there. [V] counts,
     [I] reading.
   - The frozen rule credits only explicit naming in the title or
     rationale, so an on-point test written into the suggestion does not
     count. That is the rule working as frozen, not a scoring error.
   - Two prompt lines pull the same way: "distinct, high-value … do not
     pad" and "details that cannot affect confidence" both discourage a
     second finding on the same `if`. [I]
   - The untrusted framing might lower the Skill's weight. [U]: no study
     varied it, and the Skill is visibly read.
2. **Model nondeterminism.**
   - Identical requests at temperature 0 differ: v3 `with-1` produced 1,736
     tokens and `with-2` hit the 4,000 cap. v5's four *with* reviews gave
     6, 6, 7 and 10 findings. [V]
   - B behaves like a tail item at about 20–25 % in both arms. [I]
3. **Fixture design.** [V]
   - 8–10 competing gaps, six of them numeric extremes.
   - B shares its line with E.
   - The test date sits five months before the threshold. Two reviews
     noticed this and still did not name the equality boundary as its own
     finding.
   - Every anchor is in the test file. [I]: this frames the task as "what
     does this test lack" rather than "which production line is unpinned".
   - Part (a) is saturated.
   - Wording hazard: the ground truth's `now == expiresAt` is mathematical
     notation. In TypeScript, `==` on two `Date` objects compares
     references. Adjudicators read it as "the same instant", so this did
     not cause any miss. [V]/[I]
4. **Scoring strictness.**
   - Adjudicators rejected "after expiry", a bare `>=` quote and "changes
     the comparison operator". [V]
   - **Strictness does not create the null.** Two exploratory lenient
     re-scores [V]:
     - crediting operator-mutation wording: *with* 2/5 (v3 `with-1`, v5
       `with-4`) against *without* 1/4;
     - also crediting a bare `>=` quote: *with* 4/5 against *without* 2/4,
       which still fails the frozen rule (≤ 1 *without* detection is
       required).

**Not supported as causes:**
- truncation or the output budget (v5: cap 8,000, nothing truncated, and
  *with* outputs are not longer);
- the schema forbidding such a finding;
- the Skill suppressing the boundary.

## Does v1 express a general method? No

v1 is a list of input categories. It has no rule that maps a construct, such
as a comparison or a throw, to a required test. The reviews mostly write that test already; the
missing step is explicitly reporting that test as its own boundary. Standard practice it lacks:

- **Boundary value analysis.** Test at, just below and just above each
  boundary (Myers, *The Art of Software Testing*; ISTQB Foundation).
- **Domain testing on/off points.** Every relational operator implies an
  on-point test (Beizer, *Software Testing Techniques*; Kaner, Padmanabhan &
  Hoffman, *The Domain Testing Workbook*).
- **Mutation testing.** A suite that cannot tell `>=` from `>` leaves that
  mutant alive (DeMillo, Lipton & Sayward 1978; PIT's conditionals-boundary
  mutator).
- **Exception-path tests** (Meszaros, *xUnit Test Patterns*).
- **Time logic tested at the transition instant** with an injected clock.

## More paid runs with unchanged v1? No

- **Chance of a pass.** With uniform priors updated on the counts above
  (Beta(2,5) *with*, Beta(2,4) *without*), a fresh 5+5 study passes the
  frozen rule (≥ 4/5 *with* and ≤ 1/5 *without*) with probability about
  **3.4 %**. Counting Phase 1 as a *with* miss, it is about 2.3 %. Both
  figures are **conditional on a complete run**; at the observed 429 rate a
  complete 5+5 run is itself unlikely, so the realistic chance is lower.
- **Even a real effect would rarely show.** If the true *with* rate were 0.5,
  P(≥ 4/5) would be only 19 %.
- **Little to learn.**
  - Part (a) is saturated.
  - With n = 5 per arm the frozen rule passes at most 54 % of the time, even
    at true rates of 0.8 / 0.2.
  - 15 of v5's 20 attempts were 429s.

  Another v1 study can at best repeat "no detectable difference".
- **What would add information:** a disclosed, generic revision evaluated on
  held-out fixtures under a new pre-registration ([proposal](17-skill-v2-proposal.md),
  [fixtures](17-heldout-fixtures.md)).

## What may and may not be claimed

- **Allowed:** "On #501 with `deepseek-v4-flash` and Skill v1, the hypothesis
  was not supported. Observed: *with* 1/5, *without* 1/4. v5's adjudicated
  claim is `not_detected`, and its formal claim `incomplete`."
- **Not allowed:**
  - "#17 Verified";
  - "the Skill is ineffective";
  - "the model cannot find equality boundaries" (it named one in 2/9
    reviews, one in each arm, and wrote the on-point value in 7/9);
  - "the Skill made the model write on-point tests" (5/5 vs 2/4 is
    exploratory, p = 0.167).
