# HW2 provider reliability: root-cause analysis of the HTTP 429 failures

Independent reliability analysis (Agent R), 2026-11-02, for the unapproved
[429 policy proposal](429-policy-proposal.md). It is read-only: no provider API
call was made and no secret was read. Every timestamp is UTC. This committed
copy is sanitized: references to private archive files (the global ledger,
key-usage log, stack evidence directories and forensic exports under the
owner's private experiments directory) are shown as *(private archive)*; no
raw prompt, response, key or token is included.

Evidence labels used throughout:
- **[V] verified**: read directly from a recorded artifact.
- **[I] inference**: reasoned from verified facts.
- **[U] unverifiable**: the archived evidence cannot settle it.

## 0. Sources used

- The global ledger, authorization and key-usage logs *(private archive)*.
- Gate 3 stacks X1 (`hw2f-f53ed971`) and X2 (`hw2f-39febf41`): local ledgers, archived traces, slot transcripts, key polls and endpoint snapshots *(private archive)*.
- Phase 1 (stack `hw2f-7d16304f`): the global ledger plus the Phase 1 log in [EXPERIMENTS.md](../EXPERIMENTS.md). **Phase 1 traces were not archived.**
- The conventions-extraction receipt (metadata fields only), the Item A trace, and the Item B v3 and v4 forensic exports and serve logs *(private archive)*; the public v3/v4 records are in [item-b-confirmatory](../evidence/item-b-confirmatory/README.md) and [item-b-v4-confirmatory](../evidence/item-b-v4-confirmatory/README.md).
- Repository code, read-only: `reviewer-core/src/llm/error-detail.ts`, `openrouter.ts`, `openrouter-metadata.ts`.
- Not provider evidence: the `integration-*/sim/` runs are simulations against fake providers and are not used.

## 1. Inventory of every paid provider dispatch

### 1.1 Common to all dispatches

Every dispatch below has these properties **[V]** in every archived trace or receipt. Phase 1 has no archived trace, so for Phase 1 they come from the documentation.
- Model `deepseek/deepseek-v4-flash` through OpenRouter.
- Routing `only=["deepinfra/fp8"]`, `order=["deepinfra/fp8"]`, `allow_fallbacks=false`. The request body also sets `require_parameters: true` (`openrouter.ts` lines 108–116).
- One HTTP request, with SDK retries 0 (`openrouter.ts` line 338) and the `X-OpenRouter-Metadata: enabled` header (line 339).

The whole HW2 history is **19 provider dispatches on one dedicated OpenRouter key**:
- 18 review dispatches;
- 1 conventions extraction, which used the same model and endpoint.

The key's usage was **0** before the first dispatch **[V]**: *(private archive)*, `"usage": 0` at 2026-10-21T09:46:08Z.

**What "Gap" means in the table.** The time from the end of the previous dispatch (start + `durationMs`) to the start of this one. Every previous dispatch was to the same provider, because all 19 went to `deepinfra/fp8`. Phase 1 starts and durations are approximate: ledger `dispatched` times and the durations in the documentation.

### 1.2 Dispatch table

| # | Slot | Exp / cond | Stack | Start (attempt) | Duration | Gap | Outcome | Tokens in/out (response; generation record) | Cost (ledger) | Response ID | Router metadata | `max_tokens` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | x-18-with-1 | 18 / with | X1 hw2f-f53ed971 | 2026-10-21 09:46:10.056 (Wed) | 37.3 s | first | completed, stop | 1586/479; gen `not_found` | 0.00022896 | yes (`gen-1792…`) | DeepInfra, `…-20260423`, `direct`, attempt 1 | 16000 |
| 2 | **x-18-without-1** | 18 / without | X1 | 2026-10-21 16:14:26.932 | **906 ms** | 6 h 27 m | **429** | none | none (reservation $0.01 held) | **no** | none | 16000 |
| 3 | x-18-without-1 | 18 / without | X2 hw2f-39febf41 | 2026-10-22 21:30:14.146 (Thu) | 54.1 s | 29 h 16 m | completed, stop | 1124/432; gen `not_found` | 0.00017892 | yes | DeepInfra, attempt 1 | 16000 |
| 4 | **x-17-with-1** | 17 / with | X2 | 2026-10-22 21:53:36.875 | **426 ms** | 22 m 29 s | **429** | none | none (reservation $0.01 held) | **no** | none | 16000 |
| 5 | x-17-with-3 | 17 / with | P1 hw2f-7d16304f | ≈2026-10-25 21:54:24 (Sun) | 97.8 s | ≈3 d | completed, stop | router 1142/2540; gen 1139/2235 | 0.00055998 | yes (doc) | DeepInfra (doc) | ≈16000 [I]¹ |
| 6 | **x-17-without-1** | 17 / without | P1 | ≈2026-10-25 22:02:50.082 | **343 ms** (doc; ledger dispatched→failed 1.007 s) | ≈6 m 48 s | **429** | none | none (reservation $0.01 held) | no (doc) | not recorded / not archived | ≈16000 [I]¹ |
| 7 | x-18-with-1 | 18 / with | P1 | ≈22:06:57 | 33.5 s | ≈4 m 07 s | completed | router 1373/463; gen 1501/412 | 0.00020691 | yes (doc) | DeepInfra (doc) | ≈16000 [I] |
| 8 | x-18-without-1 | 18 / without | P1 | ≈23:14:11 | 77.4 s | ≈66 m | completed | 911/438; gen `not_found` | 0.00016083 | yes (doc) | DeepInfra, AMS, not BYOK (doc) | ≈16000 [I] |
| 9 | x-18-with-2 (trace only) | 18 / with | P1 | ≈2026-10-26 08:04:49 | ≈38 s (ledger) | ≈8 h 49 m | completed | gen 1914/396 | 0.00023517 | yes (doc) | DeepInfra (doc) | ≈16000 [I] |
| 10 | conv-fastify-…4bff6e22 | conventions | hw2f-0671292f | 2026-10-27 19:19:42.747 | 138.2 s | ≈35 h | completed, stop | **25408**/2041; gen 23481/1931 | 0.0026541 | yes | DeepInfra, endpoint `934a69f9…` | 4000 |
| 11 | x-18-with-3 (Item A) | 18 / with | hw2f-cc928441 | 2026-10-31 12:10:58.092 (Sat) | 16.8 s | ≈3 d 17 h | completed | 1765/383; gen 1914/336 | 0.00022779 | yes | DeepInfra, `934a69f9…` | 4000 |
| 12 | c-18-with-5 | 18 / with | v3 hw2f-19ef1f13 | 2026-10-31 18:30:43.420 | 29.2 s | 6 h 19 m | completed | 1373/431; gen 1501/402 | 0.00020115 | yes | DeepInfra, `934a69f9…` | 4000 |
| 13 | c-18-without-5 | 18 / without | v3 | 18:31:16.945 | 31.0 s | **4.3 s** | completed | 911/76; gen 991/76 | 0.00009567 | yes | same | 4000 |
| 14 | c-17-with-1 | 17 / with | v3 | 18:31:52.456 | 56.9 s | **4.6 s** | completed | 1142/1736; gen 1139/1388 | 0.00041526 | yes | same | 4000 |
| 15 | c-17-without-1 | 17 / without | v3 | 18:32:54.246 | 47.3 s | **4.9 s** | completed | 1034/1992; gen 1013/1679 | 0.00045162 | yes | same | 4000 |
| 16 | c-17-without-2 | 17 / without | v3 | 18:33:46.038 | 49.5 s | **4.5 s** | completed | 1034/1456; gen 1013/1193 | 0.00035514 | yes | same | 4000 |
| 17 | c-17-with-2 | 17 / with | v3 | 18:34:36.898 | 109.4 s | **1.3 s** | **truncated** (finish `length`) | 1142/4000; gen `not_found` | 0.00082278 (billed) | yes | DeepInfra | 4000 |
| 18 | c-v4-17-without-2 | 17 / without | v4 hw2f-5b00487b | 2026-11-01 20:02:44.047 (Sun) | 45.1 s | ≈25 h 26 m | completed | 1034/1454; gen 1013/1316 | 0.00035478 | yes | DeepInfra, `934a69f9…` | 8000 |
| 19 | **c-v4-17-with-2** | 17 / with | v4 | 20:03:34.220 | **303 ms** (run 409 ms; serve log 419 ms) | **5.1 s** | **429** | none (`null`, `usage_state: unknown`) | none (reservation $0.005 held) | **no** | none | 8000 |

¹ Phase 1's `max_tokens` was not archived. The 16000 value is inferred: the documented preflight worst case of $0.0056 for `x-17-with-3` matches a 16000-token cap at the frozen prices, and a 4000 cap would give about $0.0026.

**Fields recorded for no dispatch:**
- the time of the first response byte;
- the absolute end timestamp (end = start + `durationMs` is derived);
- any response header other than `x-generation-id` on success and the allowlisted rate-limit headers, `retry-after` and `x-request-id` on error;
- an OpenRouter request ID (always `null`);
- a live endpoint-status snapshot inside v3 and v4.

For the 429s there is additionally no response ID, generation ID, served model or usage. That is expected: no generation was produced.

### 1.3 Billing reconciliation across the whole history [V]

| Item | Amount (USD) |
| --- | --- |
| Gate 3 (#1, #3) | 0.00040788 |
| Phase 1 (#5, #7, #8, #9) | 0.00116289 |
| Conventions extraction (#10) | 0.0026541 |
| Item A (#11) | 0.00022779 |
| v3, all six including the truncated one (#12–#17) | 0.00234162 |
| v4 (#18) | 0.00035478 |
| **Sum** | **0.00714906** |

The key's usage went from **0** (before #1) to **0.00714906** *(private archive)*. That equals the sum to the last digit. Each settlement delta in *(private archive)* also matches exactly:

| Settlement | Delta | Matches |
| --- | --- | --- |
| 2026-10-26 | +0.00116289 | Phase 1 |
| 2026-10-27 | +0.0026541 | Conventions |
| 2026-10-31 12:13 | +0.00022779 | Item A |
| 2026-10-31 18:38 | +0.00234162 | v3 |
| 2026-11-01 | +0.00035478 | v4 |

So **none of the four 429s was billed**, and the truncated v3 request was billed in full.

Per-429 corroboration:
- **#2:** key usage stayed at 0.00022896 for about 11.5 minutes after the slot *(private archive)*.
- **#4:** key usage stayed at 0.00040788 from 21:54:12 to 22:02:45Z *(private archive)*.
- **#6:** the 2026-10-26 settlement equals the four completed Phase 1 costs.
- **#19:** the v4 settlement delta equals slot 1 alone.

## 2. The four 429s in detail

| | #2 X1 x-18-without-1 | #4 X2 x-17-with-1 | #6 P1 x-17-without-1 | #19 v4 c-v4-17-with-2 |
|---|---|---|---|---|
| Run | `6fd06290` | `79394d6b` | `9c3f6d04` | `46849681` |
| Time (UTC) | Wed 16:14:26.9 | Thu 21:53:36.9 | Sun 22:02:50 | Sun 20:03:34.2 |
| Time to failure | 906 ms | 426 ms | 343 ms | 303 ms |
| HTTP status | 429 [V] | 429 [V] | 429 [V doc] | 429 [V] (trace stage attempt `http_status: 429`, phase `submitted`) |
| Message | "Provider returned error" | "Provider returned error" | (doc: 429 Provider returned error) | "Provider returned error" |
| `errorDetail` captured | **no**: the code predates PR #31. The trace has only `failureReason` (see note 1) | yes | yes (doc only; trace not archived) | yes |
| `origin` (derived locally) | not recorded | `upstream_provider` | `upstream_provider` (doc) | `upstream_provider` |
| `limit_source` (from OpenRouter) | not recorded | `upstream_provider_shared_pool` | `upstream_provider_shared_pool` (doc) | `upstream_provider_shared_pool` |
| `provider_name` | not recorded | `DeepInfra` | DeepInfra (doc) | `DeepInfra` |
| `provider_code` / `error_type` | not recorded | null / null | not stated | null / null |
| `upstreamRawPresent` | not recorded | **true** | not stated | **true** |
| `retryAfter` | not recorded | null | "no retry-after" (doc) | null |
| `x-ratelimit-*` | not recorded | `{}` | not stated | `{}` |
| `requestId` | not recorded | null | not stated | null |
| `redacted` | — | false | — | false |
| Billed | no | no | no | no |
| Concurrency | single slot; nothing else in flight [V: one-slot script, capability revoked at 16:14:27] | single slot [V: *(private archive)*] | slots were sequential and manual; the previous slot ended about 6.8 min earlier [V ledger] | sequential runner; slot 1 ended 5.1 s earlier; the serve log shows one run, `46849681` [V *(private archive)* lines ≈4700–4800] |
| Free metadata calls just before | endpoint check 16:14:17, key read 16:14:24 | key read 21:53:33, endpoint check ≈21:52:42 | not recorded | not recorded in the archive |
| Endpoint state just before | "endpoint ready", uptime 30m 100 *(private archive)* | status 0, **uptime 30 m 96.30 %, 1 d 96.64 %** *(private archive)* | not recorded | not recorded |

Notes:

1. **Why #2 has no `errorDetail`.** The diagnostics arrived in `c8a700b` ("HW2 experiments: sanitized error diagnostics for failed attempts (#31)", 2026-10-22). The slot-2 review notes say so explicitly: the engine at that time "discards the error body … and the response headers", so "the cause (upstream capacity vs rate limit) therefore cannot be established" *(private archive)*. Attributing #2 to the shared pool is therefore **[I]**, by similarity of message and timing.

2. **Earlier endpoint-state context [V].**
   - On 10-21, `reviewer-core/LEARNINGS.md` lines 89–104 record the endpoint status flipping 0 → -2 → 0 between 08:34 and 08:59 UTC, and the #2 429 arriving "ten seconds after a status-0 check".
   - On 10-22, the X2 preflight saw status **-2** at 21:22:36Z *(private archive)* and status 0 at 21:22:53Z *(private archive)*.
   - DeepInfra's `uptime_last_1d` in every real snapshot from 10-22 to 10-24 was 96.6–99.8 %.

   Whether OpenRouter's uptime figure counts upstream 429s is **[U]**: the fetched documentation does not define it.

## 3. OpenRouter throttling versus DeepInfra upstream limits

### 3.1 How the fields are derived in code [V]

**Request side.** `completeExperiment` (`reviewer-core/src/llm/openrouter.ts` lines 284–395) sends one request with `maxRetries: 0` and `X-OpenRouter-Metadata: enabled`. On error it calls `attemptErrorDetail` with three inputs (lines 359–364):
- `apiError.error`, the SDK-parsed inner `error` object;
- `apiError.headers`;
- `apiError.requestID ?? apiError.request_id`.

**`attemptErrorDetail`** (`reviewer-core/src/llm/error-detail.ts` lines 170–216) reads:
- `providerName`, `providerCode`, `limitSource` and `errorType`, verbatim from OpenRouter's `error.metadata.{provider_name, provider_code, limit_source, error_type}`. Each is kept only as a short plain token (lines 183–185, 203).
- **`limitSource` is OpenRouter's own label, passed through unchanged.** DevDigest does not compute it.
- `origin`, which **is computed locally** (lines 193–200):
  - `upstream_provider` if OpenRouter sent `provider_name` or `provider_code`;
  - otherwise `openrouter` if `limit_source` starts with `openrouter_`;
  - otherwise `unattributed`, or `no_body` when there is no body.
- `upstreamRawPresent`, which is only whether `metadata.raw` existed (line 207). **`raw` itself is never kept** (header comment, line 12).
- `rateLimit`, which holds only the 9 allowlisted `x-ratelimit-*` names (lines 21–31, 186–190).
- `retryAfter`, from `retry-after` (line 209).
- `requestId`, from the SDK's `request_id`. In SDK 4.104.0 that is `headers['x-request-id']` (`node_modules/openai/error.js` line 14), else the `x-request-id` header (line 191).

The SDK builds `headers` as a lower-cased object proxy (`node_modules/openai/core.js` lines 548–556), so the lookups work. A value that is present but unsafe is dropped *and* sets `redacted: true`. In #4 and #19, `redacted` is **false**. So `retry-after`, every allowlisted `x-ratelimit-*` header and `x-request-id` were **absent** from the 429 response, not dropped by the sanitizer **[V by code + recorded values]**.

The same allowlist and origin logic existed in the first version (`git show c8a700b:reviewer-core/src/llm/error-detail.ts`, lines 22–30, 145–169), which is the code that produced #4.

### 3.2 What OpenRouter's public documentation says

Pages fetched on 2026-11-02:

**https://openrouter.ai/docs/api-reference/limits**
- A 429 "can come from OpenRouter (free-model caps or DDoS protection) or from the upstream provider … when the provider serving your request is rate limiting or at capacity". Provider-side limits carry `metadata.provider_code` when available.
- On a **platform-limit** 429 the response "carries X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers". The body example uses `metadata.error_type: "rate_limit_exceeded"`.
- "Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally."
- Free-model limits apply only to `:free` model IDs.
- Upstream-provider limits are suggested to be handled with fallbacks, or by relaxing provider routing.

**https://openrouter.ai/docs/api-reference/errors**
- `Retry-After` may appear on 429 and 503 responses.
- Documented `limit_source` values are all `openrouter_*`: `openrouter_guardrail_budget`, `openrouter_workspace_budget`, `openrouter_key_limit`, `openrouter_in_flight_budget`.
- `raw` is described as "the provider's verbatim payload".
- On billing it says only that "you may still be charged for the prompt processing cost by the upstream provider".
- The page **does not document** `upstream_provider_shared_pool`.

**https://openrouter.ai/docs/features/provider-routing**
- `allow_fallbacks: false` with `order` and `only` restricts routing to the listed provider.
- The router tracks "how often the provider rejects requests with a 429 because it is out of capacity".
- "A burst of 429s … briefly lowers a provider's share". With `only` set to one provider, there is no other share to move to.

**https://openrouter.ai/docs/api-reference/errors-and-debugging** returned 404.

**Secondary sources (not OpenRouter documentation).** A web search for the exact string found only third-party reports:
- https://github.com/FreePeak/onegw/pull/95: a captured body with message "Provider returned error", `code` 429, `metadata.provider_name`, `metadata.raw` ("… temporarily rate-limited upstream …"), `limit_source: "upstream_provider_shared_pool"` and no `Retry-After`. 3 of 8 calls on one credential returned 429 while 5 returned 200, which the author reads as "a shared lane, not a dead key".
- Similar reports: https://github.com/everruns/everruns/pull/4707 and https://github.com/vm0-ai/okou/issues/35466.

### 3.3 DeepInfra's public documentation

https://deepinfra.com/docs/advanced/rate-limits redirects to https://docs.deepinfra.com/account/rate-limits. That page says:
- "Every account has a default limit of 200 concurrent requests per model"; the limit is on concurrency, not requests per minute.
- An over-limit request gets 429 "Rate limited".
- "You may occasionally receive 429 errors when a model becomes very busy, even if you're under the limit". Auto-scaling should resolve this shortly.

When OpenRouter calls DeepInfra without BYOK, the DeepInfra "account" is OpenRouter's, shared by all OpenRouter customers routed to that endpoint **[I]**. How DeepInfra provisions OpenRouter's traffic is **[U]**.

### 3.4 Conclusion on attribution

**Verified [V] for #4 and #19, and documented for #6:**
- OpenRouter attached `provider_name: DeepInfra` and `limit_source: upstream_provider_shared_pool`, and included an upstream `raw` payload.
- It sent no `error_type`, no `X-RateLimit-*` headers, no `Retry-After` and no `x-request-id`.

**Inference [I], high confidence: these were not OpenRouter's own per-key or account throttling.**
1. `limit_source` is OpenRouter's label naming the upstream provider's shared pool. Every documented OpenRouter-side source starts with `openrouter_`.
2. A platform 429 would carry `X-RateLimit-*` headers and `error_type: rate_limit_exceeded` according to OpenRouter's documentation, and none was present.
3. The free-tier limits do not apply: the model is not `:free`, and the account is paid.
4. Credits and budgets do not apply: the key had $1.99+ remaining and a $2 limit throughout *(private archive)*. Budget errors are 402, not 429.
5. Our own request rate was tiny: at most one request in flight, and at most 6 requests within 4 minutes (v3), all of which succeeded.

**Inference [I], medium-high confidence.** The 429 was generated by DeepInfra, or by OpenRouter's admission control for DeepInfra capacity that is shared across OpenRouter customers, in response to aggregate load. It arrived 300–900 ms after submission, before any token and before billing, which is consistent with an admission rejection.

**Unverifiable [U]:**
- DeepInfra's load at those moments, and OpenRouter's aggregate traffic to `deepinfra/fp8`.
- Whether the "shared pool" means DeepInfra's per-account concurrency cap on OpenRouter's account or DeepInfra's "model very busy" auto-scaling 429.
- The content of `raw`, which was deliberately never stored.
- The cause of #2 (no `errorDetail`).
- The fields of #6, because its trace was not archived and only the documentation's summary survives.

## 4. Empirical 429 rate and possible associations

### 4.1 Rates with exact Clopper-Pearson 95 % intervals

**Method.** For k events in n trials, CP95 is:

`[Beta⁻¹(0.025; k, n−k+1), Beta⁻¹(0.975; k+1, n−k)]`

It is computed here by bisection on the binomial CDF: the lower bound p_L solves P(X ≥ k | p_L) = 0.025, and the upper bound p_U solves P(X ≤ k | p_U) = 0.025 *(private archive)*. When k = 0 the lower bound is 0, and the upper bound is 1 − 0.025^(1/n).
- Check for 0/8: 1 − 0.025^(1/8) = 1 − e^(ln 0.025 / 8) = 1 − e^(−0.4611) = 1 − 0.6306 = **0.3694** ✓.
- Check for 4/19: the point estimate is 4/19 = 0.2105.

| Group | 429s / dispatches | Rate | CP95 |
|---|---|---|---|
| **All dispatches** | 4/19 | 0.211 | [0.061, 0.456] |
| Review dispatches only | 4/18 | 0.222 | [0.064, 0.476] |
| **Experiment #17** | 3/9 | 0.333 | [0.075, 0.701] |
| Everything except #17 | 1/10 | 0.100 | [0.003, 0.445] |
| #18 only | 1/9 | 0.111 | [0.003, 0.483] |
| Condition *with* Skill | 2/10 | 0.200 | [0.025, 0.556] |
| Condition *without* Skill | 2/8 | 0.250 | [0.032, 0.651] |
| `max_tokens` 4000 | 0/8 | 0.000 | [0, 0.369] |
| `max_tokens` 8000 or 16000 | 4/11 | 0.364 | [0.109, 0.692] |
| By campaign | Gate 3 2/4 · Phase 1 1/5 · v3 0/6 · v4 1/2 | | |

**Fisher exact tests** (hypergeometric, on 2×2 tables):

| Comparison | Counts | Two-sided p | One-sided p |
|---|---|---|---|
| #17 vs other experiments | 3/9 vs 1/10 | 0.30 | 0.25 (#17 higher) |
| *with* vs *without* | 2/10 vs 2/8 | 1.00 | — |
| `max_tokens` ≥ 8000 vs 4000 | 4/11 vs 0/8 | 0.10 | 0.085 |

Arithmetic for the `max_tokens` test: the one-sided p is C(11,4)·C(8,0)/C(19,4) = 330/3876 = 0.0851.

**Interpretation.** With 19 trials and 4 events, the per-dispatch 429 probability is plausibly anywhere from about 6 % to about 46 %. Nothing distinguishes the groups:
- **Experiment:** #17's apparent excess (3/9 against 1/10) is well within chance (p = 0.30).
- **Condition:** 2 of the 429s were *with* and 2 were *without*.

For planning (an illustration, **[I]**): at an assumed true rate of p = 0.2, a 10-slot no-retry stop-on-429 schedule completes with probability 0.8¹⁰ ≈ 0.107. At p = 0.06, the lower CP bound, it is 0.94¹⁰ ≈ 0.54. Even the optimistic end of the interval makes completion roughly a coin flip.

### 4.2 Candidate associations

| Candidate | Evidence | Assessment |
|---|---|---|
| Experiment (#17 vs #18) | 3/9 vs 1/10, p = 0.30 | no evidence of association |
| Condition (with / without Skill) | 2/10 vs 2/8, p = 1.0 | no evidence. Mechanically implausible (see below) |
| Input size | The 429 requests are about 0.9k–1.1k actual prompt tokens (the same prompts later completed at 1124, 1142 and 1034 tokens). The largest request in the history, 25,408 prompt tokens (conventions), completed. | no association |
| Time since previous call | 429 gaps: 6 h 27 m, 22 m, 6.8 m, 5.1 s. Non-429 gaps include 1.3–4.9 s (5 consecutive v3 requests: four completed, one, `c-17-with-2`, truncated) and up to 3.7 days. | no association. Short gaps did not produce 429s in v3, and long gaps did not prevent them |
| Time of day (UTC) | 429s at 16:14, 21:53, 22:02, 20:03, all afternoon or evening UTC (US daytime). 3 of the 4 fell inside 20:00–22:10 UTC, but so did 9 of the 15 non-429 dispatches. Of all 19 dispatches, 3 were before 16:00 UTC, and all 3 succeeded. | not separable from when the operator worked. Weak at best |
| `max_tokens` (4000 vs 8000/16000) | 0/8 vs 4/11, p = 0.10 two-sided | **not significant, and confounded** with campaign and date: every 4000-cap request was 10-27 or 10-31. **[I] hypothesis only**: if the upstream admits by reserving `max_tokens` against a token budget, a larger cap could be rejected more often. No DeepInfra or OpenRouter documentation fetched here confirms such accounting. Worth recording but not acting on. |
| Position in session | Each of the four 429s was the 2nd paid request of its session (X1, X2, Phase 1, v4), but v3 then ran 6 back to back without a 429 (one of them truncated), and Phase 1 continued successfully after its 429. | probably coincidence. The gaps before them range from 5 s to 6.5 h, which rules out a mechanism on our side tied to request spacing **[I]** |
| Endpoint health | the one recorded pre-dispatch snapshot before a 429 (#4) shows 30-minute uptime of 96.3 %, the only sub-100 30-minute reading archived. On 10-21 and 10-22 the status flipped to -2 within an hour of #2 and #4. | **[I] suggestive** of transiently degraded or busy DeepInfra capacity around #4. Not available for the other 429s |

**Is condition dependence mechanically plausible?** No. Requests with and without the Skill are identical in model, routing (`only`/`order`/`allow_fallbacks: false`/`require_parameters`), `max_tokens`, temperature, `response_format` (the same strict JSON schema), `usage.include` and headers. They differ only in prompt bytes: the Skill block in the system message, recorded as 103 Skill tokens in the v4 README (assembly 4835 bytes against 4068). A provider sees the Skill only as about 100 more prompt tokens, roughly +10 % on about 1k, and that cannot plausibly move an admission decision made in about 300 ms. Two of the four 429s also had no Skill **[V]**.

## 5. Recommended telemetry (no code changed)

What the current implementation **does not record** but would need to diagnose future 429s:

1. **The upstream `raw` payload.** Only its presence is kept (`error-detail.ts` line 207). Keep a bounded, sanitized excerpt (for example 120 characters through `sanitizeText`) or a closed-vocabulary classification. That would separate DeepInfra's "Rate limited" (concurrency cap) from "model busy" and from OpenRouter's "temporarily rate-limited upstream".
2. **Unknown `error.metadata` keys.** Only 5 named keys are read. Keep the *names* (not values) of every metadata key, plus safe booleans such as `is_byok`, which is reported in third-party captures of this error.
3. **Response header names on error responses**, and a few more values:
   - all header names;
   - `date`;
   - OpenRouter or Cloudflare request identifiers (`cf-ray`, any `x-openrouter-*` or `x-generation-id` on the error path);
   - `x-request-id` is already read, but OpenRouter did not send it.

   Today only the 9 `x-ratelimit-*` names, `retry-after` and `x-request-id` are read (lines 21–31, 191, 209). With no identifier, an OpenRouter support ticket cannot reference the request.
4. **Precise timing.** Absolute submit and response timestamps with millisecond precision, and the time to response headers, rather than `durationMs` alone. In v4, durations were recorded inconsistently: 303 ms in the attempt, 409 ms in the run stats and 419 ms in the serve log.
5. **Endpoint state at dispatch.** v3 and v4 persisted no pre-dispatch endpoint snapshot (`status`, `uptime_last_5m`/`30m`/`1d`). The X2 slot script did, and it was the most informative context available.
6. **Archiving.** Phase 1's run traces were never exported: the stack directory holds only `clones/`, so `x-17-without-1` survives only as a documentation summary. The 10-21 429 predates `errorDetail` entirely. Future 429 slots should always have their trace exported before teardown.
7. **Account-level context.** OpenRouter says it governs capacity "globally" per account. Other keys on the same account are invisible to the settlement, which reads only the dedicated key. That is irrelevant for an upstream-pool 429, but needed to exclude account-level throttling formally.

## 6. Findings

1. **[V, high]** Across all HW2 paid work there were 19 provider dispatches, all to `deepseek/deepseek-v4-flash` via `deepinfra/fp8` with fallbacks off and no retries:
   - 14 completed;
   - 1 was truncated (v3 `c-17-with-2`);
   - 4 got HTTP 429: X1 `x-18-without-1`, X2 `x-17-with-1`, Phase 1 `x-17-without-1`, v4 `c-v4-17-with-2`.
2. **[V, high]** None of the 429s was billed. The key's lifetime usage of $0.00714906 equals, exactly, the sum of the 15 completed or truncated dispatches, and each per-session settlement delta matches.
3. **[V, high]** Every 429 failed within 0.3–0.9 s of submission, with no response ID, generation, usage or router metadata, and with nothing else in flight from our side.
4. **[V, high]** For the three 429s with diagnostics (two from traces, one from the documentation), OpenRouter labelled the error `provider_name: DeepInfra` and `limit_source: upstream_provider_shared_pool`, attached an upstream `raw` payload, and sent no `Retry-After`, no `X-RateLimit-*`, no `error_type` and no request ID. `origin: upstream_provider` is DevDigest's own derivation from the presence of `provider_name`.
5. **[I, high]** These are not OpenRouter per-key, account, free-tier or credit limits:
   - every documented OpenRouter-side `limit_source` starts with `openrouter_`;
   - documented platform 429s carry `X-RateLimit-*` headers, and these did not;
   - the model is not `:free`;
   - credit was ample;
   - our request rate was negligible.
6. **[I, medium-high]** The root cause is transient saturation of DeepInfra capacity that OpenRouter serves to all of its customers from one shared, non-BYOK pool. Our request was rejected at admission, and pinning `only=[deepinfra/fp8]` with `allow_fallbacks: false` removed OpenRouter's normal recovery path.
7. **[U]** The 10-21 429 (no `errorDetail`) is attributed to the same cause only by analogy. DeepInfra's actual load and the meaning of the raw payload cannot be verified from what was stored.
8. **[V+I, high that it is not the cause]** The data show no association with the experiment, the Skill condition, input size or our request spacing. The Skill cannot plausibly matter mechanically.
9. **[I, low]** The weak `max_tokens` pattern (0/8 at the 4000 cap against 4/11 at higher caps, p ≈ 0.10) and the evening-UTC clustering are hypotheses only, and both are confounded with date and campaign.
10. **[I, high]** The empirical 429 rate is about 21 % per dispatch (CP95 6–46 %). At any rate in that interval, a long no-retry stop-on-429 schedule is unlikely to finish. #17's failures to complete are explained by the study's 429 policy combined with this base rate, not by anything specific to #17.

## 7. Limitations

- **Tiny sample.** 19 dispatches and 4 events over 12 days, on one model and one endpoint. Every interval is wide, and every association test has negligible power. "No association" means only that the data cannot detect one.
- **Missing or partial records.**
  - Phase 1 has no archived trace; its rows come from `EXPERIMENTS.md` and the ledger.
  - Phase 1's `max_tokens` is inferred.
  - #2 has no `errorDetail`.
  - Pre-dispatch endpoint state exists only for #2 (coarse) and #4.
- **Upstream evidence.** The upstream `raw` payload was never stored, by design, so DeepInfra's own wording is unknown.
- **Undocumented field.** OpenRouter's public documentation does not define `upstream_provider_shared_pool`. Its interpretation rests on the label itself, the absence of platform-limit headers, OpenRouter's general description of upstream 429s, and secondary GitHub reports. DeepInfra's documentation describes per-account concurrency and "model very busy" 429s, but not how OpenRouter's traffic is provisioned.
- **Timing precision.** Durations differ by layer (attempt, run, serve log), and Phase 1 start times are ledger times, not attempt times. Gaps are accurate to about ±1 s for Phase 1.
- **Endpoint uptime.** The semantics of OpenRouter's endpoint `uptime` and `status` fields, including whether 429s count against uptime, were not documented on the pages fetched.
- **Account scope.** Other keys on the same OpenRouter account were not examined. Under the hard boundaries, no live probe or account query was made.
