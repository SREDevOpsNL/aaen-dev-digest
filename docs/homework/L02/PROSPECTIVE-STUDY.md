# Prospective controlled-study proposal for criteria 17 and 18

**Status:** proposal only. No confirmatory model call or fixture, Skill or
prompt change is authorized by this document. The original Phase 1 attempts,
scores and provider records remain in [EXPERIMENTS.md](EXPERIMENTS.md).

## Why a new study is needed

Phase 1 did not satisfy either criterion. For #17 the with-Skill reviewer named
uncovered error branches but did not identify the expiry-equality boundary; the
without-Skill request received a 429 and produced no comparison. For #18 both
conditions flagged a route change, but their explanation focused on a renamed
placeholder. Executable fixture analysis shows the real compatibility defect:
existing requests containing a payment ID now look up a public reference and
return 404. A placeholder rename alone is not sufficient evidence of that
defect.

The fixture patches are retained. The current `rules.ts` predicate accepts an
anchor plus **any** keyword, so it cannot by itself establish the conjunction
required for #17 or distinguish #18's actual lookup-semantics break from a
placeholder-name claim. Prospective adjudication must use the technical rules
below, without changing the historical scores.

## Proposed design and threshold

Five randomized pairs per experiment means five scheduled with-Skill and five
scheduled without-Skill trials for each of #17 and #18: **20 requests total**.
This is a pragmatic repeatability study using the existing `rules.ts`
threshold (at least 4/5 with and at most 1/5 without). It has no formal power
calculation and must not be described as statistically significant. The rubric
still requires the actual missed-without/detected-with behavior; the numeric
threshold is an additional, predeclared stability check.

- **#17:** a grounded finding must explicitly identify both a missing test for
  an error branch and a missing test at the exact expiry-equality boundary
  (`now == expiresAt`). Generic “edge case” language does not count.
- **#18:** a grounded finding must identify that the published ID-based v1
  request now fails because lookup semantics changed to public references.
  Naming only `:id` → `:reference` receives no credit.

The adjudicator sees finding text, anchors and the executable ground truth but
not condition, prompt, Skill or run metadata. Judgments and reasons are locked
before conditions are revealed. Any compromised blinding is recorded.

## Every scheduled slot remains in the record

| Result | Treatment |
| --- | --- |
| Valid schema, one attempt, verified provider/model, clear finding | Score under the frozen rules. |
| 429, timeout or other infrastructure failure | Stop the schedule. Do not retry or replace the slot; retain unknown billing at the full reservation. Mark the affected comparison incomplete. |
| Truncation or schema failure | Keep the attempted slot. No structured reprompt; no favorable binary score. |
| Missing, ambiguous or conflicting provider/attempt evidence | Do not count as a verified trial. Preserve the reservation and mark incomplete. |
| Ambiguous finding or unresolved adjudicator disagreement | Report ambiguity and do not claim a pass. |
| Fingerprint, source, budget or isolation mismatch | Stop before dispatch when possible; preserve the frozen design while investigating. |

Five refers to **scheduled**, not surviving, trials per condition. There is no
automatic replacement sample.

## Provisional conservative budget, not spending approval

The last settled global ledger check after the authorized conventions
extraction showed $0.01381699 conservatively charged and zero unresolved
slots ($0.01116289 historical plus $0.00265410 confirmed extraction).
Frozen endpoint prices must be verified again before authorization. At the
currently recorded DeepInfra rates, $0.00000009 per input token and $0.00000018 per output token, with no
request fee, an upper bound of 16,000 input tokens, a 4,000 output-token cap,
one request and a 1.5× contingency gives:

```text
(16,000 × 0.00000009 + 4,000 × 0.00000018) × 1.5
= $0.00324 per request
```

The existing additional 20% margin requires $0.003888. A $0.005 reservation
per slot provides that margin; 20 slots reserve **$0.10000000**. With the
completed extraction included and no later spend, the provisional minimum
cumulative ceiling is **$0.11381699**. Recompute the ledger, provider
prices and key limit before requesting confirmatory authorization. The
existing $0.50 exploration, $1.00 confirmatory and $1.50 aggregate caps remain hard
bounds.

## Free protocol corrections before preregistration

The unpaid fixture-ground-truth test in
`server/test/hw2-fixture-ground-truth.test.ts` executes the coupon source
reconstructed from the seeded patch at the four boundary/error cases. It
executes the patched payment route against a stub lookup, showing that an old
ID URL still matches but gets 404 when ID and public reference differ.
These checks validate the fixture semantics; they do not score model responses
or establish Skill efficacy.

### Condition-blinded technical adjudication

For each completed slot, an evidence preparer exports only the finding text,
grounded file/line anchors, experiment number and an opaque randomly assigned
case ID. The preparer keeps the case-ID-to-slot mapping private and hashes both
the blinded packet and mapping before adjudication. The packet must not contain
slot ID, run ID, condition, Skill block, prompt, cost, sequence or trace URLs.
If finding wording itself reveals the condition, record compromised blinding.

Two adjudicators independently apply the exact #17 and #18 technical rules
above. For each case they record detection (yes, no or ambiguous), which
grounded finding supports it, and a short reason. They sign and hash their
judgments before the preparer reveals the mapping. Resolve disagreements
against the frozen rule without access to condition; unresolved disagreement
remains ambiguous. Publish the sealed packet digest, mapping digest, judgments,
reconciliation and reveal order with the final report. A missing packet,
judgment or seal blocks a passing conclusion. This procedure is prospective:
no Phase 1 case is rescored.

**Implementation (2026-10-30, unpaid).** `server/src/experiments/hw2/adjudication.ts`
implements this procedure as pure functions over the report's counted slots:

- `preparePacket` gives each counted slot a random opaque case ID and exports
  only finding title, rationale, file and lines, sorted by case ID. Slot,
  run, condition, Skill block, severity, cost and schedule order stay out of
  the packet. Uncounted scheduled slots appear only in the private mapping,
  with their reason. Finding wording that names the Skill mechanism or a
  target Skill is listed in the mapping as compromised blinding.
- `sealJudgment` is the SHA-256 of a judgment's canonical JSON.
- `reveal` refuses the result if the packet, mapping or any judgment differs
  from its published digest, if there are not exactly two distinct
  adjudicators, if any case is unjudged, or if a `yes` cites no finding. A
  disagreement stays `ambiguous` unless a sealed reconciliation settles it,
  and a reconciliation may touch only disputed cases. An experiment reaches
  the 4/5 versus 1/5 rule only when every **scheduled** slot has an
  unambiguous verdict; otherwise it is `incomplete`.

`server/test/hw2-adjudication.test.ts` dry-runs prepare → seal → reveal on
synthetic slots only (9 tests). Removing the seal check, the ambiguity rule
or the scheduled-slot gap check each makes a test fail. Digests prove that a
record was not changed after its digest was published. They cannot prove the
order of publication, so the reveal order still has to be recorded by
timestamped publication of each digest. Who the two adjudicators are, and the
file-level CLI wrapper for this module, remain to be fixed in the frozen
manifest.

The confirmatory runner now stops after the first 429, infrastructure
failure, ambiguous result or unknown cost; its exploratory defaults remain
unchanged. The anchored keyword matcher remains a screening aid: the report
labels its result provisional and cannot emit a final success from it. It does
not prove the criterion 17 conjunction or criterion 18 lookup-semantics break.
A final outcome still needs a frozen, condition-blinded technical adjudication
record; missing or ambiguous judgments make the result incomplete. Before
accepting the proposed $0.005 reservation, preview all four conditions and
confirm each complete input upper bound is within that reservation at current
prices. Freeze and verify complete request hashes for every condition, as well
as the component fingerprints listed below.

### Frozen adjudication text

Adjudicators receive exactly this text in the blind packet (`TECHNICAL_RULES` and
`FIXTURE_GROUND_TRUTH` in `server/src/experiments/hw2/adjudication.ts`; a test fails
if the two differ). One line per experiment.

Rule #17:

```text
Detected only if one grounded finding (or findings together) explicitly identifies BOTH (a) a missing test for an error branch of applyDiscount (an expired coupon or an unknown code throwing) AND (b) a missing test at the exact expiry-equality boundary, now == expiresAt. Generic "edge case" or "more tests" wording does not count. Otherwise: no; if the text cannot be decided: ambiguous.
```

Ground truth #17:

```text
Fixture PR #501 (src/billing/discount.ts): applyDiscount succeeds before expiry; throws "Coupon expired" at exactly now == expiresAt and after it; throws "Unknown coupon" for an unknown code. The added tests exercise only the success path: no error branch and no expiry-boundary case is tested.
```

Rule #18:

```text
Detected only if a grounded finding identifies that existing v1 requests that use a payment ID now fail (404) because the lookup changed from payment ID to public reference. Naming only the :id to :reference placeholder rename, or a generic breaking-change claim, does not count. Otherwise: no; if the text cannot be decided: ambiguous.
```

Ground truth #18:

```text
Fixture PR #502 (src/api/payments.ts, src/payments/store.ts): the published route GET /v1/payments/:id becomes /v1/payments/:reference in place and its handler calls findPaymentByReference. An old ID URL such as /v1/payments/pay_123 still matches the new pattern, but the parameter is now looked up as a public reference, so an existing client calling it with a payment ID gets 404 where it got 200. The placeholder rename on its own changes nothing; the lookup change breaks clients.
```

## Freeze before any confirmatory request

Pre-register a committed, unmodified manifest containing the final
implementation revision and fingerprint, the **system-role** Skill placement
with the approved content digests, all fixture patches and hashes, both
reviewer prompts, Skill bodies and order, source revision, requested model
`deepseek/deepseek-v4-flash`, the sole `deepinfra/fp8` endpoint, expected
`DeepInfra` provider and served model `deepseek/deepseek-v4-flash-20260423`,
temperature zero, single-pass strategy, repo-intel off, output cap 4,000, both
retry counts zero, fallbacks off, exact request fingerprints, scoring rules,
randomization seed and fresh unused slot IDs. Verify the cached L03 intent is
absent on every run. Criterion 14 was resolved on 2026-10-30 (system-role
placement and an approval gate); the frozen manifest is below.

The owner must approve the final manifest, complete reservation/ceiling and
the separate paid confirmatory execution. No previously authorized exploratory
capability may be reused.

## Approval packet (2026-10-30)

**Status: frozen and awaiting the owner's explicit authorization. Nothing in
this section authorizes spending.** All values below were produced by free
commands (`check`, `preview`, `manifest`) on the persistent keyless stack;
no capability was issued and the global ledger stayed at 21 records.

### Source and stack

| Item | Value |
| --- | --- |
| Implementation commit | `23d0b48` (Skills in the system-role message + approval gate) on `homework/l02-mentor-submission` |
| Implementation fingerprint | `201ffa9ad50a91ae23dd2bab213823e492739dabb32f23aeb4f58d4fffd804cb` (blob ids of `server/src`, `reviewer-core/src`, lockfiles, `scripts/e2e.sh`) |
| Pre-registration | [`prereg/manifest-20261030.json`](prereg/manifest-20261030.json) (sha256 `0ed3b11d6655a537f5ca14dcead812b075efaad1a6468d69212a6a22a853f88b`), manifest fingerprint `728203fdf468659ece2fedabaa17ce74490533562656dc2449ba61b57f160f2a` |
| Screening rules (provisional only) | [`prereg/rules-20261030.json`](prereg/rules-20261030.json) (sha256 `bb8fb1d080708bb98b057737316e90f6e78237637bc05961d0394cf9b9737a6a`), anchored at the redesigned fixtures' lines; earlier drafts pointed at stale lines and are not used |
| Stack | `hw2f-1fe1aeec`, database `devdigest_hw2f_1fe1aeec`, container `devdigest-hw2f-1fe1aeec`, API `127.0.0.1:3251`, web `localhost:3250`, running in tmux session `hw2-freeze` (the manifest names this database; a different stack is refused) |
| Model / provider | `deepseek/deepseek-v4-flash`, sole endpoint `deepinfra/fp8`, expected provider `DeepInfra`, served model `deepseek/deepseek-v4-flash-20260423` |
| Settings | temperature 0, single-pass, repo-intel off, output cap 4,000, transport and structured retries 0, provider fallbacks off, one generation per slot |
| Prices (live 2026-10-30) | $0.00000009 input, $0.00000018 output per token, no request fee; context 1,048,576, max completion 65,536 |
| Key | dedicated key limit $2.00, usage $0.00422487, remaining $1.99577513 (unchanged since the last settlement) |

### Fixtures, Skills and system-message composition

| Exp. | Fixture | Diff sha256 | Reviewer (system prompt sha256) | Target Skill v1, approved body sha256 |
| --- | --- | --- | --- | --- |
| 17 | PR #501 | `8e0ba13345806d37f29233f6ba28057f52fd17c010ce0a482267b8cbc527d186` | Test Quality Reviewer (`8ad1660b08790d0506aebbfa2f2b7b69c5f130155edc31ca9771aae4fea6c3ad`) | Edge Cases and Error Paths, `82a7461ebbbe62468b147ed04fb2571b0bf7d8d1adeb794839739e77d48ed17f` (seed bootstrap, reviewed digest) |
| 18 | PR #502 | `db6475df8244efc5ef4a323a07bf0b1433abf0a6bc820ef2229dc409868116fc` | API Contract Reviewer (`234bd58a28dd2bd385dfda320407e095241282669084a5735a8d45492666c276`) | breaking-change, `0d3d2e49739250a4c085e9287f9d0c76e48d2158d8bbf0d08c17369a155c6770` (seed bootstrap, reviewed digest) |

Treatment (`with`): system message = reviewer instructions → `## Skills /
rules` with exactly the target Skill fenced as `skill-0` → injection guard.
Control (`without`): system message = reviewer instructions → injection
guard; no Skill section anywhere. The user message is identical across
conditions.

### Request fingerprints (all four conditions)

| Condition | Prompted Skills | Non-Skill fingerprint | Skill fingerprint | Input bound | Worst case ×1.5 |
| --- | --- | --- | --- | --- | --- |
| 17 with | Edge Cases and Error Paths | `c6010d90c44151bb6cc144d21cdbd9493dab1947cbf40e5791860c9a71d1a860` | `18efa8660db55161b35cb59dc198210af01a90d2eccf607ca542f2d55c3d83f2` | 9,474 | $0.00235899 |
| 17 without | — | `c6010d90c44151bb6cc144d21cdbd9493dab1947cbf40e5791860c9a71d1a860` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 8,967 | $0.00229054 |
| 18 with | breaking-change | `e72553e45551e83d63d5cda58aafb8c40dcdbb2edb4b6c64d7cdd112b07b479c` | `03214820cdbc9c3cda85f055c23adf337bcc5abdfa341c795ba62039d9f95136` | 10,921 | $0.00255433 |
| 18 without | — | `e72553e45551e83d63d5cda58aafb8c40dcdbb2edb4b6c64d7cdd112b07b479c` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 8,879 | $0.00227867 |

Full values are in the manifest and the private preview files
(`~/.devdigest/hw2-experiments/freeze-20261030/`). Each slot's server
recomputes both fingerprints and refuses on any difference. The largest
worst case × the 1.2 reservation margin is $0.00306520, below $0.005.

### Schedule (seed 20261030, five pairs per experiment)

`c-18-with-5`, `c-18-without-5`, `c-17-with-1`, `c-17-without-1`,
`c-17-without-2`, `c-17-with-2`, `c-17-with-5`, `c-17-without-5`,
`c-18-without-1`, `c-18-with-1`, `c-18-without-3`, `c-18-with-3`,
`c-17-without-4`, `c-17-with-4`, `c-17-with-3`, `c-17-without-3`,
`c-18-with-2`, `c-18-without-2`, `c-18-with-4`, `c-18-without-4`.
None of these IDs exists in the global ledger.

### Spending items (each needs its own explicit approval)

| Item | Slots | Max per call | Reservation | Cumulative ceiling after it |
| --- | --- | --- | --- | --- |
| A. #14 trace-only run (exploration, operator links: semver-discipline → breaking-change, response-schema switched off; Skill fingerprint `b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6`, input bound 12,588, worst case $0.00277938) | `x-18-with-3` | $0.005 | $0.005 | $0.01881699 |
| B. Confirmatory #17/#18 | the 20 slots above | $0.005 | $0.10000000 | $0.11881699 with A, $0.11381699 without |

Starting ledger: $0.01381699 conservative ($0.00381699 confirmed + $0.01 held
for `x-17-without-1`), no unresolved slot, no live capability. Hard caps
($0.50 exploration, $1.00 confirmatory, $1.50 aggregate) are unchanged.
Capability lifetime: 3 hours per item; revoked after the item.
Manual action: for each slot, when the runner prints "armed", one **Run
Review** click for the named agent on the PR page (criterion interpretation
A5); 1 click for A, 20 for B.

### Failure, settlement and reconciliation

- Reservation is fsynced before dispatch; a crash leaves the slot unresolved
  and it is charged at its full reservation until `reconcile`.
- Confirmatory: the first 429, timeout, infrastructure failure, truncation,
  schema failure, unknown cost or provenance mismatch **stops the schedule**.
  No retry and no replacement; the affected experiment is `incomplete`.
- After each item: `revoke`, then `settle` against the key's own usage
  (`PENDING` while usage moves, never a pass).
- `report --adjudication-input` exports the scheduled slots; the sealed
  adjudication below decides detection. Regex screening is provisional.

### Adjudication protocol

`adjudication-cli.ts prepare` → two independent adjudication sessions →
`register` each → `disputed` → optional sealed `reconcile` → `reveal`. Each
adjudicator is a separately started Claude Code subagent with an isolated
context ("Technical Reviewer A" and "Technical Reviewer B" are role labels,
not human identities); its agent/session ID and model are recorded beside
its sealed judgment. Each receives only `packet.json` (finding text, anchors,
the frozen rules and ground truth above) and the judgment format; never the
condition, slot or run IDs, Skill bodies, prompts, the mapping or earlier
outcomes. Unresolved ambiguity makes the experiment `incomplete`.

### Status of the spending items (2026-10-31)

- **Item A: approved and executed.** One trace-only slot `x-18-with-3` ran
  at $0.00022779; the capability was revoked and settlement passed. It is
  exploration and trace evidence for #14, #19 and #20 only, never a
  confirmatory observation. See
  [criterion-14-system-role.md](evidence/criterion-14-system-role.md#live-system-role-run-trace-item-a-2026-10-31).
  Ledger after it: $0.01404478 conservative ($0.00404478 confirmed + $0.01
  held for `x-17-without-1`). Key usage: $0.00445266 of $2.00.
- **Item B: not authorized.** No confirmatory slot exists in the ledger.
- **The frozen manifest no longer matches a running stack.** A host restart
  on 2026-10-31 at 11:03 destroyed the disposable stack `hw2f-1fe1aeec`, and
  `manifest-20261030.json` names that stack's database. `run --phase
  confirmatory` compares the full manifest, so it would refuse on any other
  stack. A candidate re-freeze on the rebuilt stack `hw2f-cc928441` is in
  [`prereg/manifest-20261031.json`](prereg/manifest-20261031.json) (sha256
  `306fb0c9707726f4952437e90b594cbf7a3062026abbe9ba52fe2f3d1eeb325b`,
  manifest fingerprint
  `286d9db4fcdd6966df078df4e110d3a4db23e9194610760c822cae21809a1678`).
  Apart from `stack.database`, it is byte-identical to the frozen manifest:
  same implementation and non-Skill fingerprints, fixtures, Skill digests,
  rules, seed, schedule and reservation. The re-freeze is a candidate only:
  item B needs a fresh explicit approval naming it. Its ceilings are
  $0.10000000 reserved, cumulative $0.11404478 after the executed item A. A
  later restart would again require a re-freeze before item B.

## Approval packet v3 (2026-10-31)

The owner authorized item B on 2026-10-31. The run stopped before any
capability existed, because the first freeze could not be read and no longer
matched ([audit record](evidence/item-b-predispatch-halt.md)). That
authorization has lapsed. This packet replaces the candidate re-freeze above.
**Nothing in it is authorized until the owner approves it.** The study
design, the frozen adjudication text, the fixtures, the target Skills, the
seed and the schedule are unchanged. Only the implementation (deterministic
manifest, fail-closed authorize) and the stack are new.

### Bindings

| Item | Value |
| --- | --- |
| Implementation commit | `2799caf` on `homework/l02-mentor-submission` (PR #53, Draft) |
| Implementation fingerprint | `fa59aa4c7ad29913eec12b055a47e0a9c8399d55fbfd964b0b3b9888a6de81ad` |
| Pre-registration | [`prereg/manifest-20261031-v3.json`](prereg/manifest-20261031-v3.json), committed in `c539cc0`, written unchanged by `cli.ts manifest --out` |
| Pre-registration sha256 | `47c58433ce0da6ee8367d758a3f3ff2db3a61a2513f7ffb494809b2bb29f5d5b` |
| Manifest version / fingerprint | 3 / `2f13ad1ce7f5ad5bfcf3b90d2ecd4cb0ba78cd3ad61eb4499da43627684d79d5` |
| Read-back through the runner path | `cli.ts prereg-check --prereg docs/homework/L02/prereg/manifest-20261031-v3.json --rules docs/homework/L02/prereg/rules-20261030.json`: "pre-registration matches … 20 slots, seed 20261030"; "no scheduled slot is in the ledger" |
| Screening rules (provisional) | [`prereg/rules-20261030.json`](prereg/rules-20261030.json), unchanged, sha256 `bb8fb1d080708bb98b057737316e90f6e78237637bc05961d0394cf9b9737a6a` |
| Stack | `hw2f-19ef1f13`, database `devdigest_hw2f_19ef1f13`, container `devdigest-hw2f-19ef1f13` (Postgres 127.0.0.1:5450, ephemeral), API `127.0.0.1:3251`, web `localhost:3250`, tmux session `hw2-freeze`; identity and isolation checks pass |
| Model / provider | `deepseek/deepseek-v4-flash`; sole endpoint `deepinfra/fp8`, provider name `DeepInfra`, served model `deepseek/deepseek-v4-flash-20260423`; fallbacks off |
| Settings | temperature 0, single-pass, repo-intel off, output cap 4,000 tokens, transport and structured retries 0, one generation per slot |
| Pricing | frozen $0.00000009 input, $0.00000018 output per token, $0 per request; the live DeepInfra endpoint showed the same on 2026-10-31 |
| Reviewers (frozen) | API Contract Reviewer (prompt `234bd58a…c276`) and Test Quality Reviewer (prompt `8ad1660b…c3ad`); both enabled, provider `openrouter`, output schema `74234e98…b90b` |
| Target Skills (frozen) | Edge Cases and Error Paths, body `82a7461ebbbe62468b147ed04fb2571b0bf7d8d1adeb794839739e77d48ed17f`; breaking-change, body `0d3d2e49739250a4c085e9287f9d0c76e48d2158d8bbf0d08c17369a155c6770`; both enabled, approved, version 1 |
| Fixtures | PR #501 diff `8e0ba13345806d37f29233f6ba28057f52fd17c010ce0a482267b8cbc527d186`; PR #502 diff `db6475df8244efc5ef4a323a07bf0b1433abf0a6bc820ef2229dc409868116fc` |

### Request fingerprints (free previews, phase confirmatory)

They are identical to the 2026-10-30 packet, because the correction does not
touch prompt assembly.

| Condition | Prompted Skills | Non-Skill fingerprint | Skill fingerprint | Input bound | Worst case ×1.5 |
| --- | --- | --- | --- | --- | --- |
| 17 with | Edge Cases and Error Paths | `c6010d90c44151bb6cc144d21cdbd9493dab1947cbf40e5791860c9a71d1a860` | `18efa8660db55161b35cb59dc198210af01a90d2eccf607ca542f2d55c3d83f2` | 9,474 | $0.00235899 |
| 17 without | — | `c6010d90c44151bb6cc144d21cdbd9493dab1947cbf40e5791860c9a71d1a860` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 8,967 | $0.00229054 |
| 18 with | breaking-change | `e72553e45551e83d63d5cda58aafb8c40dcdbb2edb4b6c64d7cdd112b07b479c` | `03214820cdbc9c3cda85f055c23adf337bcc5abdfa341c795ba62039d9f95136` | 10,921 | $0.00255433 |
| 18 without | — | `e72553e45551e83d63d5cda58aafb8c40dcdbb2edb4b6c64d7cdd112b07b479c` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 8,879 | $0.00227867 |

The largest worst case × the 1.2 reservation margin is $0.00306520, below
$0.005.

### Schedule (seed 20261030, unchanged)

`c-18-with-5`, `c-18-without-5`, `c-17-with-1`, `c-17-without-1`,
`c-17-without-2`, `c-17-with-2`, `c-17-with-5`, `c-17-without-5`,
`c-18-without-1`, `c-18-with-1`, `c-18-without-3`, `c-18-with-3`,
`c-17-without-4`, `c-17-with-4`, `c-17-with-3`, `c-17-without-3`,
`c-18-with-2`, `c-18-without-2`, `c-18-with-4`, `c-18-without-4`.
None of these 20 IDs is in the global ledger.

### State before any decision

- Ledger: 24 records, sha256 `dc05246859d66817…`. $0.01404478 is charged
  conservatively: $0.00404478 confirmed plus $0.01 held for `x-17-without-1`.
  No unresolved slot.
- No live capability on any stack. The last authorization event is the item
  A revoke.
- Key: usage $0.00445266 of a $2.00 limit, $1.99554734 remaining, read live
  without recording. That equals the last settlement.

### Exact authorization requested (item B v3)

| Value | |
| --- | --- |
| Gate / phase | Gate 4, confirmatory |
| Calls | at most the 20 scheduled slots above, in the frozen order, one Run Review click each |
| Per-slot reservation | $0.005 |
| New reservations (capability budget) | $0.10000000 |
| Cumulative conservative ceiling | $0.11404478 |
| Capability lifetime | 3 hours; revoked after the schedule |
| Retries, reprompts, fallbacks, replacements | none; the first infrastructure, provenance, truncation, schema or 429 failure stops the schedule and leaves the experiment `incomplete` |

The commands, with the stack flags added:

```bash
cli.ts authorize --phase confirmatory --authorized-gate 4 --confirm-spend --budget 0.10 --ceiling 0.11404478 --hours 3 --prereg ../docs/homework/L02/prereg/manifest-20261031-v3.json --rules ../docs/homework/L02/prereg/rules-20261030.json
cli.ts run --phase confirmatory --authorized-gate 4 --confirm-spend --via-ui --prereg ../docs/homework/L02/prereg/manifest-20261031-v3.json --rules ../docs/homework/L02/prereg/rules-20261030.json
```

`authorize` refuses before writing a capability, and `run` refuses before
the first slot, unless the live manifest equals this file. Then `revoke` and
`settle` follow. After that comes `report --adjudication-input`, then the
sealed adjudication with two independent sessions as specified above.

### Item B v3 outcome (2026-10-31)

The owner authorized item B v3 as packaged. Every binding matched when
rechecked immediately before authorization. The schedule then stopped on its
sixth slot, `c-17-with-2`, whose response reached the 4,000-token output cap.
No retry or replacement followed.

- 5 slots completed, 1 failed, 14 not dispatched.
- $0.00234162 spent; settlement PASS.
- Sealed blinded adjudication, two agreeing adjudicators:
  - #17: 1/5 *with* versus 0/5 *without*, **incomplete**.
  - #18: 0/5 versus 0/5, **incomplete**.

This study is closed as incomplete. Running the missing slots would need a
new pre-registration and a new owner decision. Full record:
[evidence/item-b-confirmatory/README.md](evidence/item-b-confirmatory/README.md).
