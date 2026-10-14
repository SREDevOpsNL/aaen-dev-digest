# L03 Intent Layer — preliminary review-quality and cost comparison

Preliminary evidence (n = 3 per variant), not a statistical result. Two runs on
2026-10-14 against the `l03/intent-layer` implementation: **run 1** with the
first scope policy, and **run 2** after rule 4 was reworded (see
[Run 2](#run-2--reworded-scope-policy)). The method below applies to both.

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

## Run 1 — first scope policy

### Results (mean [min–max])

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

### Observations

1. **Defect preservation — a regression signal under a misleading
   description.** A standalone hardcoded-key finding (CRITICAL, L4–6) appeared
   in 3/3 *misleading / without* runs but only 1/3 *misleading / with* runs. In
   the other two the key misuse was still reported as CRITICAL, but only as
   "key sent to / leaked to the callback URL"; the hardcoded secret itself was
   no longer a separate finding. With the honest description the key was
   flagged CRITICAL in 6/6 runs. A plausible cause is the scope policy's rule
   "report one finding per root cause", which can merge two distinct defects.
   Not proven at n = 3; needs a follow-up with a reworded policy. Run 2 is
   that follow-up.
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

## Run 2 — reworded scope policy

**Change.** Rule 4 of `INTENT_SCOPE_POLICY` (`reviewer-core/src/prompt.ts`) said
"An out-of-scope CRITICAL defect keeps CRITICAL severity: report one finding per
root cause". It now says to report each independently actionable defect as its
own finding even when defects share code, data or context, uses the hardcoded
secret and its exfiltration as the example of two findings, and allows merging
only for the same defect at the same lines. Severity preservation became its own
rule 5. The prompt without intent is unchanged (a test asserts byte identity).

**Exact findings for the two key defects**, classified by hand from each run's
finding titles. *Separate* means a standalone hardcoded-secret finding next to a
separate exfiltration finding; *merged* means one finding covers both; *missing*
means no finding names the hardcoded secret.

| Fixture / variant | Run 1 (first policy) | Run 2 (reworded policy) |
| --- | --- | --- |
| honest / without | separate ×3 | separate ×2; missing ×1 (only "secret key sent to arbitrary external server") |
| honest / with | separate ×2; merged ×1 ("hardcoded live Stripe secret key exfiltrated to arbitrary callback URL") | separate ×2; ×1 classifier failed, so reviewed without intent: separate |
| misleading / without | separate ×3 | separate ×2 (one run answered in Chinese; titles translated by hand); merged ×1 (one finding for the whole file) |
| misleading / with | separate ×1; missing ×2 (only "key sent / leaked to the callback") | separate ×2; missing ×1 (the run returned a single finding: "key sent to attacker-controlled callback URL") |

Every finding that named the secret or its exfiltration was CRITICAL in both
runs, and all 24 runs reported the exfiltration as CRITICAL, alone or merged.

**Summary metrics (run 2, mean [min–max])**

| Fixture / variant | Expected defects matched (of 6) | Findings | Unmatched | Review s | Review $ (3 runs) |
| --- | --- | --- | --- | --- | --- |
| honest / without | 3.67 [3–5] | 2.67 [2–3] | 0.00 | 18.2 [14.9–20.1] | 0.000755 |
| honest / with ¹ | 3.67 [3–4] | 4.33 [4–5] | 0.67 [0–2] | 21.9 [17.6–27.8] | 0.001344 |
| misleading / without | 3.67 [3–4] | 2.67 [1–4] | 0.00 | 23.9 [19.5–29.3] | 0.000865 |
| misleading / with | 3.33 [2–4] | 3.00 [1–4] | 0.00 | 19.2 [14.1–22.8] | 0.001210 |

¹ Includes the run whose classifier failed and which was reviewed without intent.

**Classifier:** 5/6 succeeded (16–27 s, about $0.0002 each, confidence `high`
×5). One honest-fixture derivation failed schema validation after its retry and
took 445 s; that batch was reviewed without intent, as designed. Across both
runs, 11/12 succeeded.

**Run-to-run drift (a confound).** The model's behaviour changed between the
runs even where the prompt did not. With the byte-identical prompt without
intent, reviews returned fewer findings (about 2.7 vs 5), ran faster (18–24 s vs
32–37 s), cost less per token, and reported 2,927 instead of 1,702 input tokens.
Token counts for one identical input also varied within run 2: the classifier
counted 835–870 tokens in five runs and 1,897 in one, and the without-intent
review counted 1,702 in the fallback run and 2,927 in the others. A change of
upstream provider behind OpenRouter's `deepseek/deepseek-v4-flash` is a
plausible cause, but the evaluation did not record the provider, so it is
unconfirmed; a later probe saw only one provider.

### Conclusion

- With the reworded rule, *misleading / with* kept a standalone hardcoded-secret
  finding in 2/3 runs (run 1: 1/3), the same rate as *misleading / without* in
  run 2 (2/3). In run 2 the with-intent variants did no worse than the
  without-intent ones on this question.
- **The regression is not shown to be resolved.** n = 3; the baseline itself
  drifted between runs (without intent fell from 3/3 to 2/3 on both fixtures);
  and the remaining miss in *misleading / with* came from a run that returned a
  single finding. The data fit the reworded rule helping, but they fit
  run-to-run variance equally well.
- Before enabling intent by default: repeat with more runs per variant, record
  the upstream provider and pin it (or test on a second model).

## Not covered

Severity accuracy beyond the key, duplicate detection, other fixtures and
models, more than three runs per variant, and provider pinning.
