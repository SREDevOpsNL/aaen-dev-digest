# Item B: halted before dispatch, then corrected and re-frozen (2026-10-31)

This is the audit record of the first item B authorization. It stopped
before any spending capability existed, and no request was sent. The free
correction and the new freeze followed. The Phase 1 pilot results and the
item A trace are unchanged, and nothing here is an experimental outcome.

## 1. The authorization that was not executed

The owner authorized item B against `prereg/manifest-20261031.json` (sha256
`306fb0c9707726f4952437e90b594cbf7a3062026abbe9ba52fe2f3d1eeb325b`) on stack
`hw2f-cc928441`, implementation fingerprint `201ffa9a…`. It allowed at most
20 calls, $0.005 per slot, $0.10 in new reservations and a cumulative ceiling
of $0.11404478, with no retries or replacements.

The free pre-dispatch verification passed for:

- the source (`964a4a2`) and the prereg hash;
- the stack and Postgres identity, with isolation checks;
- all four request fingerprints, which equalled the packet;
- the ledger: no `c-*` slot, and no live capability.

Two bindings failed:

| Binding | Observed |
| --- | --- |
| The runner can read the frozen file | `preregisteredManifest` refused it: "has no json manifest block". The reader only accepted a Markdown fenced block, but `cli.ts manifest --out` writes bare JSON. The 2026-10-30 freeze had the same defect. |
| The live manifest equals the frozen one | recomputed fingerprint `53fe5f201999…`, frozen `286d9db4fcdd…`. A sorted-key diff showed one difference: the order of the two reviewers in `agents`. `AgentsRepository.list` has no `ORDER BY`, and item A's link edits had rewritten the API Contract Reviewer row, which moved it in heap order. |

As the approval required, no file was rewritten and no stack was
substituted. The halt was pushed as `2e00f56`, and the owner's item B
authorization lapsed with it.

## 2. Correction (approved as Option 1; implementation `2799caf`)

- `buildManifest` (now manifest **version 3**) sorts agents and Skills by
  name and then ID. It sorts a copy, so the persisted `agent_skills.order`
  still sets the Skill order in the system message. The seeded schedule is
  unchanged.
- The manifest also freezes:
  - each Skill's global `enabled` flag and its approval (status and approved
    version; `approved` means the decision approves exactly the frozen
    `body_sha`);
  - each reviewer's `enabled` flag, `provider` and output schema.
- Each reviewer and target Skill name must match exactly one row
  (`exactlyOne`). Without this, row order could still pick between
  duplicates.
- `preregisteredManifest` reads a committed `.json` file whole (what
  `manifest --out` writes) or a Markdown `json manifest` block. It refuses
  malformed JSON, a non-object, a symlink, and an uncommitted or untracked
  file. `readFrozen` also refuses any version other than 3.
- `authorize --phase confirmatory` now requires `--prereg`. It reads the file
  before contacting the stack, and compares it with the live manifest before
  it writes a capability. `run` and `report` go through the same
  `readFrozen` / `verifyPreregistration` path. So does the new free
  `prereg-check`, which also lists any scheduled slot already in the ledger.
- `slotRuns` checks the live target Skill against the frozen entry again
  (body, `enabled`, approval) before any slot is armed.

Tests are in `server/test/hw2-manifest.test.ts` (40):

- row order of agents and Skills does not change the fingerprint;
- each of 20 meaningful changes does change it: model, served model,
  provider, prices, database, prompt, reviewer model, provider and output
  schema, Skill body, approval revoked, stale or re-versioned, Skill or
  reviewer disabled, non-Skill fingerprint, implementation, seed and
  schedule, rules, reservation, and a fixture patch;
- the schedule order is kept;
- duplicates are refused;
- the committed `.json` and the Markdown form are read through the real
  verification path;
- a mismatch, malformed JSON, a non-object, version 2, a symlink, and an
  uncommitted or untracked file each fail closed;
- `authorize` writes no capability on a mismatch, refuses v2 before
  contacting the stack, and writes only after a match.

Mutation checks were run by deleting each guard in turn: the sort, the
approval and `enabled` fields, the version check, the early prereg read, the
post-stack comparison and the symlink check. Each deletion fails at least one
test. The existing DB-backed `skills-prompt.it.test.ts` still shows a drag
reorder (Beta before Alpha, not alphabetical) reaching the system message.

An independent review of the change (a separate subagent session) raised
seven findings: two medium, five low. All seven were fixed, and its re-review
found no regressions. Server: 438 / 438 hermetic, 172 / 172 DB-backed.

## 3. New freeze

The new freeze is on fresh stack `hw2f-19ef1f13`, built from `2799caf`. The
values are in the
[approval packet](../PROSPECTIVE-STUDY.md#approval-packet-v3-2026-10-31).
`prereg-check` read the committed file through the same path that
`authorize` and `run` use, and it matched. Both historical manifests,
`manifest-20261030.json` and `manifest-20261031.json`, stay in `prereg/`
unchanged as audit evidence. The current runner refuses them as manifest
version 2.
