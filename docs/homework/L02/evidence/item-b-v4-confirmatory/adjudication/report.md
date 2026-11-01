# HW2 sealed adjudication report

- packet SHA-256: `c72cb047c07efee230c7278924ef9fea5fd322b18648e27ffec788e5d2a73400`
- mapping SHA-256: `6bd66b72bc8748d94fe7ccfd4646303d41b04874797739820b335c5b30c87c75`

## Seal order

- 2026-11-01T20:07:09.314Z digests
- 2026-11-01T20:08:08.408Z register Technical-Reviewer-A `531a9e9a01a0c21cce000ea37f9b2ca04f04eeff2b48cfdbdabda80458f0b7cc`
- 2026-11-01T20:08:09.191Z register Technical-Reviewer-B `12967210a1d7ac6bc3aab47d82c55e6765255b1e36e44784a0d15e1f8d9ad092`
- 2026-11-01T20:08:11.521Z reveal

## Result

| Experiment | With: detected / scheduled (ambiguous) | Without: detected / scheduled (ambiguous) | Outcome |
| --- | --- | --- | --- |
| 17 | 0 / 5 (0) | 0 / 5 (0) | incomplete — 5 with and 4 without scheduled slot(s) lack an unambiguous adjudicated verdict |

| Case | Slot | Condition | Final | Per adjudicator |
| --- | --- | --- | --- | --- |
| case-9acd58625433 | c-v4-17-without-2 | without | no | Technical-Reviewer-A: no, Technical-Reviewer-B: no |

| Slot | Condition | Final |
| --- | --- | --- |
| — | — | no imputed slot |

Blinding compromised: no
Redaction r1: 0 replacement(s) in 0 case(s); 0 warning(s) in the original text; 0 residual compromise(s)
