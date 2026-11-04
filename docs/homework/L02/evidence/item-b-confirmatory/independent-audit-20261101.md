# Item B v3: independent audit (Agent D, 2026-11-01)

Scope: read-only audit of the item B v3 confirmatory run (stack `hw2f-19ef1f13`,
2026-10-31) against the private archive
`~/.devdigest/hw2-experiments/itemb-v3-20261031/`, the global
`ledger.jsonl` / `authorizations.jsonl` / `key-usage.jsonl`, and the extraction
repository `aaen-dev-digest-l02-extraction` at `0c41f33`. No paid call and no
`authorize`, `run`, `key-usage` or `settle` command was run. The only command
run was `adjudication-cli.ts verify`, after the code was read and shown to be
read-only (item 10).

**Overall verdict: 10 PASS, 0 blocking discrepancies.** One labelling defect
that was already documented is noted under items 2 and 7. It does not affect
counting or scoring.

| # | Check | Verdict |
| --- | --- | --- |
| 1 | Six-slot attempt history = ledger = run rows | PASS |
| 2 | Five adjudicated cases map to the five completed slots | PASS (label note) |
| 3 | Sealed, published and original judgments agree; only the name differs | PASS |
| 4 | Rules-file sha256 `bb8fb1d0…7a6a` | PASS |
| 5 | Blinding compromise recorded for `case-6f8d3ce292a9` | PASS |
| 6 | DeepInfra provenance; charges sum to $0.00234162 | PASS (nuance) |
| 7 | Truncated `c-17-with-2` not scored | PASS |
| 8 | No replacement or retry; nothing after the 18:36:34Z revoke | PASS |
| 9 | Phase 1 (`x-*`) kept separate | PASS |
| 10 | `adjudication-cli.ts verify` is read-only and reports the record intact | PASS |

## 1. Attempt history against the ledger and the run rows: PASS

Ledger lines 25–42 hold exactly 18 `c-*` events: three per slot, in the
order reserved → dispatched → terminal. All are on stack `hw2f-19ef1f13`
with `reservation_usd` 0.005. Each dispatched `run_id` equals the terminal
`run_id`, and every terminal event has `fingerprint_mismatch: false`. The
cost is cross-checked against three sources: the `agent_runs` export, the
API slot view (`forensics/slot-*.json`), and a recomputation from tokens ×
the frozen prices ($9e-8 input, $1.8e-7 output per token):

| Slot | Ledger states | Run | `agent_runs` status / in / out | Ledger cost = run cost = slot view = tokens × price |
| --- | --- | --- | --- | --- |
| c-18-with-5 | reserved > dispatched > completed | 0dc25e31 | done / 1,373 / 431 | 0.00020115 (all four equal) |
| c-18-without-5 | reserved > dispatched > completed | cea3912f | done / 911 / 76 | 0.00009567 (equal) |
| c-17-with-1 | reserved > dispatched > completed | 64129cb5 | done / 1,142 / 1,736 | 0.00041526 (equal) |
| c-17-without-1 | reserved > dispatched > completed | 2557a939 | done / 1,034 / 1,992 | 0.00045162 (equal) |
| c-17-without-2 | reserved > dispatched > completed | 9028f69b | done / 1,034 / 1,456 | 0.00035514 (equal) |
| c-17-with-2 | reserved > dispatched > failed | 10d35e6f | failed / 1,142 / 4,000 | 0.00082278 (equal) |

The dispatch order equals the first six slots of the frozen schedule in
`prereg/manifest-20261031-v3.json`. Dispatch timestamps agree with
`clicks.log` to the second. The ledger sha256 is `cc70a7ed…51b0` with 42
records, as the README states.

## 2. Five cases map to the five completed slots: PASS (label note)

`adjudication/mapping.json` is byte-identical to `private/mapping.json` and
to the published `mapping-revealed.json`. It assigns a `case_id` to exactly
the five `completed` slots:

- case-6f8d3ce292a9 → c-18-with-5
- case-733ced5c04a6 → c-18-without-5
- case-b178165d828f → c-17-with-1
- case-abd44b7d77f7 → c-17-without-1
- case-22da25c10c26 → c-17-without-2

Each of the other 15 entries has `case_id: null`. `packet.json` holds exactly
these five cases, and `report.json` repeats the same mapping. The
adjudication input has 20 rows and `counted: true` only on these five.

*Label note (documented, not blocking):* the mapping's
`not_counted_reason` for `c-17-with-2` reads "a 'with' slot sent 0 skills".
That is the failure-path recording gap described in the evidence README. The
slot view shows `skills_block` empty, but `skill_fingerprint` is
`18efa866…`, the frozen *with* value, and the input was 1,142 tokens, equal
to `c-17-with-1`. The slot is uncounted either way.

## 3. Judgment copies: PASS

Four copies per adjudicator were compared after parsing:

- `private/judgments/<name>.json`;
- archive `adjudication/judgments/<name>.json`;
- repository `judgments/<name>.json`;
- `judgment-<A|B>-original.json`, which is byte-identical to the
  repository's `original-<name>.json`.

For each adjudicator, `packet_sha256`, every `case_id`, `detected`,
`finding_refs` and `reason` are identical across all four. The only field
that differs is `adjudicator`: `"Technical Reviewer A"` in the originals and
`"Technical-Reviewer-A"` in the registered copies (B likewise). The files
also differ in whitespace layout, so they are not byte-equal. The private
copies are byte-identical to the published ones.

Verdicts, identical for A and B:

| Case | Verdict | Findings cited |
| --- | --- | --- |
| 22da25c10c26 | no | f1, f2 |
| 6f8d3ce292a9 | no | f1 |
| 733ced5c04a6 | no | — |
| abd44b7d77f7 | no | f1, f2 |
| b178165d828f | **yes** | f1, f2, f7 |

## 4. Rules-file hash: PASS

`sha256sum docs/homework/L02/prereg/rules-20261030.json` gives
`bb8fb1d080708bb98b057737316e90f6e78237637bc05961d0394cf9b9737a6a`. The
manifest `manifest-20261031-v3.json` gives `47c58433…5d5b`, which equals the
packet binding.

## 5. Blinding compromise: PASS

The `blinding_warnings` in `mapping.json` are
`[{case-6f8d3ce292a9, f1, "skill"}, {case-6f8d3ce292a9, f1, "breaking-change"}]`.
`report.json` has `blinding_compromised: true`. `report.md` lists both terms,
and so does the evidence README. The leaking sentence is in the public
packet: "…per the breaking-change skill…".

## 6. Provenance and charges: PASS (nuance)

- **Completed slots (5).** Router metadata shows exactly one available and
  selected endpoint, DeepInfra `deepseek/deepseek-v4-flash-20260423`
  (`attempt: 1`, region AMS, not BYOK). The generation record is `found`,
  with `providerName` DeepInfra and exactly one `providerResponses` entry
  (DeepInfra, HTTP 200, endpoint `934a69f9…`). Routing is
  `only`/`order` = `deepinfra/fp8` with fallbacks off.
- **Failed slot.** Its router metadata names DeepInfra, but the generation
  lookup is `not_found`. Provenance rests on the router metadata alone, which
  is why the runner report marks it "unverified".
- **Sums.** All six slots sum to **$0.00234162**: the confirmatory phase
  total, the ledger `spent` for that phase, and the key-usage rise
  ($0.00679428 − $0.00445266). The five completed slots alone sum to
  $0.00151884. The failed slot's $0.00082278 equals 1,142 × 9e-8 + 4,000 ×
  1.8e-7: a full 4,000-token completion was billed.

## 7. Truncated slot not scored: PASS

`c-17-with-2` has `counted: false`, `case_id: null` and no case in the
packet. The adjudicated tally counts 1 *with* and 2 *without* slots for #17.
The attempt shows `finishReason: length` and `outcome: truncated`. The
`raw_output` field is empty, so the truncated text was discarded. Nothing
could have been scored from it.

## 8. No replacement, retry or later call: PASS

- **Ledger.** Exactly 6 distinct `c-*` slot IDs and 0 events after
  `2026-10-31T18:36:34.239Z`. The last ledger event is the `c-17-with-2`
  failure at 18:36:26.819Z.
- **Authorizations.** The last event in `authorizations.jsonl` is the
  `hw2f-19ef1f13` revoke at 18:36:34.239Z. No authorization follows it.
- **Exports and logs.** The `agent_runs` export holds 6 runs.
  `clicks.log` shows one click per armed slot. `run.log` ends with "STOPPED"
  and "runner finished/stopped before slot 7".
- **Key usage.** The only later `key-usage.jsonl` entry is the settlement at
  18:38:13Z.

## 9. Phase 1 kept separate: PASS

The `x-*` slots are `phase: exploration` on other stacks (`hw2f-7d16304f`,
`hw2f-cc928441`). No `x-` ID appears in `adjudication-input.json`,
`packet.json`, `mapping.json`, `report.json` or the runner `report.md`. The
adjudication design holds only the 20 `c-*` slots. Exploration spend
($0.01404478 conservative) stays separate from confirmatory spend
($0.00234162) in the budget phases.

## 10. `verify` is read-only and the record is intact: PASS

**Code read first.** In `server/src/experiments/hw2/adjudication-cli.ts`,
`main` resolves `--dir` without creating it. The `verify` branch calls only
`verifyRecord(dir)` and then `log`. `verifyRecord` uses only `readFileSync`
(through `readJson` and `seals()`), `existsSync` and `readdirSync`, plus the
pure `digest` and `sealJudgment` from `adjudication.ts`. The module imports
`node:crypto` and `rules.js`, a pure module. Nothing on that path writes,
appends or changes permissions.

**Run.** `pnpm exec tsx src/experiments/hw2/adjudication-cli.ts verify
--dir ~/.devdigest/hw2-experiments/itemb-v3-20261031/adjudication` printed
`record intact` with exit 0. The sha256 of every file in the directory was
the same before and after. An `ls -laR --full-time` listing hashed the same
before and after (`0c9554b0…`), so no mtime or mode changed.

**Archive integrity.** `sha256sum -c SHA256SUMS` passed on all 51 lines, and
`SHA256SUMS` itself hashes to `a47daf86…35b1`, as the README states.
Several archive files are byte-identical to their repository copies:

- `run.log`, `clicks.log`, `authorize.log`, `revoke.log`, `settle.log` and
  `report.md` match the committed `*-log.txt` files and `runner-report.md`;
- `digests.json`, `packet.json`, `report.json`, `report.md` and
  `seals.jsonl` match the committed adjudication copies.

## Observations outside the ten checks

- **The two token families in the trace are different tokenizers.** The
  attempt's `tokensIn`/`tokensOut` (response `usage`) are what was billed:
  cost equals tokens × price exactly for all six slots. The generation
  record's `tokensPrompt`/`tokensCompletion` are OpenRouter's normalized
  `tokens_prompt`/`tokens_completion`. The successor draft explains this in
  Part 2. Any public statement of "tokens" should name which family it
  uses. EXPERIMENTS.md's Phase 1 tables call the generation counts "Tokens
  (generation metadata)" and the usage counts "router reported", which is
  correct.
- **The failure path discards the evidence needed to diagnose a
  truncation.** It keeps neither the raw text nor the assembled prompt; see
  the README's "Failure-path trace limitation". This is the main evidence
  limit for Part 2.
