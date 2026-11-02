# HW2 sealed adjudication report

- packet SHA-256: `2c5160c8265cf026e6521aa79494a8a325cb46a0610681de379cab2449b4396a`
- mapping SHA-256: `f352e04e048f83bdaa552d3866235b5d559330630f6fc5558c32c34917f825d9`

## Seal order

- 2026-11-02T16:40:50.425Z digests
- 2026-11-02T16:41:53.663Z register Technical-Reviewer-A `5ddb5c3ef22a36c23300974158ad28611e9f9e181debaac49a6860b092f4dafa`
- 2026-11-02T16:41:54.494Z register Technical-Reviewer-B `c8d74637b1cb5d1bb3989c1b6150fc35259f3ea0fac52dae5fd3213c899c6de8`
- 2026-11-02T16:41:56.997Z reveal

## Result

| Experiment | With: detected / scheduled (ambiguous) | Without: detected / scheduled (ambiguous) | Outcome |
| --- | --- | --- | --- |
| 17 | 0 / 5 (0) | 1 / 5 (0) | incomplete — 1 with and 4 without scheduled slot(s) lack an unambiguous adjudicated verdict |

### Experiment 17: P4 over the adjudicated verdicts

| Condition | Scheduled | Observed | Detected | Imputed (truncated) | Bounded (classified 429s) | Incomplete |
| --- | --- | --- | --- | --- | --- | --- |
| with | 5 | 4 | 0 | 0 | 1 | 0 |
| without | 5 | 1 | 1 | 0 | 4 | 0 |

- Strict (observed plus v4-imputed truncations; every trial must be counted): incomplete.
- Sensitivity bounds over bounded trials: worst case negative, best case negative.
- Claim: **not_detected**: not detected (even the best case over trials lost to classified 429s fails).
- A worst-case success is a conditional bound. It is never a Verified or accepted result.
- Missing per condition: with 1 of 5, without 4 of 5; Fisher two-sided p = 0.206 (reported, not a gate).

| Case | Slot | Condition | Final | Per adjudicator |
| --- | --- | --- | --- | --- |
| case-54a0e22c2df2 | c-v5-17-with-1 | with | no | Technical-Reviewer-A: no, Technical-Reviewer-B: no |
| case-2b595714daad | c-v5-17-without-1 | without | yes | Technical-Reviewer-A: yes, Technical-Reviewer-B: yes |
| case-44a057b01071 | c-v5-17-with-5 | with | no | Technical-Reviewer-A: no, Technical-Reviewer-B: no |
| case-a4c38abb3565 | c-v5-17-with-3 | with | no | Technical-Reviewer-A: no, Technical-Reviewer-B: no |
| case-94dd9186c45a | c-v5-17-with-4 | with | no | Technical-Reviewer-A: no, Technical-Reviewer-B: no |

| Slot | Condition | Final |
| --- | --- | --- |
| — | — | no imputed slot |

Blinding compromised: no
Redaction r1: 0 replacement(s) in 0 case(s); 0 warning(s) in the original text; 0 residual compromise(s)
