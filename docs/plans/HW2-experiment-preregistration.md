# HW2 controlled experiments — pre-registration (TEMPLATE, not frozen)

Status: **template**. It becomes the pre-registration only when every field below is
filled from Gate 3 evidence and the file is committed before any confirmatory run
(`cli.ts run --phase confirmatory` refuses an uncommitted or modified file, or a
manifest that does not match the current stack, code and content).

## Hypotheses (criteria 17 and 18)

| Experiment | Fixture | Reviewer | Target skill | Without | With |
| --- | --- | --- | --- | --- | --- |
| 17 | PR #501 (coupon discount, happy-path-only test) | Test Quality Reviewer | Edge Cases and Error Paths | no skills linked | only the target skill |
| 18 | PR #502 (v1 `amount_cents` → `amount`) | API Contract Reviewer | breaking-change | no skills linked | only the target skill |

## Frozen inputs (from Gate 3)

- Implementation fingerprint (from `cli.ts manifest`; not `HEAD`, so committing this file does not invalidate it):
- Frozen non-Skill fingerprints per experiment (from the free preview):
- Commit of this file (informational):
- Provider routing slug / serving display name / served model:
- Endpoint (tag, quantization) where identifiable:
- Prices (USD per input token, per output token, per request) and retrieval time:
- Context length / max completion tokens:
- Output cap (`max_tokens`):
- Temperature: 0 · SDK retries: 0 · structured reprompts: 0 · strategy: single-pass · repo intel: off
- Generation lookup policy:
- Per-slot reservation (USD) — must satisfy 20 × reservation ≤ 1.00:

## Expected-finding rules (written before any counted run)

`rules.json` (anchors from `server/src/db/seed-fixtures.ts`, keyword predicates):

```json
{
  "17": { "anchors": [], "keywords": [] },
  "18": { "anchors": [], "keywords": [] }
}
```

## Schedule

- Seed:
- 20 slots (2 experiments × 2 conditions × 5), balanced, randomized; order printed by `cli.ts plan --seed <seed>`.

## Success rule and analysis

- Per experiment: success when with-skill detections ≥ 4 / 5 **and** without-skill ≤ 1 / 5, counting only strict single-generation evidence; fewer than 5 counted slots per condition is *incomplete*; otherwise *negative* (with ≤ without) or *inconclusive*.
- Failed, excluded, incomplete and unverified slots are reported, never replaced. A new round needs a new pre-registration.

## Stop conditions

Budget (0.50 / 1.00 / 1.50), a guard refusal, 2 consecutive slots with unknown cost, 3 consecutive infrastructure failures, any provider/model/intent/fingerprint/diff/isolation mismatch.

## Confirmations

- OpenRouter key spending limit set by the user (Gate 2): (date, limit)
- Authorization for Gate 4: (date)

## Manifest

```json manifest
{ "status": "template — replace with the output of cli.ts manifest" }
```
