# Homework 2 — status of the 53 criteria (2026-10-19)

> **Superseded in part, 2026-10-19:** the unpaid walkthrough has since run. See the [walkthrough log](HW2-walkthrough-log.md) and the [matrix](HW2-compliance-matrix.md): 48 rows Verified (row 32 failed, was fixed in PR #25, and passed its retest), row 36 partial, and rows 17–20 pending. The rest of this report is the earlier snapshot.

A snapshot taken after PR #22 merged (`6927930`). Statuses and evidence are kept
in the [compliance matrix](HW2-compliance-matrix.md), and the walkthrough steps
in the [acceptance checklist](HW2-acceptance-checklist.md). This report adds,
for each criterion, what remains before it can be marked **Verified**, and which
step unlocks it.

## Summary

- **Implementation:** all seven remediation PRs are merged (#16–#22). CI on
  `main` at `6927930` is green in all six workflows.
- **Verified: 0 of 53.** Homework 2 is not yet a Pass. A criterion becomes
  Verified only when its walkthrough step or experiment has been run and
  recorded.
- **Matrix statuses:**

  | Status | Count | Criteria |
  | --- | --- | --- |
  | Implemented | 26 | listed per PR in the matrix |
  | Pass (static) | 24 | |
  | Partial | 1 | 16 |
  | No evidence | 2 | 17, 18 |

- **Pre-checks on `main`, 2026-10-19.** These are read-only and do not count as
  Verified:
  - `node scripts/verify-agent-instructions.mjs` passes;
  - the five `CLAUDE.md` files are Git mode 120000 → `AGENTS.md`;
  - `pr-self-review` has `metadata.type: workflow` and the router tests pass
    10/10;
  - both architecture skills have the required sections;
  - `TOP_CODE_SAMPLES = 12`, and the extraction schema has the rule, evidence
    path and line, and confidence;
  - the four API Contract skill files exist.

## What unlocks the rest

| Route | Criteria | Count | Paid | Unlocked by |
| --- | --- | --- | --- | --- |
| Repo / CLI review | 1, 2, 3, 4, 5, 21, 39, 40 | 8 | no | walkthrough (Gate 5) |
| Hermetic flows, plus a look in the browser | 6, 7, 9, 10, 11, 22, 23, 24, 25, 27, 32, 34, 37, 44, 45, 53 | 16 | no | walkthrough |
| Manual browser and SQL on the unpaid walkthrough stack | 8, 12, 13, 14, 15, 16, 26, 28, 29, 30, 31, 33, 35, 36, 41, 42, 43, 46, 47, 48, 49, 50, 51, 52 | 24 | no | walkthrough |
| Evidence review, no live run (decided) | 38 | 1 | no | walkthrough |
| A completed with-skill experiment trace | 19, 20 | 2 | uses a Gate 4 run | Gate 4, then the walkthrough |
| Controlled experiments | 17, 18 | 2 | yes | Gates 2 → 3 → 4 |

Rows 24 and 34 also need a manual Confirm, which is a write path. Rows 13 and
31 need a person dragging with a real mouse. The physical-drag rule and the
synthetic Conventions candidates are explained in the acceptance checklist.

## Per criterion

| # | Criterion | Status | PR | Still needed for Verified | Route |
| --- | --- | --- | --- | --- | --- |
| 1 | `AGENTS.md` at the root, `CLAUDE.md` symlink | Implemented | #16 | record `git ls-files -s CLAUDE.md` (pre-check passed) | Repo |
| 2 | Same in `server/`, `client/`, `reviewer-core/` | Implemented | #16 | the same for each package (pre-check passed) | Repo |
| 3 | UI architecture skill | Implemented | #16 | read the placement and naming sections | Repo |
| 4 | Onion architecture skill | Implemented | #16 | read the boundaries and the routes-never-call-adapters example | Repo |
| 5 | `pr-self-review`, type Workflow | Implemented | #16 | record `metadata.type: workflow` (pre-check passed) | Repo |
| 6 | Agents in SKILLS LAB | Implemented | #17 | flow 11, then a look at the sidebar | Flow |
| 7 | Agents page shows cards | Pass (static) | — | flow 03, then a look | Flow |
| 8 | Skills CRUD reads and writes PostgreSQL | Pass (static) | — | create in the UI → SQL row; delete → row gone | Manual + SQL |
| 9 | Skills card grid | Implemented | #17 | flow 11, then a look | Flow |
| 10 | Card click opens a side preview | Implemented | #17 | flow 11, then a click | Flow |
| 11 | Add → Create (modal) and Import | Implemented | #17 | flow 11 | Flow |
| 12 | Create Skill modal with a Markdown body | Implemented | #17 | create a skill with a Markdown body | Manual |
| 13 | Agent Skills tab: link, enable, drag | Implemented | #19 | link and unlink; **physical drag** survives a reload | Manual (person) |
| 14 | Drag order = prompt order | Pass (static) | — | SQL order after the drag; trace order is an **open decision** | Manual + SQL |
| 15 | Import `.md` with a preview | Pass (static) | — | import a `.md`; the body shows before saving | Manual |
| 16 | An imported skill linked to the new agent | Partial | #18, #21 | the mandatory `deprecation-policy` import → 4 / 4; SQL `imported_file` | Manual + SQL |
| 17 | Experiment: Test Quality | No evidence | #21, #22 | Gates 2–4, then the experiment report | Experiment |
| 18 | Experiment: API Contract | No evidence | #21, #22 | Gates 2–4, then the experiment report | Experiment |
| 19 | Trace Skills block with a token count | Implemented | #19 | a with-skill Gate 4 trace shows `~N tokens`, opened before the stack stops | Gate 4 trace |
| 20 | Enabled skill is a block; a disabled one is not | Pass (static) | — | the enabled half from the Gate 4 traces; the disabled half is an **open decision** | Gate 4 trace |
| 21 | Manual `pr-self-review`, no push hook | Implemented | #16 | headless-run evidence is already in the matrix; accept it | Repo |
| 22 | Card shows version and agent count | Implemented | #17 | flow 11 | Flow |
| 23 | Delete button on the card | Implemented | #17 | flow 11 | Flow |
| 24 | Skill delete modal | Implemented | #17 | flow 11 (Cancel, X), plus a manual Confirm | Flow + manual |
| 25 | Detail tabs incl. Versioning | Implemented | #18 | flow 11 | Flow |
| 26 | Preview renders Markdown | Pass (static) | — | look at the Preview tab | Manual |
| 27 | Versioning lists every version | Pass (static) | — | flow 11 | Flow |
| 28 | Diff per version | Implemented | #18 | edit twice, then Diff an older version | Manual |
| 29 | Restore per version | Implemented | #18 | Restore → new version; reload; SQL history | Manual + SQL |
| 30 | Filter in the agent Skills tab | Pass (static) | — | filter the list | Manual |
| 31 | Only enabled skills drag | Implemented | #19 | a disabled skill cannot be dragged (physical) | Manual (person) |
| 32 | Agent card fields | Pass (static) | — | flow 03, then a look at every field | Flow |
| 33 | Agent Delete removes the row | Pass (static) | — | delete a throwaway agent → SQL count 0 | Manual + SQL |
| 34 | Agent delete modal | Implemented | #17 | flow 11 (Cancel, X), plus a manual Confirm | Flow + manual |
| 35 | Exactly the Config and Skills tabs | Pass (static) | — | look at the agent editor | Manual |
| 36 | Agent Config fields | Pass (static) | — | look at the Config tab: the model list and strategy | Manual |
| 37 | Skills tab: toggle and category per skill | Pass (static) | — | flow 12 | Flow |
| 38 | Extraction runs and persists | Pass (static) | — | decided: `conventions.it.test.ts` and the 2026-10-14 smoke test; no live extraction is claimed | Evidence review |
| 39 | Samples chosen without an LLM | Pass (static) | — | record `CONFIG_SAMPLE_PATHS` and `TOP_CODE_SAMPLES = 12` (pre-check passed) | Repo |
| 40 | Candidate output fields | Pass (static) | — | record the `ExtractionSchema` fields (pre-check passed) | Repo |
| 41 | Create-skill modal edits body and metadata | Pass (static) | — | edit them in the Conventions modal | Manual |
| 42 | `repo-conventions`, linked to an agent | Implemented | #20 | create it linked to the General Reviewer; SQL link row | Manual + SQL |
| 43 | Four API Contract skills | Implemented | #21 | review the four docs; three are seeded, and the fourth row comes from the row 16 import | Manual |
| 44 | Conventions in SKILLS LAB | Implemented | #17 | flow 09 | Flow |
| 45 | Separate Run Scan and ReScan | Implemented | #20 | flow 09 | Flow |
| 46 | Candidate card fields | Pass (static) | — | look at a synthetic candidate card | Manual |
| 47 | Accept, Reject, Edit | Pass (static) | — | use each on a synthetic candidate | Manual |
| 48 | Rejection persists and is excluded | Pass (static) | — | reject → reload → SQL `rejected`; the banner counts only accepted ones | Manual + SQL |
| 49 | Inline Edit | Pass (static) | — | edit a card inline | Manual |
| 50 | Create skill appears after an Accept | Implemented | #20 | accept a synthetic candidate → the button appears | Manual |
| 51 | Create-skill modal explains its source | Pass (static) | — | the banner, Name, Description, Cancel, Create | Manual |
| 52 | The new skill appears on the Skills page | Pass (static) | — | after Create (row 12 or 42) the card is in the grid | Manual |
| 53 | Settings → Models → Conventions dropdown | Pass (static) | — | flow 07 | Flow |

## Decisions and risks for you

1. **Gates 2 → 3 → 4** unlock rows 17 and 18, plus row 19 and the enabled half
   of row 20. The Gate 2 steps are in the [Gate 2 checklist](HW2-gate2-checklist.md).
   Gate 4 follows the preregistration commit. Each gate needs its own
   authorization.
2. **Open decision for rows 14 and 20.** No planned trace shows several ordered
   skills or a linked, disabled skill. The recommendation (option A in the
   checklist) is to accept `skills-prompt.it.test.ts` for the prompt side.
3. **Proposed sequencing,** which needs your authorization. The unpaid
   walkthrough covers 49 rows: everything except 17–20. It does not depend on
   Gates 2–4 and can run first, on a keyless walkthrough stack. Rows 19 and 20
   are then checked on the Gate 4 stack before it stops.
4. **Residual risks, as recorded in the matrix:**
   - row 22: a grader who expects a literal `agent_count` field would need a
     compatible alias;
   - row 38: a grader who insists on a live extraction would need a paid call,
     authorized separately;
   - row 45: a zero-candidate scan is not persisted, so Run Scan is available
     again after a reload.
