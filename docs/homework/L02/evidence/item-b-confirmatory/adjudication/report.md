# HW2 sealed adjudication report

- packet SHA-256: `9e798175776c0ed7e4eb3b13cc4b4044e720c90d00e80abc837e0a07e8512cc0`
- mapping SHA-256: `debdab0548f8579764c96a27c08315b0f1df0b058371d0903c973a1d4550cd58`

## Seal order

- 2026-10-31T18:38:21.802Z digests
- 2026-10-31T18:39:33.961Z register Technical-Reviewer-B `42753c0070e7dd0a49e7f7518ec4de3593fe97e3c6eec526be7b90db2518b9b4`
- 2026-10-31T18:39:34.572Z register Technical-Reviewer-A `4070f28aedf0049b1fb89624af4b0f3b7dd4b505994d6ba8ad3554b33070ccba`
- 2026-10-31T18:39:43.629Z reveal

## Result

| Experiment | With: detected / scheduled (ambiguous) | Without: detected / scheduled (ambiguous) | Outcome |
| --- | --- | --- | --- |
| 17 | 1 / 5 (0) | 0 / 5 (0) | incomplete — 4 with and 3 without scheduled slot(s) lack an unambiguous adjudicated verdict |
| 18 | 0 / 5 (0) | 0 / 5 (0) | incomplete — 4 with and 4 without scheduled slot(s) lack an unambiguous adjudicated verdict |

| Case | Slot | Condition | Final | Per adjudicator |
| --- | --- | --- | --- | --- |
| case-6f8d3ce292a9 | c-18-with-5 | with | no | Technical-Reviewer-B: no, Technical-Reviewer-A: no |
| case-733ced5c04a6 | c-18-without-5 | without | no | Technical-Reviewer-B: no, Technical-Reviewer-A: no |
| case-b178165d828f | c-17-with-1 | with | yes | Technical-Reviewer-B: yes, Technical-Reviewer-A: yes |
| case-abd44b7d77f7 | c-17-without-1 | without | no | Technical-Reviewer-B: no, Technical-Reviewer-A: no |
| case-22da25c10c26 | c-17-without-2 | without | no | Technical-Reviewer-B: no, Technical-Reviewer-A: no |

Blinding compromised: yes
- case-6f8d3ce292a9 f1: "skill"
- case-6f8d3ce292a9 f1: "breaking-change"
