# Proposal: `Edge Cases and Error Paths` Skill v2 (#17)

**Status: a proposal only. It is not approved, not seeded and not frozen.**
Nothing here changes a seeded Skill or authorizes spending. The analysis it
rests on is in [17-skill-effectiveness-analysis.md](17-skill-effectiveness-analysis.md).

## Exact change

The proposed body is in [17-skill-v2-body.txt](17-skill-v2-body.txt) (926
characters, no trailing newline, sha256
`7b41e38bc68c94c7d450c153971bbed7cbb3804bb1d0abbc42c4e462febc0af8`).

In `server/src/db/seed-skills.ts` the name, description and type stay the
same; only the body changes:

```diff
   {
     name: 'Edge Cases and Error Paths',
     description: 'Covers boundaries and failure behavior introduced by the change.',
     type: 'rubric',
-    body:
-      'Look for untested empty, missing, malformed, boundary, authorization, and dependency-failure inputs relevant to this diff. Require fail-closed behavior where security or data integrity is involved.',
+    body: `Check the changed production code, branch by branch, for behavior that no test exercises.
+
+- Comparisons and limits: for each relational comparison, threshold, size or count limit, or time cutoff that the diff adds or changes, require a test at the exact on-point value and one just on the other side of it. Tests that use only distant values cannot tell >= from > or < from <=. Report a missing on-point test as its own finding that names the comparison, the value to test, and the expected result there.
+- Error paths: for each throw, rejection, error return, or failure status that the diff adds, including a failure of a called dependency, require a test that triggers it and asserts the error.
+- Inputs: empty, missing, malformed, and authorization-relevant inputs that the changed code handles.
+
+Skip a case that an existing test already covers. Require fail-closed behavior where security or data integrity is involved.`,
   },
```

In `server/src/db/reviewed-seed-skills.ts`:

```diff
-  'Edge Cases and Error Paths': '82a7461ebbbe62468b147ed04fb2571b0bf7d8d1adeb794839739e77d48ed17f',
+  'Edge Cases and Error Paths': '7b41e38bc68c94c7d450c153971bbed7cbb3804bb1d0abbc42c4e462febc0af8',
```

The body contains no backticks and no `${`, so it is safe as a template
literal. Recompute the digest from the committed string before committing.

**Ablation variant (v2-min).** v1 plus one sentence; body in
[17-skill-v2min-body.txt](17-skill-v2min-body.txt), sha256
`dcd3714b97457f82b0796850badbaff2ea4749def186c7a2ca560c70daad8401`. The
added sentence:

> For each comparison or limit the diff adds or changes, require a test at
> the exact on-point value and one just across it; tests with only distant
> values cannot tell >= from >.

v2-min is an **exploratory ablation only**. In any paid study it is either
dropped or reported as a secondary contrast with Holm correction. The single
confirmatory contrast is **v2 vs no Skill** (see the
[evaluation template](17-heldout-fixtures.md#prospective-evaluation-template-shared-by-17-and-18)).

## Rationale: one change per observed failure mode

| Change | Observed failure it targets |
| --- | --- |
| "Check the changed production code, branch by branch" | All 63 system-role findings were anchored to the test file, none to the production comparison |
| A per-comparison on-point and off-point rule | 6/9 reviews quoted `>=` or the operator; 7/9 wrote the on-point instant somewhere, but only 2/9 named the equality boundary in a title or rationale |
| "Report … as its own finding" | The on-point test merged into the error-path finding's suggestion, which "distinct / do not pad" encourages. The output schema is unchanged. See "Rule echo and gaming risk". |
| The error-path bullet, extended to dependency failures | Keeps the part that already works (9/9) |
| "Skip a case that an existing test already covers" | Limits noise |

## Why it generalizes, and where it does not

- **No fixture vocabulary.** The body names no coupon, discount, expiry,
  `expiresAt`, `applyDiscount`, billing, percentage or cents (grep-checked).
- **Textbook procedures.** It encodes boundary-value on/off points, the
  mutation-killing test for relational operators, and exception-path
  coverage. These apply to integers, sizes, strings, times and status codes.
- **Honest caveat.** "Time cutoff" was added after seeing #501's miss, so a
  v2 result on #501 is **not blind**. Primary evidence must come from
  held-out fixtures ([17-heldout-fixtures.md](17-heldout-fixtures.md)); #501
  is secondary and disclosed as non-blind.

## Rule echo and gaming risk

- **The echo.** "Report a missing on-point test as its own finding that
  names the comparison, the value to test, and the expected result there"
  nearly restates what the frozen #17 rule credits (an explicit equality
  boundary in the title or rationale).
- **Its likely effect on #501 [I].** The model already writes the on-point
  test in 7/9 reviews, mostly inside a suggestion
  ([analysis](17-skill-effectiveness-analysis.md#the-suggestion-field-v-counts-i-reading)).
  The instruction would mostly move that test into the fields adjudicators
  see. That is a reporting-format change aimed at the instrument, not
  evidence that the model found something new.
- **Mechanical inflation.** One finding per comparison can raise hits
  mechanically, because the rule credits the review's findings together.
- **Handling.** Keep the instruction only as part of the declared treatment,
  with noise gates: findings per review, and a precision / false-positive
  guard on a negative control. Score held-out fixtures on two pre-declared
  **co-primary** endpoints, each tested at α = 0.05, and require **both** to
  improve (an intersection-union test, which needs no further correction):
  - **explicit:** the primary target is named in title + rationale;
  - **implicit:** the primary target's on-point value (or, for an
    error-path fixture, its triggering input) appears anywhere in a finding,
    including `suggestion`. Defined per fixture in
    [17-heldout-fixtures.md](17-heldout-fixtures.md#primary-target-per-fixture).
- **Why co-primary.** The echo instruction targets title + rationale, so
  the explicit endpoint alone could improve through reporting format only.
  Requiring the implicit endpoint to improve too shows that v2 changes what
  the model tests, not only where it writes it.
- **Disclosure.** Every report states that the instruction echoes the
  scoring rule.

## Risks

- **More findings.** Each comparison can add one finding, so a fixture with
  many thresholds gets noisier.
- **False positives** where boundaries are tested outside the diff. A
  single-pass review with repo-intel off cannot see those tests.
- **On-point requests for trivially safe comparisons** (loop bounds, clamps
  with no behavioural transition).
- **Size.** The body grows about 4.7× (926 against 197 characters, about 200
  tokens). That changes every *with*-arm fingerprint and the input bound.
- **A blinding leak.** "On-point" and "off-point" may appear in *with*
  findings. Add them to a new redaction version, r2.
- **Severity creep** from the retained "fail-closed" sentence.
- **Instruction review.** "Report … as its own finding" must be reviewed as
  review guidance, not as a change to the output contract.
- **Re-seeding [V].** The skill row is select-then-insert if absent by name
  (`server/src/db/seed.ts`); only the `skill_versions` insert uses
  `onConflictDoNothing`. An existing workspace keeps v1 and its approval.
  Only a freshly seeded stack gets v2. A changed body is unapproved until the
  owner approves its digest.

## Required approvals (none granted)

1. Owner review of this exact body.
2. A new allowlist digest in `reviewed-seed-skills.ts`, with
   `server/test/reviewed-seed-skills.test.ts` passing, in one reviewed commit
   together with `seed-skills.ts`.
3. Owner approval through the Skill approval gate, for the new version, on
   each stack used.
4. A new pre-registration that never reuses v3/v4/v5 manifests or slot IDs.
   It needs:
   - new fingerprints and seed;
   - the held-out fixtures with frozen rules;
   - redaction r2;
   - a statement that the Skill was revised after the v1 results, and that
     its reporting instruction echoes the scoring rule;
   - the explicit and implicit co-primary endpoints;
   - v1 observations never pooled with v2.
5. A separate owner authorization for any spending.
6. Preferably, held-out fixtures curated or sealed by someone other than the
   Skill's author. Agent A wrote both.
