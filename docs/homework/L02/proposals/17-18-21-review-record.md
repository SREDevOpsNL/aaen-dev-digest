# Review record: #17, #18 and #21 proposal drafts

2026-11-03. Two independent read-only reviews of the **uncommitted drafts**
in this folder, followed by a documentation correction pass (Agent F). A
re-review of the corrected drafts follows; this record will be appended to,
not rewritten.

Reviewers:
- **Agent D**: methodology (study design, statistics, scoring validity).
- **Agent E**: security, architecture and acceptance.

Resolution codes: **fixed** (file named) · **limitation** (accepted and
disclosed) · **mentor** (left as a mentor question) · **owner** (owner
decision) · **none** (informational, no change needed).

Severity is as each reviewer assigned it (info, low, minor, medium, major);
the reviewers' own reports are authoritative.

## Agent D (methodology)

| # | Severity | Finding (one line) | Resolution |
|---|---|---|---|
| D1 | info | Most of Agent A's headline numbers reproduce exactly (part (a)/(b) counts, Fisher values, intervals, Beta-binomial 3.4 %) | none |
| D2 | major | "72 system-role findings" is wrong; the per-review counts sum to 63 | fixed: [analysis](17-skill-effectiveness-analysis.md), [v2 proposal](17-skill-v2-proposal.md) |
| D3 | major | The on-point instant appears in a finding's suggestion/rationale in 5/5 *with* vs 2/4 *without*; root cause 1 is an explicitness/reporting gap | fixed: [analysis](17-skill-effectiveness-analysis.md) (new section, root cause 1 restated, exploratory p = 0.167, official verdicts unchanged) |
| D4 | minor | Lenient re-scores were stated imprecisely | fixed: [analysis](17-skill-effectiveness-analysis.md) (2/5 vs 1/4; with bare `>=` 4/5 vs 2/4, still fails) |
| D5 | minor | v1 body is 197 characters, not 205; "five … stop there" overstated | fixed: [analysis](17-skill-effectiveness-analysis.md), [v2 proposal](17-skill-v2-proposal.md) (size ratio 4.7×) |
| D6 | minor | Pooled cross-study contrasts and their Fisher p were presented as if confirmatory | fixed: [analysis](17-skill-effectiveness-analysis.md) ("Pooling caveat") |
| D7 | major | "Part (b) was not affected by the Skill" overclaims; formal study status missing from the Bottom line | fixed: [analysis](17-skill-effectiveness-analysis.md) |
| D8 | major | "Independently reviewed" must link a review record | fixed: this file, linked from the [analysis](17-skill-effectiveness-analysis.md) |
| D9 | major | v2's "report … as its own finding" echoes the #17 scoring rule (gaming risk) | fixed: [v2 proposal](17-skill-v2-proposal.md) ("Rule echo and gaming risk"); limitation disclosed |
| D10 | minor | v2-min must not be a second confirmatory contrast | fixed: [v2 proposal](17-skill-v2-proposal.md) (exploratory, Holm, or dropped) |
| D11 | major | Held-out fixtures need one primary target each, near-transfer disclosure, an exact N1, sealing rules | fixed: [held-out fixtures](17-heldout-fixtures.md) |
| D12 | major | No prospective evaluation design (endpoints, test, decision rule, sample size, 429 handling) | fixed: [held-out fixtures](17-heldout-fixtures.md#prospective-evaluation-template-shared-by-17-and-18); acceptance of such a study is **mentor** |
| D13 | info | The 3.4 % pass chance is conditional on a complete run | fixed: [analysis](17-skill-effectiveness-analysis.md) |
| D14 | major | #18 v2's new positive item and "Not a finding" bullet echo the frozen #18 rule in both directions | limitation (primary) in the [final proposal](18-skill-v2-final-proposal.md#known-limitations); alternative phrasing offered, not applied (hashed body); rule re-wording is **owner** |
| D15 | major | H2 and H2b are near transfer (same construct as #502) | fixed: [final proposal](18-skill-v2-final-proposal.md) |
| D16 | major | #18 pass criterion was v2-only | fixed: [final proposal](18-skill-v2-final-proposal.md) (shared template, v2 vs no Skill) |
| D17 | minor | SUGGESTION vs WARNING for an SDK-only rename not justified; H1b WARNING scoring undefined | fixed: [final proposal](18-skill-v2-final-proposal.md); the severity itself is **owner** |
| D18 | info | The #18 rule (excluding a rename-only claim) is defensible; it was tightened after Phase 1 and the frozen ground truth's `pay_123` example should be fixed in a new frozen-text version | none; the ground-truth wording is **owner** |
| D19 | minor | Broken references in the #18 drafts (`review-18.md`, `skill-v2-18-final-proposal.md`, standalone copies) | fixed: [review](18-skill-v2-review.md), [final proposal](18-skill-v2-final-proposal.md) |
| D20 | major | #21 grep-based counting also matches skill text and user words | fixed: [ingestion checklist](21-ingestion-checklist.md) (jsonl parse) |
| D21 | major | Q5 can be removed by re-pointing the scratch checkout at the submitted PR head | **owner**: step written, not executed, in [owner instructions](21-owner-instructions.md#recommended-pre-run-step-owner-decision-not-executed) |
| D22 | minor | "Any of the three verdicts is fine" pre-judges Q4; Q1 needs a `Skill`-tool sub-case | fixed: [owner instructions](21-owner-instructions.md), [ingestion checklist](21-ingestion-checklist.md), [readiness](21-readiness.md); Q1/Q4 stay **mentor** |
| D23 | info | A desktop-app worktree could silently drop the diff; the checklist's cwd, dirty-state and base/head checks catch it; the minimum evidence listed is correct | none |
| D24 | minor | #21 drafts cite artifacts "in this folder" that are not here | fixed: [readiness](21-readiness.md), [ingestion checklist](21-ingestion-checklist.md) (summary inlined; preparation note linked) |
| D25 | minor | Cross-cutting: A's count error, incompatible #17/#18 evaluation designs, and different branch names across drafts | fixed by D2, D12/D16 (one shared template) and D21 (branch facts in [readiness](21-readiness.md)) |

## Agent E (security, architecture, acceptance)

| # | Severity | Finding (one line) | Resolution |
|---|---|---|---|
| E1 | low | Seeding described as `onConflictDoNothing`; the skill row is select-then-insert by name, only `skill_versions` uses it | fixed: [review](18-skill-v2-review.md), [final proposal](18-skill-v2-final-proposal.md), [v2 proposal](17-skill-v2-proposal.md) |
| E2 | low | Held-out fixtures do not say that a run needs a new pre-registration and owner spending authorization | fixed: [held-out fixtures](17-heldout-fixtures.md) |
| E3 | info | "Cannot push" overstated: an explicit refspec push still works from a detached HEAD | fixed: [readiness](21-readiness.md), [owner instructions](21-owner-instructions.md) (owner must deny any push) |
| E4 | low | Broken links and missing artifacts (same set as D19/D24) | fixed with D19 and D24 |
| E5 | info | Proposed digests: both recomputed by the coordinator with the repository's `skillBodySha256` over the trimmed body: #17 v2 `7b41e38b…`, #18 v2 `412b92e2…`; the v1 digests equal the allowlist | none |

## Re-review (round 2)

Both reviewers re-read the corrected drafts; a second correction pass
(Agent F, with coordinator edits to the #21 files) followed.

### Agent D (methodology)

Verdict summary:
- **Resolved:** all 25 round-1 findings were resolved, or correctly recorded
  as a limitation, owner decision or mentor question.
- **Partly closed:** D3, D11, D12, D16 and D20 were only partly closed; their
  remainders are N1–N8 below.
- **Rechecked numbers:** 63 findings; lenient re-scores 2/5 vs 1/4 and 4/5 vs
  2/4; 197 characters; 4.7×; on-point instant anywhere 5/5 vs 2/4 (Fisher
  p = 0.167); explicit naming 1/5 vs 1/4; all links resolve.
- **Verdicts per criterion:**
  - #17: the analysis is accurate after N1/N2, and the evaluation design is
    sound after N3/N4.
  - #18: handled after N7.
  - #21: ready for the owner run after N8(a) and the section E fix.

  Statuses are unchanged.

| # | Severity | Finding (one line) | Resolution |
|---|---|---|---|
| N1 | minor | "That mapping is exactly where the reviews fail" contradicts the suggestion-field data | fixed: [analysis](17-skill-effectiveness-analysis.md) ("the missing step is explicitly reporting that test as its own boundary") |
| N2 | minor | "Especially with the Skill" states an exploratory difference as fact | fixed: [analysis](17-skill-effectiveness-analysis.md) ("5/5 vs 2/4, exploratory, not significant") |
| N3 | major | Explicit-only primary endpoint is gameable by the echo instruction; implicit endpoint undefined per fixture | fixed: explicit and implicit are co-primary, Holm-corrected, both must improve, defined per fixture (H3/H5: triggering input in a suggested test): [v2 proposal](17-skill-v2-proposal.md), [held-out fixtures](17-heldout-fixtures.md) |
| N4 | major | Far-transfer evidence did not exercise v2's actual change (on-point rule); H3/H5 are at ceiling | fixed: far-transfer on-point fixtures H6 (string length), H7 (pagination off-by-one), H8 optional (version comparison); ceiling risk stated; generalization sentence rewritten: [held-out fixtures](17-heldout-fixtures.md) |
| N5 | minor | Fixture tables read as final | fixed: marked illustrative in [held-out fixtures](17-heldout-fixtures.md) and the [#18 final proposal](18-skill-v2-final-proposal.md) |
| N6 | minor | 429 condition-independence is an assumption; power table is unstratified; #18 field set undeclared | fixed: [held-out fixtures](17-heldout-fixtures.md) template (assumption stated with v5's 1/5 vs 4/5, per-arm 429 reporting, randomized interleaving, power caveat, #18 field set = title + rationale); [#18 final proposal](18-skill-v2-final-proposal.md) |
| N7 | minor | #18 had only four mandatory positives, two of them #502's construct | fixed: H6 mandatory, H7 added (newly required field), H2+H2b one stratum, quorum ≥ 3 of 4 non-#502 strata: [#18 final proposal](18-skill-v2-final-proposal.md) |
| N8 | minor | #21 parser counted denied calls, Reads outside the cwd, pre-command calls, and ignored subagents | fixed: [ingestion checklist](21-ingestion-checklist.md) (successful `tool_result` required, cwd prefix, start at the `/pr-self-review` turn, sidechain and `subagents/` scan; tested on a local and a synthetic transcript) |
| N9 | info | The #21 pre-run step is sound: it uses the local PR branch, confirms the pushed head, drops and re-adds the markers; lockfiles are unchanged between `21c8f09` and `7b066cb`, so no install is triggered | none |

Also fixed in this round: the D11 residue (the status line no longer says
no fixture involves expiry dates; H2 is a disclosed deadline construct) and
the D21 residue (the pre-run step *reduces* Q5, since a later docs or
evidence commit makes the run's commit an ancestor again; section E of the
checklist names `21c8f09` or `$H`).

### Agent E (security re-review)

E1–E4 resolved; E5 accepted.

| # | Severity | Finding (one line) | Resolution |
|---|---|---|---|
| S1 | medium | The #21 pre-run snippet was unguarded | fixed by the coordinator: guarded subshell with `set -eu`, toplevel check, two-marker status check; tested read-only against the real checkout, and an empty `S` is refused ([owner instructions](21-owner-instructions.md)) |
| S2 | low | Substring match for push/commit | fixed by the coordinator with a regex, tested ([ingestion checklist](21-ingestion-checklist.md)) |
| S3 | info | Install wording did not say the owner runs it | fixed ([owner instructions](21-owner-instructions.md)) |
| S4 | info | No command compared the local head with the pushed head | fixed with an `ls-remote` equality guard ([owner instructions](21-owner-instructions.md)) |

## Final check (round 3)

Agent D re-checked round 2. N1–N8 and the D11/D21 residues are resolved;
the remaining items were fixed by the coordinator:

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| R1 | major | Illustrative H7's own test (page 9 of 100, size 10) already exercises its primary target, so H7 had nothing to detect | fixed: the test now uses 95 items (no exact multiple) in [held-out fixtures](17-heldout-fixtures.md) |
| R2 | minor | The parser checks Reads against the session's own `cwd`, never that this cwd is the scratch checkout | fixed: it now counts assistant entries whose cwd is not the scratch path; expected 0 ([ingestion checklist](21-ingestion-checklist.md)). Tested: 1,890 on a non-scratch session, 1 on the synthetic case |
| R3 | minor | Throughput not updated for the larger fixture set | fixed: ≥ 5 observed reviews per fixture per arm, about 80 reviews / 320 attempts |
| R4 | info | Holm on top of "both co-primary tests significant" is redundant | fixed: each at α = 0.05, both required (intersection-union) |
| R5 | info | #18 should say "stratified by stratum" | fixed in the [final proposal](18-skill-v2-final-proposal.md) |
| — | leftover | `17-skill-v2-proposal.md` still said "explicit (primary) and implicit (secondary)" under required approvals | fixed: "co-primary" |

## Still open after this pass

- Mentor: whether the rubric rows accept a held-out pre-registered study and
  a pooled criterion (#17, #18); #21 Q1 (with its `Skill`-tool sub-case)
  through Q5.
- Owner: #18 SDK-rename severity; whether to re-phrase #18 v2's positive
  item (changes the sha); whether to take the #21 pre-run step; any spending.
- #17 and #18 stay **Implemented**; #21 stays **Blocked**.
