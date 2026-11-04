# Held-out fixtures for evaluating a revised #17 Skill (specifications)

**Status: specifications only.** None is seeded, frozen or run. They exist
to test whether a revised Skill generalizes beyond fixture #501. None of them
involves money or codes; H2 is a deadline construct, disclosed as near
transfer.

Any run requires a new pre-registration and a separate owner spending
authorization (see [17-skill-v2-proposal.md](17-skill-v2-proposal.md)).

**The tables below are illustrative; the independent author writes the
sealed set from the construct specification.**

Each fixture is one small production change plus one weak test in the diff.
Scoring needs the explicit on-point value or the explicit error trigger;
generic "edge cases" wording does not count.

| ID | Language | Change under review | Test in the diff | Ground-truth missing tests | What an over-fitted Skill gets wrong |
| --- | --- | --- | --- | --- | --- |
| H1 | Python | `allow(requests_in_window, limit)` returns `requests_in_window < limit` | `allow(3, 10)` is True; `allow(50, 10)` is False | `requests_in_window == limit` → False; `limit - 1` → True | A time-focused Skill finds nothing, or asks for the "other branch", which is already tested |
| H2 | Go | `InGrace(now, due, grace)` returns `!now.After(due.Add(grace))`, inclusive at the deadline | one `now` well inside the window | `now == due+grace` → true (on-point); `due+grace+1ns` → false; the outside-window false case | Looks for a literal `>=`/`<=` and misses the negated `After`; or asks only for "a time after the window" |
| H3 | TypeScript | `parseRole(s)`: `trim().toLowerCase()`, returns `'admin'` or `'member'`, otherwise throws `InvalidRoleError` | `parseRole('admin')` | the invalid-input throw; the `'member'` branch; normalization (`' Admin '`); the empty string throws | Demands numeric on-point or length tests that do not exist, and misses the throw or the normalization |
| H4 | Java | an empty list returns empty; `items.size() > MAX_BATCH` throws `IllegalArgumentException` (`MAX_BATCH = 100`) | 3 items | size 100 accepted (on-point); size 101 throws; the empty list returns empty | Asks for "a large list" without the exact 100/101 pair; treats `>` as `>=` |
| H5 | Python (async) | `fetch_profile` awaits `client.get`; on `TimeoutError` returns the cached value; status 404 returns `None`; then `raise_for_status()` | a mocked 200 only | the timeout fallback; 404 → `None`; a 500 raises | Invents numeric on-point tests on status codes ("test 403, 405") instead of the three dependency outcomes; misses the timeout |
| H6 (far transfer) | TypeScript | `validateUsername(s)` throws `RangeError` unless `s.length <= MAX_LEN` (`MAX_LEN = 32`) | `'bob'` accepted; a 200-character name throws | length 32 accepted (on-point); length 33 throws; the empty string | Asks for "a very long name" or "an empty name" without the exact 32/33 pair; treats `<=` as `<` |
| H7 (far transfer) | Python | `has_next_page(page, size, total)` returns `(page + 1) * size < total` (zero-based pages) | page 0 of 95 items, size 10 → True; page 9 of 95 → False (neither is an exact multiple) | an exact final page, `(page + 1) * size == total` → False (on-point); one item more → True | Asks for "the last page" or "an empty collection" without the exact multiple; asks for negative inputs instead |
| H8 (far transfer, optional) | Go | `IsSupported(v)` returns `semver.Compare(v, MinVersion) >= 0` (`MinVersion = "v2.3.0"`) | `"v3.0.0"` is true; `"v1.0.0"` is false | `v == MinVersion` → true (on-point); `"v2.2.9"` → false | Asks for "an old version" or an invalid string without the exact minimum |
| N1 (negative control) | TypeScript | `backoffMs(attempt)`: a `RangeError` for a non-integer or `< 0`; `MAX_DELAY` when `attempt >= MAX_ATTEMPTS`; otherwise `BASE * 2 ** attempt` | -1 throws, 1.5 throws, 0, `MAX_ATTEMPTS-1`, `MAX_ATTEMPTS`, `MAX_ATTEMPTS+1` | none: every boundary and error path is tested | Any finding requesting a test that is already present is a false positive |

## Primary target per fixture

Each fixture has exactly one **primary** target; every other ground-truth
test in the table is secondary. The two co-primary endpoints (see the
[template](#prospective-evaluation-template-shared-by-17-and-18)) are scored
on the primary target: **explicit** = named in title + rationale;
**implicit** = the value below appears anywhere in a finding, including
`suggestion`.

| ID | Primary target | Implicit endpoint: appears anywhere | Transfer distance from #501 |
| --- | --- | --- | --- |
| H1 | `requests_in_window == limit` → False | a test with `requests_in_window` equal to `limit` | near (numeric analogue of an on-point comparison) |
| H2 | `now == due+grace` → true | a test at exactly `due+grace` | **near: #501's construct (inclusive time cutoff) in another language** |
| H3 | the invalid-role throw (`InvalidRoleError`) | the triggering input (an invalid role string) appears in a suggested test | far, error path (no on-point value) |
| H4 | size 100 accepted **and** size 101 throws (scored as one pair) | both 100 and 101 in suggested tests | near (numeric analogue) |
| H5 | the timeout fallback returns the cached value | the triggering input (a mocked `TimeoutError`) appears in a suggested test | far, dependency failure (no on-point value) |
| H6 | length 32 accepted **and** 33 throws (one pair) | both 32 and 33 (or `MAX_LEN` and `MAX_LEN + 1`) | **far, on-point** (string length limit) |
| H7 | `(page + 1) * size == total` → False | an exact-multiple total with the final page | **far, on-point** (pagination off-by-one) |
| H8 (optional) | `v == MinVersion` → true | a test at exactly `v2.3.0` | **far, on-point** (version comparison) |
| N1 | none (negative control) | — | — |

**Where the generalization evidence comes from.** v2's actual change is the
per-comparison on-point rule, so evidence that it generalizes must come from
the far-transfer on-point fixtures **H6 and H7** (H8 if used). H1, H2 and H4
are near transfer and disclosed as such. H3 and H5 exercise the error-path
bullet, where v1 is already at ceiling (part (a) met in 9/9 #501 reviews):
they have little headroom and serve mainly as a check that v2 does not get
worse there, not as evidence of v2's change.

## Required before sealing

- **Exact text.** Every fixture needs its exact code and test, line anchors
  for each target, and frozen per-fixture rule text.
- **N1 written exactly.** Code plus asserting tests for `0`,
  `MAX_ATTEMPTS-1`, `MAX_ATTEMPTS` and `MAX_ATTEMPTS+1`. Pre-classify `NaN`,
  `Infinity`, `-0.5` and a non-number as either tested or out of scope.
  Note the possible jump between `BASE * 2 ** (MAX_ATTEMPTS-1)` and
  `MAX_DELAY`, and decide whether a finding about it is a true or a false
  positive. A **false positive** on N1 is a finding that requests a test for
  an input class already exercised by an asserting test.
- **Language support.** Confirm that the grounding gate and the reviewer
  prompt work for Python, Go and Java patches before any of those fixtures is
  used.
- **Independence.** The fixtures must be authored and sealed by someone who
  has not seen the v2 text, and their sha256 committed before the Skill body
  is frozen.

## Suggested metrics (all pre-registered)

- Per fixture, the detection rate of each ground-truth test for the revised
  Skill, Skill v1 and no Skill.
- The false-positive count on N1.
- The total number of findings, to monitor noise.
- Blinded, sealed adjudication as in v5. Fixture #501 is reported separately
  as non-blind.

The fixtures should be finalized and sealed by someone other than the
Skill's author before any run (see the [review record](17-18-21-review-record.md)).

## Prospective evaluation template (shared by #17 and #18)

This template applies to the #17 v2 study here and to the #18 v2 study
([18-skill-v2-final-proposal.md](18-skill-v2-final-proposal.md)).

- **Development fixture.** #501 (#17) or #502 (#18) is reported only as a
  non-blind secondary result.
- **Fixtures.** At least 5 held-out positive fixtures and at least 1
  negative control, authored and sealed independently of the Skill text.
- **Blinding.** Redaction r2 adds "on-point" and "off-point" to the
  redaction list.
- **Primary endpoint(s), per review,** under a pre-declared field set:
  - **#17: two co-primary endpoints** on the fixture's primary target,
    *explicit* (named in title + rationale) and *implicit* (the value or
    triggering input defined per fixture in
    [Primary target per fixture](#primary-target-per-fixture) appears
    anywhere in a finding, including `suggestion`). Co-primary because v2's
    reporting instruction echoes the scoring rule and targets title +
    rationale: explicit alone could improve through format only (see
    [17-skill-v2-proposal.md](17-skill-v2-proposal.md#rule-echo-and-gaming-risk)).
  - **#18: one primary endpoint,** the frozen per-fixture rule applied to
    title + rationale only; `suggestion` is not scored. Adjudicators credit
    the mechanism, not keywords.
- **Secondary endpoints:** the other targets; finding count; false
  positives on the negative control.
- **Confirmatory test(s):** v2 vs no Skill, stratified by fixture, or by stratum for #18 (exact
  Cochran-Mantel-Haenszel or a permutation test), one-sided, α = 0.05. For
  #17 the two co-primary tests are each run at α = 0.05 and **both** must be
  significant (an intersection-union test; no Holm correction is needed for
  that pair). Everything else (v1, v2-min, per-fixture tests) is
  exploratory with Holm correction.
- **Decision rule.** "v2 helps" only if all of these hold:
  - the confirmatory test (for #17: both co-primary tests) is significant;
  - the pooled difference in primary detection is ≥ 0.25 (for #17, on both
    endpoints);
  - the direction is non-negative in ≥ 80 % of positive strata, including
    a quorum of strata outside the development fixture's construct: for
    #17, both far-transfer on-point fixtures (H6, H7); for #18, see
    [its fixture list](18-skill-v2-final-proposal.md#b-held-out-evaluation-fixtures-paid-only-under-a-new-owner-authorized-pre-registration);
  - negative-control false positives are not worse than no Skill by more
    than 1 finding per review;
  - the median finding count rises by ≤ 3.
- **Sample size** (one-sided Fisher, α = 0.05, power). This is an
  unstratified, pooled Fisher calculation that assumes homogeneous rates
  across fixtures; the confirmatory test is a stratified CMH, and the #17
  co-primary requirement costs further power, so choose n from the 25 or 30
  row:

  | n per arm | 0.75 vs 0.25 | 0.60 vs 0.25 |
  | --- | --- | --- |
  | 15 | 0.80 | 0.47 |
  | 25 | 0.97 | 0.76 |
  | 30 | 0.99 | 0.81 |

- **Throughput.** With at least 5 observed reviews per fixture per arm (so
  that each fixture's direction check is not pure noise), #17's 7 mandatory
  positives plus N1 need about 80 observed reviews, or about 320 attempts at
  v5's 25 % per-attempt completion. Throughput, not money, is the
  constraint (about $0.03 model cost).
- **429s.** Treating them as condition-independent missing data is an
  **assumption**, not a fact: in v5, 429s removed 1/5 *with* slots and 4/5
  *without* slots, by schedule position. Pre-register:
  - bounded re-attempts per slot;
  - arm order interleaved and randomized within blocks, inside each
    fixture;
  - 429s and missing slots reported per arm and per fixture, with a
    sensitivity note if they are unbalanced.

**What this does not do.** It does **not** satisfy the frozen #501/#502
single-fixture rules. Whether the rubric rows accept a held-out,
pre-registered study, and a pooled criterion, are mentor questions. Until
they are answered, #17 and #18 stay **Implemented**.
