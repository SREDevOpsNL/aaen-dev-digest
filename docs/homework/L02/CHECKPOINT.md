# L02 execution checkpoint - 2026-10-28

This is a recovery index, not a substitute for the evidence linked from
[ACCEPTANCE.md](ACCEPTANCE.md). On resumption, verify Git, PR #53, the global
private ledger and actual runtime before acting.

- Source before this unpaid checkpoint: `e79ae2b59c14cc237b6c702828dc9b06c6485f32`.
  PR #53 is Draft against `codex/l01-severity-filters`; required merge-base:
  `5a3b49643e9ffedd0477e786c944925cad2a93cd`.
- Acceptance: 49 Verified; #17 and #18 Implemented without a valid controlled
  comparison; #14 and #21 Blocked. Do not infer a different count from tests.
- The single authorized conventions extraction is complete. Criteria #38 and
  #40 are Verified by [live evidence](evidence/conventions-live-extraction.md).
  Its capability was revoked. Never rerun that slot.
- Historical conservative ledger after extraction: $0.01381699; no unresolved
  slot at the last settlement. Recheck privately before any new authorization.
  No confirmatory spending is authorized.
- This checkpoint adds executable fixture-ground-truth checks and a prospective
  condition-blinded adjudication procedure. It does not change fixtures, Skills,
  prompt roles or the Phase 1 outcomes.
- #14: literal system-role wording needs mentor clarification. Approach A keeps
  Skill bodies in the user message; #19 and #20 retain their trace evidence.
- #21: the preserved scratch mixed client/server diff routes to both Skill sets.
  Prior Claude Code run stopped on expired OAuth. Human action: restore supported
  Claude Code login/usage and run `/pr-self-review --base HEAD` there, recording
  the real transcript. Codex cannot substitute for it.
- #17/#18: resolve #14, freeze a complete preregistration and obtain a separate
  exact spending approval before any confirmatory request. The 20-call budget
  and outcome rules are in [PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md).
- Preserve the evidence stack, L01 baseline, L03 exclusion and Draft PR. Do not
  merge main, reset protected worktrees or repeat the paid extraction.

Local verification completed: server typecheck, 369 unit and 140 DB-backed
tests; reviewer-core typecheck and 102 tests; client lint, typecheck and
118 tests; E2E typecheck and 14/14 hermetic flows on an isolated stack.
All six GitHub Actions workflows passed at `4d82c6f`. The previous
full local matrix at `17241a3` and subsequent CI are in
[TEST-RESULTS.md](TEST-RESULTS.md).

## Resumption check and adjudication tooling - 2026-10-30

- Verified from Git and GitHub before any change: PR #53 Draft at
  `4d82c6f42693aa060a3c9f9b9a3950f2453098de` against
  `codex/l01-severity-filters`, merge-base `5a3b496`, all six workflows green;
  the private rubric still has the recorded SHA-256.
- Private ledger re-read (read-only): $0.00381699 confirmed plus $0.01 held
  for the failed `x-17-without-1` slot, **$0.01381699 conservative**, no
  `reserved` or `dispatched` slot left; the last authorization event is the
  extraction capability's revocation, and the last key-usage settlement
  passed. Two raw `capability.token` files remain in the sealed Gate 3
  closure directories of stacks whose containers were removed on
  2026-10-21/22; no API runs for those stacks, so they are inert, and they
  were left untouched.
- The WSL host restarted at 14:20 on 2026-10-30. Only the dev
  `devdigest-postgres` container is running; the earlier evidence stack's
  processes and tmux sessions are gone. Recorded evidence is unaffected.
- The condition-blinded adjudication procedure now has an implementation and
  a synthetic dry run ([PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md#condition-blinded-technical-adjudication),
  [TEST-RESULTS.md](TEST-RESULTS.md#unpaid-adjudication-checkpoint-2026-10-30)).
  It scores no real slot. The acceptance count is unchanged: 49 Verified,
  #17 and #18 Implemented, #14 and #21 Blocked.
- #21: Claude Code is available again through the desktop app. The owner
  can open a session directly in the scratch checkout and type
  `/pr-self-review --base HEAD`; see
  [criterion-21-preparation.md](evidence/criterion-21-preparation.md).

## Criterion 14 resolved; study frozen for approval - 2026-10-30

- Mentor ruling: criterion 14 needs the literal system-role message plus a
  trust step for editable Skills. Implemented in `23d0b48`; see
  [ARCHITECTURE.md](ARCHITECTURE.md#prompt-assembly-and-the-run-trace) and
  [criterion-14-system-role.md](evidence/criterion-14-system-role.md).
- Acceptance: **49 Verified**; #14, #17, #18 Implemented; #21 Blocked. #14
  needs one authorized trace-only run to show a system-role trace (item A of
  the [approval packet](PROSPECTIVE-STUDY.md#approval-packet-2026-10-30)).
- #21: this session cannot run it. The standalone WSL CLI reports
  `loggedIn: false`; `pr-self-review` is user-only
  (`disable-model-invocation`), so only the owner can type it in a Claude Code
  session rooted at the scratch checkout.
- Persistent keyless freeze stack `hw2f-1fe1aeec` runs in tmux session
  `hw2-freeze`; the frozen manifest names its database. Its API Contract
  Reviewer links are arranged for trace slot A (semver-discipline,
  breaking-change, response-schema off).
- Ledger unchanged at $0.01381699 conservative (21 records); key usage
  $0.00422487 of $2.00. No capability issued.

## Item A executed; item B needs a re-freeze - 2026-10-31

- Owner approved item A only. Trace-only slot `x-18-with-3` completed
  ($0.00022779), capability revoked, settlement PASS. #14 → **Verified**;
  #19/#20 refreshed with the live system-role trace. Acceptance: **50
  Verified**, #17/#18 Implemented, #21 Blocked.
- A host restart (11:03) destroyed `hw2f-1fe1aeec` and its tmux session.
  The rebuilt keyless stack is `hw2f-cc928441`, in tmux session
  `hw2-freeze`. `manifest-20261030.json` names the destroyed database, so
  item B needs the candidate re-freeze `prereg/manifest-20261031.json` and a
  new explicit approval.
- Ledger: 24 records, $0.01404478 conservative; key usage $0.00445266 of
  $2.00. No live capability.
- #21 unchanged: the owner must type `/pr-self-review --base HEAD` in a
  Code-tab session rooted at `aaen-dev-digest-l02-self-review`.

## Item B authorized, halted before any capability - 2026-10-31

The owner authorized item B against `prereg/manifest-20261031.json` (sha256
`306fb0c9…`). The pre-dispatch verification passed for the source
(`964a4a2`, implementation fingerprint `201ffa9a…`), the prereg hash, the stack
and database identity, and all four request fingerprints (they equal the
packet). The ledger had no `c-*` slot and no live capability. Two bindings
failed, so **no capability was issued and no request was sent**:

1. The runner's `--prereg` reader refuses the approved file: it needs a
   committed file with a `json manifest` fenced block, and the freeze was
   written as bare JSON.
2. The manifest recomputed on the same stack has fingerprint `53fe5f20…`, not
   `286d9db4…`. The only difference is the order of the two reviewers in
   `agents`: `/agents` is unordered, and item A's link edits moved a row.

Under the approval's terms neither file nor stack was substituted. Item B
needs a corrected freeze and a fresh approval.

## Item B corrected and re-frozen (v3), awaiting decision - 2026-10-31

- The owner approved Option 1. The implementation is `2799caf`: deterministic
  manifest v3, a `.json` pre-registration reader and fail-closed confirmatory
  `authorize`. Details and tests:
  [item-b-predispatch-halt.md](evidence/item-b-predispatch-halt.md). CI green
  on `2799caf`.
- Fresh stack `hw2f-19ef1f13` (tmux `hw2-freeze`); the old `hw2f-cc928441`
  is torn down. New freeze: `prereg/manifest-20261031-v3.json` (sha256
  `47c58433…`, manifest `2f13ad1c…`, implementation `fa59aa4c…`), read back
  by `prereg-check`. The packet is
  [approval packet v3](PROSPECTIVE-STUDY.md#approval-packet-v3-2026-10-31).
- No paid call, capability or dispatch. Ledger 24 records, $0.01404478
  conservative; key usage $0.00445266.

## 2026-10-31: item B v3 executed, incomplete

- Capability issued at 18:28:58Z and revoked at 18:36:34Z. 6 dispatches;
  stopped on a truncated *with* response. Settlement PASS.
- Ledger: 42 records, $0.0163864 conservative. Key usage $0.00679428 of
  $2.00.
- Sealed adjudication: #17 1/5 vs 0/5, #18 0/5 vs 0/5; both incomplete. #17
  and #18 stay Implemented. #21 is still Blocked on the owner's interactive
  run.
- Stack `hw2f-19ef1f13` is still up; tear it down after review.

## 2026-11-01: reliability and recovery pipeline (in progress)

- **PR #53:** Draft, remote head `0c41f33`, merge-base `5a3b496`. Integration
  is happening in the local branch `codex/l02-extraction-authorization` in
  `aaen-dev-digest-l02-extraction`. Push with
  `HEAD:homework/l02-mentor-submission`.
- **Workstreams and branches:**
  - **Trace repair** (`fix/l02-failed-run-trace`, worktree
    `aaen-dev-digest-l02-trace-fix`, `77d4b96..0634723`): integrated.
  - **Crash-test leak fix** (`fix/hw2-crash-test-leaks`, worktree
    `aaen-dev-digest-l02-proc-leak`, `413aca7`): integrated.
  - **Drawer status fix** (`fix/run-trace-drawer-status`, `e8119c9`,
    `f235c76`): reviewed (READY) and integrated, as the owner approved.
  - **v4 study harness** (`feat/hw2-study-v4-harness`, worktree
    `aaen-dev-digest-l02-study-v4`): in progress.
  - The idle `main`-based trace session (frosty-kepler) was left untouched,
    as the owner decided.
- **Teardown gate:** the trace-fix owner confirmed on 2026-11-01 that the
  private archive was sufficient and that no further live evidence was
  needed. The orphaned volume was then removed, and every other check
  matched the baseline; see the
  [teardown record](evidence/item-b-confirmatory/README.md#teardown-of-the-disposable-stack-2026-11-01).
- **Archive:** `~/.devdigest/hw2-experiments/itemb-v3-20261031/` (private,
  0700/0600, 51 hashes).
- **Spending:** none. Ledger $0.0163864 conservative, 42 records; no live
  capability.
- **Gates:**
  - #21 needs the owner to run `/pr-self-review --base HEAD`;
  - #18 Skill v2 needs the owner to review and approve a new seeded Skill body;
  - any successor study needs a spending approval.
- **Next executable action:** security and architecture review of the
  integrated change, then the v4 harness, the full matrix, push and CI, and
  the v4 freeze.

## 2026-11-01: reliability pipeline integrated and pushed

- **PR #53:** Draft. Code head `5f96fc1` (CI 7/7). The v4 pre-registration
  and the docs follow on the same branch. Merge-base `5a3b496`.
- **Integrated:**
  - the trace repair (B), with three review-fix rounds;
  - the crash-test leak fix and its env allowlist (C);
  - the drawer status fix (E's review: READY);
  - the v4 harness, with the router-metadata truncation rule (H).

  Full matrix and the security/architecture re-reviews are clean (see
  TEST-RESULTS).
- **Stacks:**
  - `hw2f-19ef1f13`'s orphaned volume was removed after the gate;
  - the first v4 attempt `hw2f-14625582` was torn down by its own Ctrl-C,
    because provider name and served model were not set;
  - `hw2f-5b00487b` is up in tmux `hw2-freeze-v4` and holds the v4 freeze.
- **Spending:** none. Ledger $0.0163864 conservative, key $0.00679428.
- **Gates:**
  - v4 spending (10 slots, $0.05, ceiling $0.0663864);
  - #18 Skill v2 body review;
  - #21 `/pr-self-review --base HEAD` by the owner.
- **Next executable action:** the acceptance audit of all 53 rows at the
  final head; the PR body; CI on the final head.

## 2026-11-01: pipeline complete

- **Acceptance audit.** An independent audit of all 53 rows at `253e96f`
  agrees with every status: 50 Verified, 2 Implemented (17, 18), 1 Blocked
  (21). It found 0 broken links and 0 missing evidence files. Its README
  finding is fixed in `6174935`.
- **Owner actions remaining:**
  1. Decide v4 spending: Gate 4, 10 slots, $0.005 each, $0.05 new
     reservations, ceiling $0.0663864, 3 h, no retries.
     - Recheck the bindings first.
     - The freeze stays valid only while stack `hw2f-5b00487b` (tmux
       `hw2-freeze-v4`) is up. A host restart destroys it and needs a free
       re-freeze.
  2. Review the #18 Skill v2 proposal.
  3. Run `/pr-self-review --base HEAD` interactively in
     `aaen-dev-digest-l02-self-review` (#21).
- **Worktrees from this pipeline, kept for audit:**
  - `aaen-dev-digest-l02-trace-fix` (`fix/l02-failed-run-trace`);
  - `aaen-dev-digest-l02-proc-leak` (`fix/hw2-crash-test-leaks`);
  - `aaen-dev-digest-l02-study-v4` (`feat/hw2-study-v4-harness`);
  - `aaen-dev-digest-l02-verify-final` (detached, runs the v4 stack).

## 2026-11-01: v4 study for #17 executed (owner-authorized)

- **Bindings.** All free binding checks matched before `authorize`: manifest
  sha256 and read-back, the plan and implementation fingerprints, both
  request fingerprints (the previews were byte-identical to the freeze),
  stack and database isolation, `deepinfra/fp8` live prices, the ledger (42
  records, no `c-v4` slot), the key ($0.00679428), and CI 7/7 at `788a606`.
- **Run.**
  - Capability: 20:02:25Z.
  - Slot 1 `c-v4-17-without-2` completed ($0.00035478).
  - Slot 2 `c-v4-17-with-2` got an upstream 429, which stopped the schedule.
  - Revoked 20:03:48Z. Settlement PASS: the 429 was not billed.
- **Adjudication.** Sealed and blinded, 1 case: no / no.
- **Outcome:** `incomplete`. #17 stays Implemented. Acceptance stays
  50/2/1.
- **Ledger** $0.02174118 conservative (48 records). **Key** $0.00714906.
- **Evidence:**
  - private: `itemb-v4-20261101/` (45 files, `SHA256SUMS` sha256
    `6f05ef01…`);
  - public: `evidence/item-b-v4-confirmatory/`.
- **Stack** `hw2f-5b00487b` is still up for read-only forensics. Tearing it
  down is the owner's decision.
- **Next owner decisions:**
  - whether to attempt #17 again (a new decision, and possibly a new
    pre-registration that treats an upstream-pool 429 differently);
  - the #18 Skill v2 review;
  - #21.

## 2026-11-02: v4 stack torn down (owner-authorized)

- **What happened.** A host restart (08:10Z) had already removed the `--rm`
  container `devdigest-hw2f-5b00487b`. Only its anonymous volume `6fe96158…`
  was left, and it was removed after the gate:
  - the 45 archive hashes pass;
  - a throwaway restore of the dump matches the exports;
  - no capability, open slot or late billing (key $0.00714906, unchanged);
  - no container references the volume.
- **Unchanged against the baseline:**
  - `devdigest-postgres`, `devdigest_pgdata` (12 runs);
  - the ledger, authorization and key-usage logs (48 / 17 / 6 lines);
  - both archives;
  - the five unidentified volumes.
- **Record:**
  [evidence/item-b-v4-confirmatory/README.md](evidence/item-b-v4-confirmatory/README.md#teardown-2026-11-02).
- **No disposable HW2 stack is running.** #17 stays Implemented (v4
  incomplete); acceptance stays 50/2/1.
- **Owner actions still open:**
  - any further #17 decision;
  - the #18 Skill v2 review;
  - #21.

## 2026-11-02: #17 provider reliability analysis and 429 policy proposal (unpaid)

- **Owner request.** An unpaid reliability analysis and a prospective
  429-policy proposal. No paid call, capability or new study.
- **Records:**
  - [proposals/429-reliability-analysis.md](proposals/429-reliability-analysis.md),
    sanitized;
  - [proposals/429-policy-proposal.md](proposals/429-policy-proposal.md),
    **unapproved**;
  - the pure model `server/src/experiments/hw2/throttle-policy.ts`, which no
    runtime path imports, and its 40 tests.
- **Findings:**
  - 19 paid dispatches, 4 of them HTTP 429 (21 %, CP95 6–46 %), all from
    DeepInfra's shared upstream pool, none billed;
  - no association with the experiment or with the Skill condition;
  - at the #17 rate, stop-on-429 completes 1.7 % of the time.
- **Recommended for owner review:** P3, a predeclared pool of 3 attempt IDs
  per trial (cap 30), re-attempted only after a classified pre-generation
  429, plus an outage stop after 6 consecutive 429s and P4 worst/best-case
  reporting. New reservations $0.15. Recompute the ceiling from the live
  ledger before any freeze.
- **Reviews.** An independent methodological review (4 major, 10 minor, then
  5 minor on re-review) and a security/cost review (3 low, 2 info, then 1
  low) are all resolved. Server typecheck passes; hermetic 573/573.
- **Unchanged:** #17 stays Implemented. Frozen records, adjudications, the
  Skill, the rule and the fixture are unchanged; #18 and #21 are untouched.
- **Owner decisions** are listed in the proposal. Nothing is authorized.
