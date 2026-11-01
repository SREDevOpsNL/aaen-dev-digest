# Successor study v4 (#17): confirmatory run, stopped at slot 2 (2026-11-01)

The owner authorized study v4 for #17 only, exactly as defined in the
[approval packet](../../PROSPECTIVE-STUDY.md#approval-packet-v4-not-authorized).
The schedule stopped on its second slot because the upstream provider returned
HTTP 429. A 429 is one of the preregistered stop rules, and v4 allows no retry
or replacement. **#17 is `incomplete`: it is neither shown nor refuted.** No
truncation occurred, so nothing was imputed.

## Checks immediately before authorization (all matched)

- **Source.** Branch head `788a606` on `homework/l02-mentor-submission`, CI
  7/7 at that exact head. The stack's detached checkout is `253e96f`, clean.
  The commits between the two change only docs, so the implementation
  fingerprint is the same.
- **Pre-registration.** `prereg/manifest-20261101-v4.json`, sha256
  `dab95681c8189696a54f5f5ed55a32d9128b66ac9144128d3d9a8a90b2272803`.
  `prereg-check`: manifest fingerprint
  `3ab26d81c66e0776620a1f7bef1263ae843c12d45d7fb89d7e5a26ade363a60a`,
  10 slots, seed 4284451045, and no scheduled slot in the ledger.
- **Stack (`check`).**
  - Stack `hw2f-5b00487b` on `devdigest_hw2f_5b00487b`, container
    `devdigest-hw2f-5b00487b`; isolation checks pass.
  - Implementation fingerprint
    `61145a400570094d81007e28abb06f2e14e0e17fe82971394d18da33cec25db1`.
  - Fixture #501 diff sha256 `8e0ba133…d186`, as frozen.
  - 0 runs in the stack database.
- **Previews.** Both are byte-identical to the freeze previews:

  | Condition | Non-Skill fingerprint | Skill fingerprint | Input bound | Output cap | Worst case |
  | --- | --- | --- | --- | --- | --- |
  | with | `7aea9945…` | `18efa866…` | 9,474 | 8,000 | $0.00343899 |
  | without | `7aea9945…` | `4f53cda1…` | 8,967 | 8,000 | $0.00337054 |

  `phase0-check` passes: $0.005 covers 1.2 × the worst case.
- **Endpoint.** The only endpoint is `deepinfra/fp8` (DeepInfra, model
  `deepseek/deepseek-v4-flash`). Live prices are $0.00000009 input,
  $0.00000018 output and $0 per request, equal to the frozen prices.
- **Ledger.** 42 records, sha256 `cc70a7ed…`. $0.0163864 conservative, no
  open slot, no live capability. The last authorization event was the v3
  revoke.
- **Key.** $0.00679428 of $2.00 used, read live without recording.

The capability was issued at 20:02:25Z ([authorize.log](authorize-log.txt)):
- Gate 4, confirmatory;
- budget $0.05, ceiling $0.0663864;
- expiry 23:02:25Z.

`authorize` printed "pre-registration matches" before it wrote the
capability.

## Execution ([run.log](run-log.txt), [clicks.log](clicks-log.txt))

The runner armed each slot in the frozen order. The browser driver clicked
**Run Review → Test Quality Reviewer** once per armed slot. It selected each
button by its exact name and would not click if the name matched more than
one button.

| # | Slot | Result | Cost (USD) |
| --- | --- | --- | --- |
| 1 | `c-v4-17-without-2` | completed: 1,034 in / 1,454 out tokens, 5 findings, provenance verified (router metadata and the generation record) | 0.00035478 |
| 2 | `c-v4-17-with-2` | **failed: HTTP 429 from DeepInfra**: "Provider returned error", origin `upstream_provider`, limit source `upstream_provider_shared_pool`, no response ID | not billed (see settlement) |
| 3–10 | — | not dispatched (schedule stopped) | — |

The 429 arrived about 300 ms after the request was submitted. It is a stop
rule, not a truncation, so the v4 continue-and-impute rule does not apply.
The runner stopped the schedule as frozen. Nothing was retried, reprompted or
replaced.

## What the failed slot's trace records

This is the first live failure since the failed-run trace repair. The trace of
run `46849681…` (`c-v4-17-with-2`) records:

- `dispatch.state: dispatched`, `prompt_assembly_source: dispatched_request`;
- the assembly that was actually sent: 4,835 bytes, sha256 `22cc8638…`,
  `assembly_complete: true`. The system message contains the **Edge Cases and
  Error Paths** Skill block, 103 Skill tokens.
- one stage (`single-0`, state `failed`) with one attempt:
  - phase `submitted`, failure `http_error`, HTTP status 429;
  - `response_id: null`, `verified_usage: null`.

  So the trace does **not** claim that the provider processed the request.
- `stats.usage_state: unknown`; tokens and cost are `null`, not 0. The
  `agent_runs` row matches: tokens `null`, cost `null`, error `429 Provider
  returned error`.
- frozen fingerprints: Skill `18efa866…` (the frozen *with* value), non-Skill
  `7aea9945…`, diff hash as expected.

Before the repair, the same failure would have read as "sent 0 skills" with
0/0 tokens.

## Spending and settlement

- The capability was revoked at 20:03:48Z, 83 s after it was issued
  ([revoke.log](revoke-log.txt)). `reconcile` found no unresolved slot
  ([reconcile.log](reconcile-log.txt), empty).
- **Ledger** (48 records):
  - slot 1: $0.00035478 confirmed;
  - slot 2: the $0.005 reservation stays held as its conservative charge,
    because the cost is unknown;
  - conservative total now $0.02174118, below the $0.0663864 ceiling.
- **Settlement** ([settle.log](settle-log.txt)): PASS. Key usage rose
  $0.00674118 from the opening reading, which is exactly the confirmed
  charges. Since the last settlement it rose $0.00035478, the cost of slot 1
  alone, so **the 429 attempt was not billed**. The key now shows
  $0.00714906 of $2.00 used.
- **v4 actual spend: $0.00035478.**

## Adjudication ([adjudication/](adjudication/report.md))

The adjudication followed packet v2 with redaction r1, sealed and
condition-blinded.

- **The packet.** One case, because only one slot completed. Packet sha256
  (canonical) `c72cb047…`, mapping `6bd66b72…`. The packet carries neither
  the condition nor the slot ID.
- **The adjudicators.** Two independent subagent sessions, Technical-Reviewer-A
  and Technical-Reviewer-B. Each could read only its own copy of the packet.
  Both reported model `claude-opus-5-5`.
- **The judgments.** The verdicts were registered and sealed before the
  reveal (seals `531a9e9a…` and `12967210…`), and `verify` reports the record
  intact. The originals are kept byte for byte.
- **The verdicts.** Both adjudicators said **no**. Part (a), a missing
  error-branch test, is met by the expired-coupon and unknown-code findings.
  Part (b), the exact `now == expiresAt` boundary, is missing. There were no
  disputes.
- **Result:** 0 / 5 *with* (none adjudicated) and 0 / 5 *without* (1
  adjudicated, no). **Outcome `incomplete`**: 5 *with* and 4 *without*
  scheduled slots have no verdict.
- **Imputed truncations:** none.
- **Blinding.**
  - The tool reports it is not compromised: r1 made 0 replacements, with 0
    warnings and 0 residual compromises.
  - Residual limitation: the coordinator knew this one case's condition,
    because the run log names the slot. The coordinator did not adjudicate,
    and the packet given to the adjudicators did not reveal it.
  - The verdict cannot change the outcome, which is incomplete either way.

## Provenance and evidence gaps

- **Slot 1:** complete, verified provenance.
- **Slot 2:** no response ID, no generation record and no served-model
  confirmation. That is the expected shape of a request refused upstream, and
  the report lists it as "not counted".
- **No reconstruction.** The recorded assembly is the request that was
  submitted; nothing was rebuilt.

## Preserved evidence (private, outside Git)

These are kept in `~/.devdigest/hw2-experiments/itemb-v4-20261101/` (mode
0700/0600):

- a full `pg_dump` of `devdigest_hw2f_5b00487b` (42 tables of data);
- JSON exports of `agent_runs`, `run_traces`, `reviews`, `findings`,
  `agents`, `agent_skills`, `skills`, `skill_approvals` and
  `skill_versions`;
- the API slot views of both dispatched slots;
- the stack server log and the free previews;
- the runner, driver, authorization, revoke, settlement and reconcile logs;
- the adjudication input and the full adjudication directory, including the
  sealed private judgments and the originals.

`SHA256SUMS` covers 45 files, including the global `ledger.jsonl`,
`authorizations.jsonl` and `key-usage.jsonl` at the time of export. Its own
sha256 is `6f05ef010ca44c9f542df24b1ab7892bdcdcc8abf82e81f9d769ef067c969829`.
`sha256sum -c` passes.

The committed files here are byte-identical copies of their private
originals, with one exception: `clicks-log.txt` has its trailing spaces
stripped, which is the only change (private `clicks.log` sha256 `f1a6edc5b1928ebb…`). Logs are renamed `*-log.txt` because the root `.gitignore`
excludes `*.log`. The dump, the traces and the raw responses stay private.

## State afterwards

- No capability file. The last authorization event is this revoke.
- All 17 ledger slots are terminal.
- No runner or browser-driver process is left.
- Stack `hw2f-5b00487b` is still up (tmux `hw2-freeze-v4`) for read-only
  forensics. Its teardown is the owner's call.
- The 8 undispatched v4 slots were not run. Any further #17 attempt needs a
  new decision.
