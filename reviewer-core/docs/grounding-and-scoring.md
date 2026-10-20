# Grounding and scoring

Two deterministic gates stand between the model's answer and what the studio
shows. **Grounding** decides which findings survive; **scoring** turns the
survivors into the number on screen. Neither one trusts the model's own
claims.

## Grounding

[`src/grounding.ts`](../src/grounding.ts) runs once per review, after the
reduce step (`review/run.ts:254`), against the full diff.

1. **Index the diff:** `buildLineIndex` (`grounding.ts:24`) maps each file
   path to the set of **new-side** line numbers its hunks cover. It uses each
   hunk's `newLineNumbers`, or falls back to the hunk's declared new range
   (`newStart` … `newStart + newLines - 1`).
2. **Judge each finding** (`groundFindings`, `grounding.ts:52`):

   | Case | Result | Dropped reason |
   | --- | --- | --- |
   | `file` is not in the diff | Dropped | `file '<path>' not present in diff` |
   | `kind` is a full-file kind: `secret_leak`, `lethal_trifecta`, `phantom`, or `hook` | Kept if the file is in the diff, at any line | — |
   | Any line in `[start_line, end_line]` (either order) is a new-side hunk line | Kept | — |
   | Otherwise | Dropped | `lines <a>-<b> do not intersect any diff hunk in '<path>'` |

3. **Summarise:** `groundingSummary` returns `"<kept>/<total> passed"`. The
   studio stores it on the run and in the trace stats, and emits every
   dropped finding into the live log, so nothing disappears silently.

What grounding does **not** do:

- check that the rationale is true;
- merge duplicate findings from map-reduce chunks;
- move a finding to the nearest changed line.

A finding that cites an unchanged line in a changed file is dropped, even if
the issue is real.

## Score

`scoreFromFindings` ([`src/review/reduce.ts:27`](../src/review/reduce.ts))
starts from 100 and subtracts a penalty per **grounded** finding, clamped to
0–100:

| Severity | Penalty | One finding alone gives |
| --- | --- | --- |
| CRITICAL | 35 | 65 |
| WARNING | 12 | 88 |
| SUGGESTION | 3 | 97 |

No findings score 100, whatever the model said. The model's self-reported score
drifts between models, so it is discarded: `reduceReviews` still averages it
across chunks, but the final outcome replaces it with the computed score
(`run.ts:265`).

## Verdict and blockers

- **Verdict:** the model's `verdict` survives grounding. Across map-reduce
  chunks the worst one wins (`reduceReviews`). It is shown as the run's verdict
  banner but drives no gate.
- **Blockers:** gates use these instead. `countBlockers`
  ([`src/output/to-review.ts`](../src/output/to-review.ts)) counts grounded
  findings at or above the agent's `ci_fail_on` severity:
  - `never`: nothing counts.
  - `critical`: only Critical findings count.
  - `warning`: Warning or worse counts.
  - `any`: every finding counts.

  The studio's Timeline badge and blocker count come from this number, not from
  the verdict.

## Tests

- `test/run.test.ts`: a hallucinated finding on line 999 is dropped, the kept
  finding survives, and a clean approve scores 100.
- `test/to-review.test.ts`: the `countBlockers` and gate policies.
- Server integration (`server/test/reviews.it.test.ts`): grounding end to end
  through `POST /pulls/:id/review`.
