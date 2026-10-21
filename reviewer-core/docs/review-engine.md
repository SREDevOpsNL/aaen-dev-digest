# Review engine

How `reviewPullRequest` turns a diff into a grounded review, step by step. The
pipeline diagram and the public API are in [`../README.md`](../README.md); the
two gates that make the output trustworthy are in
[grounding-and-scoring.md](grounding-and-scoring.md), and what the model is
shown is in [prompt-assembly.md](prompt-assembly.md).

## Contract

[`src/review/run.ts`](../src/review/run.ts) exports one entry point:

- **Input:** `ReviewInput` (`run.ts:49`):
  - the agent's system prompt and model;
  - a **parsed** `UnifiedDiff` and an **injected** `LLMProvider`;
  - optionally: a strategy, resolved skill, memory, and spec strings, a callers
    digest, a repo map, the PR description, a validated PR **intent** (L03), a
    task line, retry and threshold overrides, an OpenRouter `sessionId`, an
    `onEvent` sink, and a (possibly async) `checkCancelled` hook;
  - for the opt-in HW2 experiment runner only: `experiment` options and an
    `onAttempt` telemetry sink.
- **Output:** `ReviewOutcome` (`run.ts:115`):
  - the grounded `Review` and a grounding summary like "3/4 passed";
  - the dropped findings with reasons;
  - the mode that ran, the prompt assembly, and the chunk labels;
  - token totals, `providerCostUsd`, `costUsd`, and the joined raw outputs.

The engine performs no I/O except calls through the injected provider: no
database, GitHub, or filesystem. The caller resolves every input and persists
every output. In the studio that caller is
[`server/src/modules/reviews/run-executor.ts`](../../server/src/modules/reviews/run-executor.ts);
see [server review runs](../../server/docs/review-runs.md).

## Steps

1. **Choose the mode** (`selectMode`, `run.ts:138`):
   - `single-pass` always sends one call.
   - `map-reduce` sends one call per file, but only when the diff touches more
     than one file.
   - `auto` (the default when no strategy is given) picks map-reduce only when
     the diff is **both** over 400 changed lines (`DEFAULT_MAP_THRESHOLD_LINES`)
     **and** multi-file.

   The studio passes each agent's own `strategy` column, which defaults to
   `single-pass`.
2. **Assemble the prompt** once per chunk (`assemblePrompt`; see
   [prompt assembly](prompt-assembly.md)). The trace keeps the whole-diff
   assembly for map-reduce, or the one call's assembly for single-pass.
3. **Per chunk** (`run.ts:213`):
   1. Await `checkCancelled()` first, so a cancel stops before the next paid
      call.
   2. Call `llm.completeStructured<Review>` with the `Review` Zod schema and up
      to 2 repair retries (`DEFAULT_REVIEW_MAX_RETRIES`).
   3. Emit progress events (`info`, `tool`, `result`) for the live log.
4. **Reduce** the partial reviews (`reduceReviews`,
   [`src/review/reduce.ts`](../src/review/reduce.ts)). One partial passes
   through unchanged. Several are merged:
   - their findings are concatenated;
   - the **worst** verdict wins (`request_changes` > `comment` > `approve`);
   - their summaries are joined.
5. **Ground** the merged findings against the full diff, once, after the
   reduce. Dropped findings are emitted with their reason.
6. **Rescore** from the surviving findings (`scoreFromFindings`). The model's
   own score never reaches the caller.

## Structured output and repair

Each provider sends the `Review` schema as a strict JSON Schema. The schema is
derived from Zod by `toJsonSchema`
([`src/llm/structured.ts`](../src/llm/structured.ts)), using OpenAI's
converter, and is reused by both OpenAI and Anthropic.

`parseWithRepair` (`structured.ts:54`) then works in three steps:

1. It first `JSON.parse`s the raw text. Only on failure does it fall back to
   `extractJson`, which strips fences and finds the first balanced block,
   because a fence inside a JSON string value would fool the extractor.
2. It validates the result with Zod.
3. On failure it returns a **reprompt** listing each issue path. The provider
   appends the bad answer and the reprompt to the conversation and retries.
   When the retries run out, the provider throws, and the caller records a
   failed run.

## Providers and cost

`OpenRouterProvider` ([`src/llm/openrouter.ts`](../src/llm/openrouter.ts)) is
the engine's own provider. The studio uses it for OpenRouter agents; its OpenAI
and Anthropic providers live in the server's adapters.

- **Request:** each call asks OpenRouter for `usage: { include: true }` and
  forwards `session_id`, so one review's calls group into one dashboard
  session.
- **Two cost fields, deliberately:**

  | Field | Meaning |
  | --- | --- |
  | `providerCostUsd` | The sum of OpenRouter's `usage.cost` over every attempt, but **only if every attempt reported one**; otherwise `null`. It is authoritative only when the provider id is `openrouter`. `run.ts:237` applies the same all-or-nothing rule across map-reduce chunks. |
  | `costUsd` | The best available number: the provider cost if any attempt reported one, else the injected `estimateCost` from token prices, else `null`. Kept for estimate consumers only. |

- **What gets persisted:** the studio stores only `providerCostUsd`. See
  [`../specs/01-provider-cost.md`](../specs/01-provider-cost.md).
- **Aborting:** a request may carry an `AbortSignal`. The provider checks it
  before each attempt and maps an abort to a cancellation rather than a
  provider failure.
- **Experiment failures (HW2 only):** a failed experiment request reports an
  `errorDetail` on its attempt ([`src/llm/error-detail.ts`](../src/llm/error-detail.ts)):
  - **What it keeps:** OpenRouter's `error.code` and sanitized `error.message`;
    `metadata.error_type`, `provider_code`, `provider_name` and
    `limit_source`; the request id, `Retry-After`, and allowlisted
    `x-ratelimit-*` headers.
  - **What it never keeps:** the upstream's `metadata.raw` (only whether it
    was there), any other header, any raw body.
  - **The thrown error** is an `ExperimentRequestError` carrying only that
    sanitized reason and the HTTP status. With a status, the reason is rebuilt
    from the detail, because the SDK's own message can be the JSON of the
    whole error body. Ordinary calls are unchanged.

## PR intent (L03)

`src/intent/` holds the pure half of the intent layer:

- `deriveIntent` (`intent/derive.ts`) makes the classifier call.
- `validateIntent` (`intent/validate.ts`) checks citations and output limits.
- `renderIntentForReview` (`intent/prompt.ts`) turns a validated intent into
  the untrusted review section.

The studio caches the result and gives one intent to every agent of a batch
(see [server review runs](../../server/docs/review-runs.md)). How the intent
enters the review prompt is in [prompt assembly](prompt-assembly.md).

## CI payload (scaffolded)

[`src/output/to-review.ts`](../src/output/to-review.ts) has two halves:

- **`toReviewPayload`** formats a GitHub review (body, inline comments, and an
  `APPROVE`, `COMMENT`, or `REQUEST_CHANGES` event computed from severities and
  the agent's `ci_fail_on`). Its consumer, the CI runner, arrives in L06; in the
  starter it is exercised only by tests.
- **`countBlockers`** from the same file **is** operational: the studio counts
  each run's blockers with it.

## Tests

`npm test` uses a stubbed provider with no keys and no network:

- `test/run.test.ts`: single-pass grounding, the deterministic score, the
  cancel checkpoint, `sessionId` forwarding, and map-reduce cost aggregation.
- `test/openrouter-cost.test.ts`: the cost fields above.
- `test/openrouter-abort.test.ts`: request timeouts and cancellation.
- `test/openrouter-experiment.test.ts`: the experiment request body and
  telemetry.
- `test/openrouter-error-detail.test.ts`: the error extractor, and failed
  experiment requests through the real SDK against a loopback server
  (structured and malformed 429s, an HTTP 200 error body, a network failure,
  secret redaction, the header allowlist).
- `test/intent.test.ts`: intent evidence, validation, derivation, and the
  intent section in `assemblePrompt`.
- `test/prompt.test.ts`: the injection guard, the PR-description section, and
  the linked-skills trust boundary.
- `test/to-review.test.ts`: the CI gate and inline anchoring.
