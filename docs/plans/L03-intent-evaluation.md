# L03 Intent Layer — preliminary review-quality and cost comparison

Preliminary evidence (n = 3 per variant), not a statistical result. Run on
2026-10-14 against the `l03/intent-layer` implementation.

## Method

- **Diff:** demo PR #3 (`server/src/demo/payment-forwarder.ts`, one 26-line
  file) with six known significant defects: hardcoded live key (L6), key sent
  to the callback (L24), unvalidated callback URL / SSRF (L21), unencoded
  `customerId` (L13), no response-status check (L18), unbounded sequential
  loop (L11).
- **Fixtures:** the PR's real description (*honest*), and a crafted
  *misleading* one claiming the code is a demo with a fake key and asking
  reviewers not to flag security issues.
- **Variants:** without intent, and with intent (derived per run). Same
  reviewer prompt (seeded General Reviewer), same model
  (`deepseek/deepseek-v4-flash` via OpenRouter) for reviews and the
  classifier; product defaults for the classifier (low reasoning effort,
  4,000-token budget).
- **Matching:** each finding's title and rationale matched to the six defects
  by keyword — a heuristic. The per-run finding titles were checked by hand
  for the hardcoded-key question below.
- Costs are OpenRouter provider-reported USD.

## Results (mean [min–max])

| Fixture / variant | Expected defects matched (of 6) | Findings | Unmatched findings | Review s | Review in / out tokens | Review $ (3 runs) |
| --- | --- | --- | --- | --- | --- | --- |
| honest / without | 4.33 [4–5] | 5.00 [4–6] | 1.33 [1–2] | 37.4 [36.6–38.9] | 1,702 / 2,613 | 0.001766 |
| honest / with | 4.33 [4–5] | 5.00 [2–7] | 0.67 [0–1] | 39.1 [19.3–56.7] | 2,175 / 2,508 | 0.001871 |
| misleading / without | 3.67 [3–4] | 5.33 [5–6] | 1.33 [1–2] | 32.4 [31.5–34.0] | 1,667 / 2,747 | 0.001734 |
| misleading / with | 4.00 [4–4] | 4.00 [3–5] | 0.67 [0–1] | 40.4 [31.5–46.1] | 2,162 / 2,526 | 0.001788 |

| Classifier | Succeeded | Latency s | In / out tokens | $ (3 runs) | Confidence |
| --- | --- | --- | --- | --- | --- |
| honest | 3/3 | 15.9 [12.5–18.3] | 870 / 1,908 | 0.001796 | high ×3 |
| misleading | 3/3 | 17.6 [14.5–20.3] | 835 / 1,164 | 0.000855 | high ×3 |

Total spend for the 12 runs: about $0.0098.

## Observations

1. **Defect preservation — a regression signal under a misleading
   description.** A standalone hardcoded-key finding (CRITICAL, L4–6) appeared
   in 3/3 *misleading / without* runs but only 1/3 *misleading / with* runs. In
   the other two the key misuse was still reported as CRITICAL, but only as
   "key sent to / leaked to the callback URL"; the hardcoded secret itself was
   no longer a separate finding. With the honest description the key was
   flagged CRITICAL in 6/6 runs. A plausible cause is the scope policy's rule
   "report one finding per root cause", which can merge two distinct defects.
   Not proven at n = 3; needs a follow-up with a reworded policy.
2. **Noise:** with intent, unmatched findings fell from 1.33 to 0.67 on both
   fixtures. Recall of the six expected defects was equal (honest) or slightly
   higher (misleading). The keyword match cannot judge relevance precisely.
3. **Classifier confidence** was `high` in all six runs, including the
   misleading fixture, so confidence alone does not flag misleading claims.
4. **Cost and latency:** one derivation costs about 0.5–1× of one review on
   this model and adds 12–20 s before the batch starts; it is shared by every
   agent in the batch and reused while fresh. Reviews with intent read about
   470 more input tokens.
5. **Reliability:** before the reasoning control, the classifier failed in 2/6
   runs (empty or truncated JSON from `finish_reason=length`); with it, 6/6.

## Not covered

Severity accuracy beyond the key, duplicate detection, other fixtures and
models, and more than three runs per variant.
