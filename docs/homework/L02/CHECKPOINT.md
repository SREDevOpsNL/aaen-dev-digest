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
Next free actions: inspect final GitHub CI and refresh this record when the
PR head changes. The previous
full local matrix at `17241a3` and subsequent CI are in
[TEST-RESULTS.md](TEST-RESULTS.md).
