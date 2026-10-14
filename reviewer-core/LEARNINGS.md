# Learnings — reviewer-core

Review-engine guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Genuinely cross-package findings belong in
[`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-22** — Do not judge a prompt revision by fewer findings, lower cost,
  or citation grounding alone. On the same PR, General Reviewer version 2 cut
  findings from 8 to 4 and output tokens from 2,064 to 1,264, but lost three
  valid issues and introduced a false “missing await” finding. It cost 37.6%
  less but took 188.8 seconds instead of 67.5 seconds—about 2.8 times slower.
  Returning a promise from an `async` function already adopts its result and
  rejection.
  Evaluate prompt changes against an expected-finding matrix that separately
  scores false positives, false negatives, severity, duplication, latency,
  tokens, and cost, preferably over repeated runs. Evidence: DevDigest runs
  `fe0e6160-830a-4196-9f8c-0af6fcabbc49` (prompt v1) and
  `0be27a60-2c8a-41a3-9f78-d75b8c76e3e1` (prompt v2) on PR #3.

## Codebase Patterns & Tool / Library Notes

- **2026-09-17** — A map-reduce run records one `PromptAssembly` — the whole-diff
  assembly — not the exact prompt of each per-file call. The trace is therefore
  representative, not a replayable log: do not debug a per-file prompt by reading
  the stored assembly. Evidence:
  `reviewer-core/src/review/run.ts:104-105` (`ReviewOutcome.assembly`),
  `reviewer-core/src/review/run.ts:142` (`reviewPullRequest`)

- **2026-10-14** — An OpenRouter model ID does not pin the upstream provider,
  so the same model and a byte-identical prompt can change behaviour between
  evaluation runs. For `deepseek/deepseek-v4-flash` on one day, one identical
  review prompt was counted as 1,702 input tokens in some calls and 2,927 in
  others; between two runs the mean findings dropped from about 5 to 2.7, the
  cost per token fell, and one review came back in Chinese. When comparing
  prompt variants, record the response's top-level `provider` field (the engine
  does not capture it) and pin the provider, or treat run-to-run differences as
  noise. Evidence: `docs/plans/L03-intent-evaluation.md` (run 2,
  "Run-to-run drift"), `reviewer-core/src/llm/openrouter.ts`
  (`OpenRouterProvider.completeStructured`).

## Decisions

## Recurring Errors & Fixes

- **2026-10-14** — A reasoning model can return empty structured output because
  its reasoning tokens consume the whole `max_tokens` budget. With
  `deepseek/deepseek-v4-flash` on OpenRouter, the intent classifier stopped with
  `finish_reason=length` and empty or truncated JSON in 3 of 4 calls at 1,500
  tokens and 3 of 3 calls at 4,000 (all 4,000 were reasoning tokens). Raising
  the budget does not help; pass `reasoning: { effort: 'low' }` (or a reasoning
  `max_tokens`), and check `finish_reason` when a structured call fails
  validation. Evidence: `reviewer-core/src/intent/derive.ts`
  (`DEFAULT_INTENT_REASONING`), `reviewer-core/src/llm/openrouter.ts`
  (`OpenRouterProvider.completeStructured`).

## Session Notes

## Open Questions
