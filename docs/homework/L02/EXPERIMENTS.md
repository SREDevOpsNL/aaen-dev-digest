# L02 controlled experiments (criteria 17–20)

**Status: Paid Phase 1 (exploratory pilot) ran on 2026-10-25/26; no
confirmatory runs.** Neither experiment is a pass: experiment 17 is
incomplete and experiment 18 showed no detection difference. See the
[Phase 1 summary](#phase-1-summary). Each paid phase needs its own written approval
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
`hw2f-7d16304f`. At this authorization checkpoint, nothing had been
generated; the Phase 1 log below records the later attempts and outcomes.

### Phase 1 log (in order)

| When (UTC) | Event | Charged |
| --- | --- | --- |
| 17:44 | capability (exploration, Gate 3, budget $0.05, ceiling $0.06) | — |
| 17:44–17:54 | `x-17-with-1` armed; **refused**: the arm expired, no review request reached the API | $0.00 |
| 19:14–19:24 | `x-17-with-2` (owner-approved replacement) armed; **refused**: same, no review request (Run Review is a dropdown; the agent must be picked in it) | $0.00 |
| 20:44 | capability expired; not extended | — |
| 21:29 | **Spending-guard check** (below) | $0.00 |
| 21:31 | expired capability revoked; fresh capability, same scope (budget $0.05, ceiling $0.06, charged before $0), expires 00:31 | — |
| 21:51 | a second unarmed Run Review → Test Quality Reviewer click, refused the same way (`agent_runs` `3cb44f72-…`) | $0.00 |
| 21:53–21:56 | **`x-17-with-3` completed** via Run Review → Test Quality Reviewer (run `684002a0-…`) | **$0.00055998** |
| 22:01–22:02 | **`x-17-without-1` failed**: HTTP 429 from DeepInfra (origin `upstream_provider`, limit source `upstream_provider_shared_pool`, no retry-after) after 343 ms, one attempt, not retried (run `9c3f6d04-…`; Skill fingerprint `4f53cda1…` = none, non-Skill `e89e033b…`) | cost unknown to the run, so the ledger charges the full $0.01 reservation; key usage afterwards $0.00096786 = opening + confirmed, so nothing was billed |
| 22:06–22:07 | **`x-18-with-1` completed** via Run Review → API Contract Reviewer (run `4ce7d791-…`); the reviewer's operator links were restored afterwards (semver-discipline, breaking-change, response-schema off) | **$0.00020691** |
| 23:13–23:15 | **`x-18-without-1` completed** via Run Review → API Contract Reviewer (run `1a016790-…`); operator links restored afterwards | **$0.00016083** |
| 00:31 | capability expired; not extended | — |
| 07:57–07:58 (10-26) | expired capability revoked. A $0.01-budget capability was written and revoked unused: the server counts the budget cumulatively, so it would have refused the slot. Rewritten with the owner's approval as a $0.02093 cumulative budget (charged $0.01092772 + one $0.01 slot), ceiling $0.06 | — |
| 08:03–08:05 (10-26) | **`x-18-with-2` (trace-only) completed** with operator links; a free preview first confirmed Skill fingerprint `b4978ce0…` (run `af19b042-…`) | **$0.00023517** |
| 08:07 (10-26) | capability revoked; `settle` **PASS**: key usage rose $0.00116289 = confirmed | — |

### Slot results

**`x-17-with-3`** (experiment 17, *with* `Edge Cases and Error Paths`; first
intended slot):

| Item | Value |
| --- | --- |
| Outcome | completed, one attempt, `valid` structured output, finish reason `stop`, 97.8 s |
| Provenance (OpenRouter generation metadata) | provider **DeepInfra**, model `deepseek/deepseek-v4-flash-20260423`, routing `only`/`order` = `deepinfra/fp8`, fallbacks off |
| Tokens (generation metadata) | 1139 prompt, 2235 completion. The router reported 1142 / 2540 |
| Cost | $0.00055998, provider-reported; reservation $0.01, preflight worst case $0.0056 |
| Fingerprints | Skill `18efa866…` and non-Skill `e89e033b…`, both equal to the preflight; diff `8e0ba133…` equal to the frozen fixture |
| Verdict | request_changes, 10 findings |

Findings against the pre-stated rule ("a finding cites the uncovered error
branch **and** the expiry-boundary edge case"):
- **Error branch: yes.** CRITICAL "No test for unknown coupon code" and
  CRITICAL "No test for expired coupon".
- **Expiry boundary: no.** No finding names the boundary
  `now >= coupon.expiresAt` (a coupon used exactly at its expiry instant).
  "No test for expired coupon" asks only for an expired-coupon test. The
  "hardcoded future date" finding reasons about the test date, not about the
  boundary, and its rationale contradicts itself.
- **Result for this slot: not flagged under the rule** (half met). It is one
  exploratory sample. It is not evidence for or against criterion 17, which
  needs the comparison.

**`x-17-without-1`**: failed with an upstream 429 before any output, so it
gives no data. By the owner's decision it was not replaced. Experiment 17
therefore has no *without* sample in Phase 1.

**`x-18-with-1`** (experiment 18, *with* `breaking-change`):

| Item | Value |
| --- | --- |
| Outcome | completed, one attempt, `valid`, finish reason `stop`, 33.5 s |
| Provenance | provider **DeepInfra**, model `deepseek/deepseek-v4-flash-20260423`, pinned `deepinfra/fp8`, fallbacks off |
| Tokens (generation metadata) | 1501 prompt, 412 completion. The router reported 1373 / 463 |
| Cost | $0.00020691, provider-reported |
| Fingerprints | Skill `03214820…` and non-Skill `baa2505e…`, equal to the preflight; diff `db6475df…` |
| Verdict | request_changes, 1 finding |

Against the rule ("a finding names the breaking change to `GET /v1/payments/:id`
at the changed route"):
- **Flagged: yes.** CRITICAL "Renamed path parameter on existing v1 route
  breaks all existing clients", at `src/api/payments.ts` lines 13–14. That
  overlaps the expected anchor 12–13, and the finding names the
  `GET /v1/payments/:id` route and the `:id` → `:reference` change.
- This is one *with* sample. Whether the skill made the difference needs
  the *without* run.

**`x-18-without-1`** (experiment 18, no skill):

| Item | Value |
| --- | --- |
| Outcome | completed, one attempt, `valid`, finish reason `stop`, 77.4 s (provider generation time 15.2 s) |
| Provenance | **from the response, not from the generation record.** OpenRouter's router metadata names **DeepInfra** as the one selected endpoint, model `deepseek/deepseek-v4-flash-20260423`, region AMS, not BYOK. The bounded generation lookup for `gen-1792970051-…` returned `not_found`, so there is no generation-metadata confirmation |
| Tokens (response usage) | 911 prompt, 438 completion |
| Cost | $0.00016083, from the response's usage (`usage_known`); to be checked by key-usage settlement |
| Fingerprints | Skill `4f53cda1…` (none) and non-Skill `baa2505e…`, equal to the preflight and to `x-18-with-1` |
| Verdict | comment, 1 finding |

Against the rule:
- **Flagged: yes.** WARNING "Route parameter renamed from `:id` to
  `:reference` – breaks existing clients that use the parameter name", at
  `src/api/payments.ts` lines 12–13 (the expected anchor). It names the
  `/v1/payments/:id` → `/v1/payments/:reference` change.
- Its reasoning is weaker than the *with* run's. It says clients read
  `request.params.id`, which is server-side, and misses the 404 for existing
  ids. The severity is also WARNING with verdict `comment`, against CRITICAL
  with `request_changes`.

**Experiment 18 exploratory pair:** both conditions flagged the break under
the pre-stated rule, so this pair shows **no detection difference**.
Severity and verdict did differ, but they are not the pre-registered
outcome. One pair is not a result for criterion 18 either way, and it is
**not** counted as passing.

**`x-18-with-2`** (trace-only, excluded from the comparison): completed for
$0.00023517 (DeepInfra, `deepseek/deepseek-v4-flash-20260423`, 1914 / 396
tokens). Its trace is the evidence for rows 14, 19 and 20:
[trace-evidence.md](evidence/trace-evidence.md).

### Phase 1 summary

| | |
| --- | --- |
| Paid requests sent | 5: `x-17-with-3`, `x-17-without-1` (429), `x-18-with-1`, `x-18-without-1`, `x-18-with-2` |
| Refused before any request | 2 unclicked arms (`x-17-with-1`, `x-17-with-2`), plus 2 unarmed-click guard refusals |
| Confirmed spend | **$0.00116289**; the key's own usage rose by exactly that (settlement PASS) |
| Conservative ledger total | $0.01116289, counting the 429 slot at its full reservation; ceiling $0.06 |
| Provider | every completed request was served by DeepInfra, `deepseek/deepseek-v4-flash-20260423`. `x-18-without-1`'s provenance comes from the response's router metadata only (generation lookup `not_found`) |
| Experiment 17 | **incomplete.** *with*: half the rule (error branch yes, expiry boundary no). *without*: no data (429, not replaced by the owner's decision) |
| Experiment 18 | **no detection difference.** Both *with* and *without* flagged the route change under the rule. *with* was more severe (CRITICAL / request_changes against WARNING / comment), but that is not the pre-registered outcome |
| Confirmatory runs | none; not authorized |

Neither experiment is a pass for criteria 17 or 18.

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

## Prospective safety corrections (unpaid, 2026-10-27)

The original Phase 1 outcomes remain unchanged. For future confirmatory
slots, the runner stops after the first 429, infrastructure failure,
ambiguous outcome or unknown cost, including after restart. A mismatch
against the frozen non-Skill fingerprint is persisted in the terminal
ledger event and blocks a resumed schedule. Exploratory stop defaults
remain unchanged.

The anchored-regex matcher is now explicitly provisional screening.
`cli.ts report` cannot claim final success from those keywords. A sealed,
condition-blinded technical adjudication protocol is still required before
a prospective study can be frozen. The outcome rules, four-condition cost
preflight and separate paid authorization gate are in
[PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md).

## Separate conventions extraction (2026-10-27)

The owner authorized exactly one `conventions.extract` operation on
`fastify/fastify` through the isolated extraction stack. It completed
with one grounded candidate for $0.00265410 and passed key-usage
settlement. This is evidence for criteria 38 and 40, documented in
[conventions-live-extraction.md](evidence/conventions-live-extraction.md).
It is **not** a trial in controlled experiments 17 or 18. Their Phase 1
outcomes and prospective spending gate remain unchanged.

## Skill placement change and new pre-registration (2026-10-30)

Every Phase 1 slot above ran with Skill bodies in the **user** message. After
the mentor's ruling on criterion 14, Skills move to the **system-role**
message behind an owner approval gate (commit `23d0b48`). That changes every
non-Skill fingerprint and the implementation fingerprint, so:

- the Phase 1 records stay exactly as recorded and are **never pooled** with
  any later slot;
- no earlier pre-registration can authorize a new confirmatory slot;
- the new frozen manifest, fingerprints, schedule and approval packet are in
  [PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md#approval-packet-2026-10-30).

The treatment's target Skill must be approved for its exact body before any
slot can arm; both target Skills are approved by the reviewed seed bootstrap.
No confirmatory request has been made.

## Trace-only slot on the system-role placement (2026-10-31)

The owner approved item A of the approval packet only. `x-18-with-3`
(exploration, trace-only, operator links semver-discipline → breaking-change,
response-schema off) completed with one Run Review click: run `4fdedc2e-…`,
$0.00022779, settlement PASS. Like `x-18-with-2`, it is excluded from every
comparison. It documents the system-role trace for criteria 14, 19 and 20
([evidence](evidence/criterion-14-system-role.md#live-system-role-run-trace-item-a-2026-10-31)).
Ledger: $0.01404478 conservative. No confirmatory request has been made; for
the re-freeze item B would need after the 2026-10-31 host restart, see
[PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md#status-of-the-spending-items-2026-10-31).
