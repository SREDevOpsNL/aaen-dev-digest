# L02 controlled experiments (criteria 17–20)

**Status: not run on this branch yet.** No result below is a claim until it
appears in [Results](#results). Each paid phase needs its own written approval
naming the slots, model, provider and maximum spend.

## What is measured

| Criterion | Reviewer | PR (seeded, disposable stack only) | Target skill | "Flagged" means |
| --- | --- | --- | --- | --- |
| 17 | Test Quality Reviewer | #501: coupon discounts with one happy-path test | `Edge Cases and Error Paths` | a finding cites the uncovered error branch (unknown / expired coupon) **and** the expiry-boundary edge case |
| 18 | API Contract Reviewer | #502: a v1 route's path parameter changes meaning (route signature) | `breaking-change` | a finding names the breaking change to `GET /v1/payments/:id` at the changed route |

Each experiment compares the **same PR and reviewer** without and with the
target skill linked. Everything else the model receives is held fixed and
fingerprinted: the system prompt, PR description, diff and prompt order (the
"non-Skill fingerprint", identical across conditions). The Skills block is the
only difference (the "Skill fingerprint").

Rows 19 and 20 are read from the run traces of these runs on the PR page
(**Agent runs → run trace**): the Skills block with its own token count, the
enabled skill present, a skill switched off absent.

## Fixtures

- **#501** (`server/src/db/seed-fixtures.ts`): `applyDiscount` throws for an
  unknown or expired coupon; the only test covers a valid coupon.
- **#502** (redesigned on this branch): `GET /v1/payments/:id` becomes
  `GET /v1/payments/:reference` and looks payments up by their public
  reference. The URL shape is unchanged, so existing clients still reach the
  route, but an id now returns 404: a breaking route-signature change on a
  published v1 route, made in place with no new version or deprecation. The PR
  presents it as a link-sharing improvement and adds a lookup helper, so the
  break is not announced. Expected anchor: `src/api/payments.ts` lines 12–13
  (both added lines).
- The earlier #502 changed a v1 *response field* (`amount_cents` →
  `amount`); the recovered rubric asks for a route-signature change, and on
  `main` the reviewer flagged that version even without the skill (see
  [Earlier record](#earlier-record-on-main)). It is replaced, not run here.

Fixtures are seeded only into a disposable database
(`DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1`, refused on `devdigest`).

## How a slot runs

1. **Dispatch through the PR page.** `cli.ts run --via-ui` reserves the slot
   in the ledger, links the condition's skills (and switches each one on for
   the agent), and **arms** the slot on the server. The operator then opens
   the PR and clicks **Run Review** for that agent once. The click dispatches
   the armed slot through the experiment path. Arming runs every check a
   direct dispatch runs, and the capability is checked again at the click. An
   arm that is not clicked expires after 10 minutes and can never dispatch.
2. **One request, pinned.** Experiment mode sends exactly one HTTP request:
   - no SDK retry, no reprompt;
   - routed to one frozen OpenRouter provider endpoint, fallbacks off;
   - output capped, 360 s deadline for the whole request.

   Provenance (served provider and model, generation id, tokens, cost) comes
   only from OpenRouter's metadata. Errors are recorded sanitized.
3. **Fail-closed preflight.** The diff hash must equal the frozen fixture hash,
   the reviewer must be single-pass with repo intel off, no fixture clone may
   exist, the live endpoint must match, and the worst case must fit the
   reservation.
4. **Links put back.** After a condition slot, whatever its outcome, the
   runner restores the reviewer's links as they were before it: their order
   and each per-agent switch.

### The trace-evidence slot is trace-only

`run --keep-links` runs one exploration `with` slot on the links as the
operator arranged them in the UI (dragged order, one skill switched off). It
exists only to produce a run trace for rows 14, 19 and 20. **It is not part of
either experiment's with/without comparison**, even though its id has the
`with` shape (for example `x-18-with-2`):
- its ledger record says `links: "operator"`, `purpose: "trace-evidence"`
  (a condition slot says `links: "condition"`, `purpose: "comparison"`);
- its prompt carries more than the target skill, so its Skill fingerprint is
  not the `with` condition's, and its findings are never counted for row 18;
- the runner refuses operator links outside exploration, so it can never be
  a confirmatory slot, and `report` reads only the pre-registered `c-` slots.

Before it reserves anything, `run --keep-links` makes a free preview and
refuses unless the Skill fingerprint equals `--expect-skill-fingerprint`, the
one recorded at preflight. So it never spends on links that changed since.

Implementation: `server/src/modules/experiments/`,
`server/src/modules/reviews/experiment-run.ts`,
`server/src/platform/experiment-spend-gate.ts`,
`server/src/platform/experiment-arms.ts`, `server/src/experiments/hw2/`,
`reviewer-core/src/llm/openrouter.ts`.

## Spending safety

| Rule | Mechanism |
| --- | --- |
| Nothing spends without an approved phase | A capability written by `authorize` (phase, budget, expiry, token hash); the server checks it on every arm, dispatch and click |
| One ceiling over everything | `authorize --ceiling`: everything charged so far on every stack (unknown costs at their full reservation) plus the new budget must fit the approved ceiling |
| No overlapping paid work on the key | One shared runner lock; an `authorize` lock; no new capability while another stack holds a live one; the server's spend gate admits one slot at a time |
| Reservation before any request | The slot is fsynced to `~/.devdigest/hw2-experiments/ledger.jsonl` as `reserved` before the request leaves |
| Crash after reservation or dispatch | The slot stays unresolved: no authorization or revocation until `reconcile`; reconciliation disarms it and records it `ambiguous`, charged at its full reservation |
| Never replay | A slot id is used once, on any stack; a late provider answer does not change the ledger |
| Independent check | `key-usage --opening` before the first paid slot; `settle` after each phase reads the key's own usage until it is stable and checks opening + confirmed ≤ observed ≤ opening + conservative (`PENDING` while it keeps moving, never a pass) |
| Isolation | Loopback-only stack, disposable database, dedicated key file (never the environment); server tests never reach the dev database or real keys |

Tests: `server/test/experiments.it.test.ts`, `hw2-runner.test.ts`,
`hw2-runner-run-review.test.ts`, `hw2-crash-recovery.test.ts` (real processes
killed with SIGKILL), `hw2-key-usage.test.ts`, `hw2-authorize-guard.test.ts`.

## Operator procedure

Everything runs in WSL from the worktree's `server/`. Values marked EXAMPLE
are placeholders until the approved phase fixes them.

1. **Start the stack** (keyless until the dedicated key file exists):
   ```bash
   export DEVDIGEST_EXPERIMENT_PROVIDER=deepinfra/fp8 DEVDIGEST_EXPERIMENT_MODEL=deepseek/deepseek-v4-flash \
     DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS=16000 DEVDIGEST_EXPERIMENT_PRICE_INPUT=0.00000009 DEVDIGEST_EXPERIMENT_PRICE_OUTPUT=0.00000018   # EXAMPLE values
   ../scripts/e2e.sh --serve
   ```
   It prints the stack id, database, container, API and web URLs. Pass them to
   every command below as `--api … --stack … --database … --container …`.
2. **Free checks:** `pnpm exec tsx src/experiments/hw2/cli.ts check …`, then
   `endpoints`, then `preview --experiment 18 --condition with --reservation 0.01 …`
   for each condition, and `preview … --keep-links` for the trace-evidence
   slot after the drag.
3. **Opening key usage**, once, before the first paid slot:
   `cli.ts key-usage --opening`.
4. **Authorize the approved phase:**
   ```bash
   cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.02 --ceiling 0.04 --hours 2 …   # EXAMPLE amounts
   ```
5. **Run one slot through the PR page:**
   ```bash
   cli.ts run --phase exploration --authorized-gate 3 --confirm-spend --via-ui --experiment 18 --condition without --count 1 --reservation 0.01 …
   ```
   When it prints "armed", open the PR in the stack's web UI and click
   **Run Review** for the named agent once.
6. **After the phase:** `cli.ts revoke --stack …`, then
   `cli.ts settle` (key usage against the ledger).
7. **Confirmatory phase:** commit the pre-registration, which holds the rules,
   n per condition, seed, fixture and skill hashes and the manifest.
   `run --phase confirmatory --authorized-gate 4 --prereg <path>` refuses any
   mismatch, and any uncommitted change, in the fingerprinted implementation
   (`server/src`, `reviewer-core/src`, lockfiles, `scripts/e2e.sh`).
   `cli.ts report` builds the result table from the stored traces.

## Earlier record on main

Reference only, not evidence for this branch. On `main`, 4 exploratory
dispatches ran:
- 2 completed, both experiment 18. Both conditions flagged the breaking
  change.
- 2 failed with HTTP 429 from DeepInfra's shared pool.
- Confirmed spend $0.00040788; conservative $0.02040788.

That spend is part of the dedicated key's opening usage here.

## Results

Paid Phase 1 was authorized on 2026-10-25: five exploratory slots, $0.01
reserved each, a $0.06 cumulative ceiling, `deepseek/deepseek-v4-flash` via
`deepinfra/fp8`, no retries, no fallback, and no confirmatory runs. Stack
`hw2f-7d16304f`. Nothing has been generated yet.

### Phase 1 log (in order)

| When (UTC) | Event | Charged |
| --- | --- | --- |
| 17:44 | capability (exploration, Gate 3, budget $0.05, ceiling $0.06) | — |
| 17:44–17:54 | `x-17-with-1` armed; **refused**: the arm expired, no review request reached the API | $0.00 |
| 19:14–19:24 | `x-17-with-2` (owner-approved replacement) armed; **refused**: same, no review request (Run Review is a dropdown; the agent must be picked in it) | $0.00 |
| 20:44 | capability expired; not extended | — |
| 21:29 | **Spending-guard check** (below) | $0.00 |
| 21:31 | expired capability revoked; fresh capability, same scope (budget $0.05, ceiling $0.06, charged before $0), expires 00:31 | — |

Both refused slots stay in the ledger unchanged, and their ids are never
reused. `x-17-with-3` is the owner-approved replacement for the first
intended slot.

### Spending-guard check (not experiment evidence)

The owner chose **Run Review → Test Quality Reviewer** on PR #501 while no
slot was armed. The server refused the generation before any provider call:

- the run ended `failed`, with the error "Refused in experiment mode: an
  ordinary structured call (no experiment slot). Paid generation only runs
  through an authorized experiment slot.";
- the run is `agent_runs` `40bdd305-…`, with no cost;
- the ledger was unchanged (4 lines, no new slot);
- the key's usage was unchanged at $0.00040788.

This shows that an unarmed click cannot spend. It says nothing about
criterion 17.
