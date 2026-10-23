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

- **2026-10-18** — The grounding gate accepts a finding that cites only
  *unchanged* context lines. `groundFindings` keeps a finding when its range
  touches any number in a hunk's `newLineNumbers`, and the server's diff parser
  adds context lines to that list as well as added ones. "Survives grounding"
  therefore means "inside a changed hunk", not "on a changed line". To pin a
  finding to the change itself (an experiment anchor, an eval rule), also check
  the range against the lines the patch adds. Evidence:
  `reviewer-core/src/grounding.ts` (`buildLineIndex`, `rangeIntersects`),
  `server/src/adapters/git/diff-parser.ts` (context lines pushed to
  `newLineNumbers`); in `server/test/seed-content.test.ts`, an anchor moved to
  context line 16 of `src/api/payments.ts` still passed `groundFindings` and
  failed only the added-lines check.

- **2026-10-20** — On OpenRouter, structured-output support differs between
  the providers of one model. For `deepseek/deepseek-v4-flash`, DeepInfra and
  StreamLake list `structured_outputs` in their endpoint `supported_parameters`;
  GMICloud and SiliconFlow list only `response_format`.
  - Without `provider.require_parameters: true`, a provider that lacks a
    parameter still receives the request and silently ignores it. A strict
    `json_schema` request can then come back unstructured.
  - With it, OpenRouter does not route to that provider at all.
  - Provider slugs have the shape `provider[/variant][/region][/tier]`. A base
    slug (`deepinfra`) matches every endpoint of that provider, while a full
    slug (`deepinfra/fp8`) names one.
  - The endpoints `tag` is not documented as a routing value; the documented
    source of exact slugs is the copy button on the model page.

  Check `supported_parameters` with the free public
  `GET /api/v1/models/{author}/{slug}/endpoints` before pinning a provider.
  Evidence: that endpoint (2026-10-20);
  https://openrouter.ai/docs/guides/routing/provider-selection;
  `reviewer-core/src/llm/openrouter.ts` (`experimentRequestBody`).

- **2026-10-21** — An HTTP error's `message` from the OpenAI SDK (v4.104)
  is not safe to persist. `APIError.makeMessage` uses `error.message` when it
  is a string, but **otherwise the JSON of the whole `error` object**. On
  OpenRouter that includes `metadata.raw`, the upstream's verbatim payload. A
  non-JSON body becomes the message verbatim.
  - `err.error` is the body's inner `error` object, not the body.
  - The request id is `request_id`, read from `x-request-id`. The `requestID`
    property exists only in SDK v5.
  - Redacting the key was not enough: a DB-backed test showed the upstream's
    raw text in `agent_runs.error` after the key had been redacted.

  For persistence, rebuild the reason from allowlisted fields
  (`<status> <error.message>`), and keep only typed metadata. Evidence:
  `reviewer-core/node_modules/openai/error.js` (`APIError.makeMessage`),
  `reviewer-core/src/llm/openrouter.ts` (`completeExperiment` catch),
  `server/test/experiments.it.test.ts` ("a provider 429 through the real
  provider").

- **2026-10-21** — OpenRouter's observable state lags and flips, so an
  experiment check that reads it once can be wrong. On `deepseek/deepseek-v4-flash`
  via `deepinfra/fp8` (HW2 Gate 3, stack `hw2f-f53ed971`):
  - **Generation lookup:** a lookup about 0.1 s after a completed request
    returned `not_found`; the same id was found 38 s later.
  - **Key usage:** `usage` from `GET /api/v1/key` reflected that request
    about 100 s after completion.
  - **Endpoint status:** `status` was 0 at 08:34 UTC, -2 from about 08:37 to
    08:40 with 100% uptime, and 0 again by 08:59.
  - **Status 0 is not capacity:** a request ten seconds after a status-0
    check failed with HTTP 429 `Provider returned error`, with no generation
    id, and key usage stayed unchanged for about 11 minutes.

  Poll the lookup and the key with a bounded timeout and reconcile against the
  previous total plus the ledger charge. Treat a 429 without a generation id
  as unknown cost: never retry it, and read the attempt's `errorDetail`
  instead. Evidence: `docs/plans/HW2-gate3-plan.md` (Execution log), and the
  stack's evidence outside the repository
  (`~/.devdigest/hw2-experiments/hw2f-f53ed971/gate3-slot1/`, `gate3-slot2/`).

- **2026-10-22** — Extension of the 2026-10-21 SDK `APIError` entry above:
  on a cancellation, rethrowing "the error we caught" is only safe for the
  SDK's own `APIUserAbortError`, which it builds with no status, body or
  headers (`super(undefined, undefined, message, undefined)`). An abort can
  coincide with a status error that already carries the body and headers. Throw
  `signal.reason` instead (`req.signal.throwIfAborted()`): the caller still
  sees a cancellation, and no provider data travels. The same applies to
  telemetry built before the outcome is known: the HTTP-200 error branch reused
  the success path's `routerMetadataRaw`. Evidence:
  `reviewer-core/node_modules/openai/error.js` (`APIUserAbortError`),
  `reviewer-core/src/llm/openrouter.ts` (`completeExperiment` catch and
  no-choices branch), `reviewer-core/test/openrouter-error-detail.test.ts`
  ("a cancellation coinciding with a provider error").

- **2026-10-23** — What OpenRouter documents about provenance, and what it
  does not (checked 2026-10-22):
  - **`openrouter_metadata.attempt`** is only "the attempt number that
    succeeded". The docs' own guardrail example shows `attempt: 1` for a
    request that never reached a provider.
  - **`attempts`** is optional, described for router fallbacks, and was absent
    from both completed HW2 Gate 3 responses. So `attempt: 1` never proves one
    upstream request.
  - **`provider_responses`** in a `GET /generation` record is documented as one
    entry per upstream attempt, fallbacks included. A found record with exactly
    one response is the documented evidence of a single attempt.
  - **The generation endpoint documents no availability delay.** In Gate 3 the
    record appeared 29–38 s after the response.

  Poll for it within a hard deadline, re-reading 404, 429, 5xx, timed-out
  reads, and records whose `provider_responses` are still empty. Evidence:
  https://openrouter.ai/docs/guides/features/router-metadata.md,
  https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation.md,
  `reviewer-core/src/llm/openrouter.ts` (`lookupGeneration`),
  `reviewer-core/test/openrouter-generation-lookup.test.ts`.

- **2026-10-23** — The OpenAI SDK's `timeout` does not bound a request's
  body. In v4.104 `fetchWithTimeout` clears its timer when `fetch` resolves,
  that is, when the response headers arrive. OpenRouter sends `200` and its
  headers "as soon as the provider accepts the request… before the model
  produces a single token", non-streaming requests included. So the SDK
  timeout bounds only the time to the provider's acceptance; the whole
  generation, and a stalled body, are unbounded.

  To bound a request, pass an `AbortSignal.timeout(...)`, combined with the
  caller's signal, as the request's `signal`; it also aborts the body read.
  Classify its expiry as a timeout rather than a cancellation. A loopback test
  shows it: headers at once and the body after 600 ms complete despite a
  200 ms SDK `timeout`. Evidence:
  `reviewer-core/node_modules/openai/core.js` (`fetchWithTimeout`),
  https://openrouter.ai/docs/api_reference/errors-and-debugging.md ("Mid-stream
  errors", "Non-streaming requests"),
  `reviewer-core/test/openrouter-request-deadline.test.ts`.

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
