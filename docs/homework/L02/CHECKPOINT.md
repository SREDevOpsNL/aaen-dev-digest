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
