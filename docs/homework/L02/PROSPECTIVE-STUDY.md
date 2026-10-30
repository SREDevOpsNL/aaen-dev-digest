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

## Freeze before any confirmatory request

Pre-register a committed, unmodified manifest containing the final
implementation revision and fingerprint, current user-message Skill placement,
all fixture patches and hashes, both reviewer prompts, Skill bodies and order,
source revision, requested model `deepseek/deepseek-v4-flash`, the sole
`deepinfra/fp8` endpoint, expected `DeepInfra` provider and served model
`deepseek/deepseek-v4-flash-20260423`, temperature zero, single-pass strategy,
repo-intel off, output cap 4,000, both retry counts zero, fallbacks off, exact
request fingerprints, scoring rules, randomization seed and fresh unused slot
IDs. Verify the cached L03 intent is absent on every run. The current source
is committed, but the final implementation and request fingerprints remain
unfrozen until criterion 14 is resolved and the free protocol corrections above
are implemented and verified.

The owner must approve the final manifest, complete reservation/ceiling and
the separate paid confirmatory execution. No previously authorized exploratory
capability may be reused.
