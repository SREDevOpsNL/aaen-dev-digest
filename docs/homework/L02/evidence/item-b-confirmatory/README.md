# Item B v3: confirmatory run, stopped at slot 6 (2026-10-31)

The owner authorized item B v3 exactly as defined in the
[approval packet](../../PROSPECTIVE-STUDY.md#approval-packet-v3-2026-10-31).
The schedule stopped on its sixth slot, because that response was truncated.
No retry or replacement was made, as the frozen rules require. **Both
experiments are `incomplete`. Neither #17 nor #18 is shown, and neither is
refuted.**

## Checks immediately before authorization (all matched)

- Worktree clean at `400f2dd`. The pre-registration was committed in
  `c539cc0`, sha256
  `47c58433ce0da6ee8367d758a3f3ff2db3a61a2513f7ffb494809b2bb29f5d5b`. The
  rules file sha256 is `bb8fb1d0…7a6a`.
- `check`: stack `hw2f-19ef1f13` on `devdigest_hw2f_19ef1f13`; isolation
  checks pass; implementation fingerprint
  `fa59aa4c7ad29913eec12b055a47e0a9c8399d55fbfd964b0b3b9888a6de81ad`; both
  fixture diff hashes frozen.
- `prereg-check`: manifest fingerprint
  `2f13ad1ce7f5ad5bfcf3b90d2ecd4cb0ba78cd3ad61eb4499da43627684d79d5`, 20
  slots, seed 20261030; no scheduled slot in the ledger.
- Four free previews: `ok`, no problems. Non-Skill and Skill fingerprints and
  input bounds equal the packet (9,474 / 8,967 / 10,921 / 8,879).
- Live endpoint `deepinfra/fp8` (DeepInfra): $0.00000009 input and
  $0.00000018 output per token, $0 per request, which equals the frozen
  prices.
- Key usage $0.00445266 of $2.00, read live without recording. Ledger: 24
  records, sha256 `dc052468…6f4fbc`, no live capability.

The capability was issued at 18:28:58Z: Gate 4, budget $0.10, ceiling
$0.11404478, 3 hours ([authorize.log](authorize.log)). `authorize` printed
"pre-registration matches" before writing it.

## Execution ([run.log](run.log), [clicks.log](clicks.log))

The runner armed each slot in the frozen order. A browser driver
(agent-browser) clicked **Run Review → the named reviewer** on the PR page
once per armed slot. It selected the button by its exact name, refused to
click if the name matched more than one button, and never clicked again.

| # | Slot | Result | Cost (USD) |
| --- | --- | --- | --- |
| 1 | `c-18-with-5` | completed | 0.00020115 |
| 2 | `c-18-without-5` | completed | 0.00009567 |
| 3 | `c-17-with-1` | completed | 0.00041526 |
| 4 | `c-17-without-1` | completed | 0.00045162 |
| 5 | `c-17-without-2` | completed | 0.00035514 |
| 6 | `c-17-with-2` | **failed: output reached the 4,000-token cap (`finish_reason=length`)** | 0.00082278 |
| 7–20 | — | not dispatched (schedule stopped) | — |

Every completed slot was provenance-verified (router metadata and the
generation record: DeepInfra, `deepseek/deepseek-v4-flash-20260423`) and
carried the frozen fingerprints ([runner-report.md](runner-report.md)).

## Spending and settlement

- The capability was revoked at 18:36:34Z ([revoke.log](revoke.log)).
  `reconcile` found no unresolved slot.
- New confirmatory charge: $0.00234162 confirmed, which is also the
  conservative figure. Totals are $0.0163864 conservative ($0.0063864
  confirmed plus the $0.01 still held for `x-17-without-1`), within the
  $0.11404478 ceiling and the $1.50 cap. The ledger has 42 records, sha256
  `cc70a7ed…51b0`.
- `settle` **PASS** ([settle.log](settle.log)): key usage rose $0.00638640
  from the opening reading, within [$0.00638640, $0.01638640]. Key usage is
  now $0.00679428 of $2.00 ($1.99320572 remaining). That is a rise of
  exactly $0.00234162 since the check before authorization.

## Runner report labels experiment 17 `invalid`: a recording gap, not a wrong request

`report` lists `c-17-with-2` as "a 'with' slot sent 0 skills". The request
did carry the Skill:

- The run's stored experiment metadata has Skill fingerprint
  `18efa866…`, the frozen *with* value. The *without* value is `4f53cda1…`.
- Input was 1,142 tokens, identical to `c-17-with-1`; both *without*
  slots used 1,034.

The label comes from the failure path in
`server/src/modules/reviews/run-executor.ts` (line 622). It stores the agent's
raw system prompt with `skills: null`, not the assembled prompt, and the
report counts Skills from that stored block. The frozen report is left as
it is, because the study was not changed after execution began. The slot is
uncounted either way. Experiment 17 is `incomplete` on the adjudicated
result below.

## Sealed, condition-blinded adjudication ([adjudication/](adjudication/))

- `prepare` gave the 5 counted slots random case IDs. The packet holds only
  finding text and anchors, the frozen rules and the ground truth. Packet
  `9e798175…2cc0` and mapping `debdab05…cd58` were sealed first
  ([seals.jsonl](adjudication/seals.jsonl)).
- **Technical Reviewer A** and **Technical Reviewer B** were two separately
  started Claude Code `general-purpose` subagent sessions. Each reported model
  `claude-opus-5-5`. Each was told to read only its own copy of `packet.json`.
  Neither saw the mapping, the conditions, slot or run IDs, prompts or the
  other's judgment. Their session IDs are kept in the private run directory.
- The register command accepts only `[A-Za-z0-9._-]` names, so both
  judgments were registered with the spaces in the name replaced by hyphens.
  The verdicts were not changed. The originals are kept as
  `judgments/original-*.json`.
- Seals: B `42753c00…b9b4`, A `4070f28a…ccba`. `disputed`: none, so no
  reconciliation was needed. `verify`: record intact. Then `reveal`.

| Case | Slot | Condition | A | B | Final |
| --- | --- | --- | --- | --- | --- |
| case-b178165d828f | c-17-with-1 | with | yes | yes | **yes**: f1/f2 missing error-branch tests, f7 the `now == expiresAt` boundary |
| case-abd44b7d77f7 | c-17-without-1 | without | no | no | no: error branches named, boundary missing |
| case-22da25c10c26 | c-17-without-2 | without | no | no | no: error branches named, boundary missing |
| case-6f8d3ce292a9 | c-18-with-5 | with | no | no | no: names the `:id`→`:reference` rename only, not the 404 on payment-ID lookups |
| case-733ced5c04a6 | c-18-without-5 | without | no | no | no: no findings |

| Experiment | With: detected / scheduled | Without: detected / scheduled | Outcome |
| --- | --- | --- | --- |
| 17 | 1 / 5 | 0 / 5 | **incomplete**: 4 *with* and 3 *without* slots have no verdict |
| 18 | 0 / 5 | 0 / 5 | **incomplete**: 4 *with* and 4 *without* slots have no verdict |

**Blinding was compromised for one case.** The #18 *with* finding
(case-6f8d3ce292a9) uses the words "skill" and "breaking-change", which can
reveal its condition. The verdict there was `no`, so the leak did not favour
the *with* condition.

## Reading

- #17: on the slots that ran, the one completed *with* slot met both halves
  of the rule, and both *without* slots met only the error-branch half. This
  agrees in direction with the hypothesis. With 1 *with* and 2 *without*
  observations it is not evidence at the pre-registered 4/5 versus 1/5
  threshold.
- #18: neither slot detected the payment-ID 404, so the run gives no sign of
  a Skill effect.
- #17 and #18 stay **Implemented**, not Verified. Completing them needs a new
  owner decision and a new pre-registration (for example, a different output
  cap). That would be a new study, not a continuation of this one.

## Failure-path trace limitation (forensic check, 2026-10-31)

This section records, read-only from the stack `hw2f-19ef1f13`, what the
saved trace of the failed slot `c-17-with-2` (run `10d35e6f…`) holds. The
frozen records and the adjudication are unchanged.

**The saved trace does not contain the request sent to the provider.** The
failure path (`server/src/modules/reviews/run-executor.ts`, line 622) writes
these fields:

| Trace field | Saved value |
| --- | --- |
| `prompt_assembly.system` | 771 characters, byte-identical to the agent's raw `system_prompt`. This is **not** the assembled system message: no Skill block, no injection guard. |
| `prompt_assembly.skills`, `.memory`, `.specs` | `null` |
| `prompt_assembly.user` | empty string |
| `raw_output` | empty string (the truncated response was not kept) |
| `stats` | tokens 0 / 0, cost `null` |

For comparison, the completed `c-17-with-1` trace has a 2,373-character
system message with the Skill at offset 1,018.

What *was* recorded at dispatch, and is the only original evidence about the
failed request:

- the `agent_runs` row: 1,142 input and 4,000 output tokens, $0.00082278,
  status `failed`;
- the experiment metadata:
  - Skill fingerprint `18efa866…`, the frozen *with* value;
  - non-Skill fingerprint `c6010d90…` and the diff hash, both as frozen;
- the attempt record:
  - routing (only `deepinfra/fp8`, no fallbacks) and the router metadata
    (DeepInfra);
  - response ID `gen-1793471676-…` and `finish_reason=length`.

The generation lookup returned `not_found`.

The assembled prompt for this slot can be rebuilt from the frozen inputs, and
its fingerprints match. **A rebuilt prompt is a reconstruction. It is not the
recorded request, and nothing in this record presents it as one.** The
statement that the Skill was sent rests only on the fingerprint and
token-count evidence above.

## Preserved forensic evidence

Before teardown, the following were exported read-only into the private run
directory `~/.devdigest/hw2-experiments/itemb-v3-20261031/` (mode 0700,
outside Git):

- a full `pg_dump` of `devdigest_hw2f_19ef1f13` (`pg_restore --list` shows
  42 tables' data);
- JSON exports of the six runs' `agent_runs`, `run_traces`, `reviews` and
  their 20 `findings`;
- `agents`, `agent_skills`, `skills`, `skill_approvals` and
  `skill_versions`;
- the API's `/experiments/slots/<id>` views of the six dispatched slots;
- the stack server log;
- the runner and driver logs, the authorization, revoke and settlement logs;
- the full adjudication directory, including the sealed private judgments;
- the adjudicators' session IDs.

`SHA256SUMS` lists 51 files, including the global `ledger.jsonl`,
`authorizations.jsonl` and `key-usage.jsonl` as of the export. Its own
sha256 is `a47daf86450556d3348409de5defb1d419d42682dafd7dd82efa1ce9925735b1`.
`sha256sum -c` passed, every copy committed here is byte-identical to its
private original, and `adjudication-cli.ts verify` reports the record
intact. The dump stays private because it holds the full prompts and
responses.

State before teardown:

- no capability file, and the last authorization event is the revoke;
- all 15 ledger slots are in a terminal state;
- no `running` review run, and no runner or browser-driver process.

`c-17-with-2` was not retried, and the 14 undispatched slots were not run.
