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

The read-only global ledger check on 2026-10-27 showed $0.01116289
conservatively charged and zero unresolved slots. Frozen endpoint prices must
be verified again before authorization. At the currently recorded DeepInfra
rates, $0.00000009 per input token and $0.00000018 per output token, with no
request fee, an upper bound of 16,000 input tokens, a 4,000 output-token cap,
one request and a 1.5× contingency gives:

```text
(16,000 × 0.00000009 + 4,000 × 0.00000018) × 1.5
= $0.00324 per request
```

The existing additional 20% margin requires $0.003888. A $0.005 reservation
per slot provides that margin; 20 slots reserve **$0.10000000**. If no
extraction or other spend occurs first, the resulting minimum cumulative
ceiling is **$0.11116289**. If extraction runs first, recompute the ledger,
provider prices and key limit and submit a revised ceiling. The existing
$0.50 exploration, $1.00 confirmatory and $1.50 aggregate caps remain hard
bounds.

## Freeze before any confirmatory request

Pre-register a committed, unmodified manifest containing the final
implementation revision and fingerprint, current user-message Skill placement,
all fixture patches and hashes, both reviewer prompts, Skill bodies and order,
source revision, requested model `deepseek/deepseek-v4-flash`, the sole
`deepinfra/fp8` endpoint, expected `DeepInfra` provider and served model
`deepseek/deepseek-v4-flash-20260423`, temperature zero, single-pass strategy,
repo-intel off, output cap 4,000, both retry counts zero, fallbacks off, exact
request fingerprints, scoring rules, randomization seed and fresh unused slot
IDs. Verify the cached L03 intent is absent on every run. The current source is
uncommitted, so no final implementation or request fingerprint is frozen yet.

The owner must approve the final manifest, complete reservation/ceiling and
the separate paid confirmatory execution. No previously authorized exploratory
capability may be reused.
