# Successor study for criteria 17 and 18: truncation analysis and draft design (Agent D, 2026-11-01)

**Status: draft only.** The coordinator freezes it later against the final
integrated code. Nothing here authorizes a request. Every figure comes from
the item B v3 archive, the global ledger, the repository at `0c41f33`, or
earlier archived endpoint and generation records. No web or paid call was
made. The draft quotes no private prompt or response text: only counts,
sizes, field names and the already-public finding text in `packet.json`.

---

## Part 2: why `c-17-with-2` was truncated

### 2.1 Per-slot token, cost and timing record

The record comes from `forensics/slot-*.json` and `run_traces.json`.

- **Usage counts** (`tokensIn`/`tokensOut`) are the response `usage`. They
  are billed: cost = in × 9e-8 + out × 1.8e-7 exactly, for all six slots.
- **Generation counts** (`tokensPrompt`/`tokensCompletion`) are OpenRouter's
  `tokens_prompt`/`tokens_completion` from `GET /generation`.

| Slot | Usage in / out | Generation prompt / completion | Out ÷ completion | Cost (USD) | Finish | Findings | `raw_output` chars | Chars per usage token | `durationMs` | Router `generation_time` (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c-18-with-5 | 1,373 / 431 | 1,501 / 402 | 1.072 | 0.00020115 | stop | 1 | 1,608 | 3.73 | 29,186 | 9,921 |
| c-18-without-5 | 911 / 76 | 991 / 76 | 1.000 | 0.00009567 | stop | 0 | 303 | 3.99 | 30,953 | 2,252 |
| c-17-with-1 | 1,142 / 1,736 | 1,139 / 1,388 | 1.251 | 0.00041526 | stop | 7 | 5,552 | 3.20 | 56,891 | 28,208 |
| c-17-without-1 | 1,034 / 1,992 | 1,013 / 1,679 | 1.186 | 0.00045162 | stop | 7 | 6,534 | 3.28 | 47,257 | 19,642 |
| c-17-without-2 | 1,034 / 1,456 | 1,013 / 1,193 | 1.220 | 0.00035514 | stop | 5 | 4,767 | 3.27 | 49,544 | 28,688 |
| **c-17-with-2** | **1,142 / 4,000** | not found | — | 0.00082278 | **length** | — | not kept | — | 109,401 | 50,920 |

**Reasoning-token fields.** None of the archived v3 records carries one:

- `routerMetadataRaw` keys: region, attempt, is_byok, summary, strategy,
  endpoints, requested, generation_time;
- the generation summary keys: model, status, totalCost, finishReason,
  providerName, tokensPrompt, tokensCompletion, providerResponses;
- the usage is stored only as the two totals. `completion_tokens_details`
  is not kept, and `run_traces.json` contains no `reasoning` key.

**Phase 1, same endpoint, user-role Skill placement, not poolable:**

| Slot | Usage out | Generation completion | Findings |
| --- | --- | --- | --- |
| x-17-with-3 | 2,540 | 2,235 | 10 |
| x-18-with-1 | 463 | 412 | 1 |
| x-18-without-1 | 438 | — (generation not found) | 1 |

### 2.2 The gap between usage and generation counts (1,736 vs 1,388) is a tokenizer difference, not hidden output

- **How the code reads each count.** `reviewer-core/src/llm/openrouter.ts`
  (`completeExperiment`) sets `tokensOut = usage.completion_tokens` and
  `tokensIn = usage.prompt_tokens`. `openrouter-metadata.ts`
  (`summarizeGeneration`) reads the generation record's `tokens_prompt` and
  `tokens_completion`. It does not read `native_tokens_*`.
- **Earlier archived generation records show which is which.** Two full
  records from the same `deepinfra/fp8` endpoint, read raw before the
  summarizer, carry both families:
  - `hw2f-f53ed971/gate3-slot1/post-key-and-generation.txt`, 2026-10-21:
    `tokens_prompt` 1,785 against `native_tokens_prompt` 1,586;
    `tokens_completion` 438 against `native_tokens_completion` 479;
    `native_tokens_reasoning` 0. Its `total_cost` 0.00022896 = 1,586 ×
    9e-8 + 479 × 1.8e-7, so billing follows the **native** counts.
  - `hw2f-39febf41/.../x2-state.txt`, 2026-10-22:
    `native_tokens_reasoning` 0.
- **So the attempt's usage counts are native and billed, and the
  generation's `tokens_*` are normalized.** The prompt counts confirm it:
  they also disagree, in both directions (1,142/1,139, 1,034/1,013,
  1,373/1,501, 911/991). Hidden reasoning cannot explain a disagreement on
  the input side.
- **Output gaps.** Usage exceeds the generation completion by 0–25%. The
  output text is about 4.0 characters per normalized token in every slot
  (5,552/1,388 = 4.0; 6,534/1,679 = 3.9; 4,767/1,193 = 4.0; 1,608/402 = 4.0;
  303/76 = 4.0). Per native token it is 3.2–4.0: the native tokenizer is
  less efficient on the code-heavy JSON these findings contain.
- **Can reasoning be excluded for v3?** Not proven: v3 did not capture
  `native_tokens_reasoning` or `usage.completion_tokens_details`. Three
  things make it unlikely:
  - the same endpoint, without a reasoning parameter, reported
    `native_tokens_reasoning: 0` twice;
  - the gap follows content (it is 0 on the 76-token answer);
  - the input side shows the same tokenizer disagreement.
- **The request itself.** `experimentRequestBody` sends `model`,
  `messages`, `temperature: 0`, `max_tokens`, a strict `json_schema`
  `response_format`, `usage.include`, and `provider` with `only`/`order`,
  `allow_fallbacks: false` and `require_parameters: true`. It sends **no**
  `reasoning`, `include_reasoning` or `reasoning_effort`, so the endpoint
  default applies.
- **The endpoint can reason.** The archived endpoint listing
  (`gate4-readiness-20261023/openrouter-endpoints-deepseek-v4-flash-*.json`)
  lists `reasoning`, `include_reasoning` and `reasoning_effort` among
  DeepInfra's `supported_parameters`, with `max_completion_tokens` 65,536.
  The observed default emitted 0 reasoning tokens. Under OpenRouter's
  documented semantics (recalled, not re-checked here), reasoning tokens are
  billed as output and count toward `max_tokens`. If v3 had any, they would
  be inside the 4,000.
- **Conclusion.** `c-17-with-2` produced 4,000 billed native completion
  tokens of output. Nothing in the record suggests that any part of the cap
  went to hidden tokens.

### 2.3 Size per finding, and what 4,000 tokens represents

| Measure | c-17-with-1 | c-17-without-1 | c-17-without-2 | Phase 1 x-17-with-3 |
| --- | --- | --- | --- | --- |
| Native output tokens per finding | 248 | 285 | 291 | 254 |
| Raw characters per finding | 793 | 933 | 953 | — |
| Minified JSON per finding (chars) | 715 | 698 | 779 | — |
| Whitespace in the raw output (chars) | 305 | **1,443 (22%)** | 260 | — |

At 248–291 tokens per finding, 4,000 tokens would be **about 14–16
findings** if the output were a well-formed list. That is 2.3× the twin
slot's 1,736 tokens and 1.6× the largest completed #17 output on this
endpoint (2,540, Phase 1). The fixture has about 8–10 distinct untested
behaviours, so a well-formed 14–16-finding list would mean duplication or
over-splitting. The other candidate is a runaway: whitespace or repetition
inside the JSON. The text was discarded, so these cannot be told apart.

### 2.4 Weighing the causes

| Cause | Evidence | Weight |
| --- | --- | --- |
| **Provider/model nondeterminism at temperature 0** | The two requests for `c-17-with-1` and `c-17-with-2` match on every recorded measure: Skill fingerprint, non-Skill fingerprint, diff hash and input tokens (1,142). They returned 1,736 and ≥4,000 tokens. fp8 batching on a shared pool does not guarantee determinism. | **Primary: the variance is real and heavy-tailed** |
| **Cap size** | The 4,000 cap was 1.57× the largest completed output observed (2,540) and 2.3× the twin. That is too little headroom for a distribution whose tail is unknown. The longest *with* response is now known only as "≥4,000". | **Primary: the enabling condition** |
| **Verbosity and reviewer instructions** | The Test Quality prompt sets no limit on findings and asks for "concrete missed behaviors". The fixture offers many. Each finding carries a rationale (≈200 chars) and a suggestion (≈120–145 chars). | Contributing, symmetric across arms |
| **Structured-output overhead** | 13 keys per finding, including `trifecta_components`, `evidence`, `kind` and `suggestion`: about 157 characters of key names, ≈20% of each finding. Whitespace is uncontrolled (9 to 1,443 characters per response), and runaway whitespace is a known failure mode of strict JSON-schema decoding. | Contributing; a runaway is plausible but unproven |
| **System-role Skill interaction** | The Skill adds ≈500 system characters (2,373 vs 1,876) and lists six input categories to look for. On the completed slots the *with* output (1,736 tokens, 7 findings) is not longer than *without* (1,992/7 and 1,456/5). The one truncation in a *with* slot is n=1. | **Not supported** as the cause |
| **Hidden reasoning tokens** | No request parameter is set; the endpoint default showed 0 reasoning tokens twice; the gap is explained by the tokenizer (2.2). | **Unlikely**; not provable for v3 |
| **Report or parser issues** | `finish_reason=length` is checked before `parseWithRepair` runs, so the parser did not cause the stop. The "sent 0 skills" label is a failure-path recording gap, not a cause. | **Excluded** |

**Evidence limit.** The failure path stores neither the raw truncated output
nor the assembled prompt (`run-executor.ts` line 622), and the generation
record was `not_found`. Whether the 4,000 tokens were a long list, a loop or
whitespace is **not recoverable**.

---

## Part 3: draft successor design

### 3.1 Output cap and controls (more than "raise the cap")

**Recommendation: an 8,000-token cap combined with four controls. The
controls matter more than the cap value.**

1. **Cap 8,000.** The rule: the smallest round value of at least 3× the
   largest *completed* output observed on this endpoint and fixture (3 ×
   2,540 = 7,620, rounded to 8,000). It must stay within the unchanged
   $0.005 reservation at the code's margins (see 3.2: up to 9,971 tokens
   fits), and within the endpoint's 65,536 maximum completion tokens. The
   cap bounds cost and runaways; it is not a quality limit. A truncation
   would cost about $0.0015.
2. **Truncation does not stop the schedule.** A `finish_reason=length` slot
   is provenance-checked, has a known cost and is not an infrastructure
   fault. It is recorded as `failed`, not retried and not replaced, and the
   schedule continues. These still stop the schedule, as in v3: a 429, a
   timeout, unknown cost, missing provenance, a fingerprint mismatch or an
   ambiguous outcome. This needs a change to the runner's stop rule.
3. **Predeclared conservative imputation for a truncated slot.** It counts
   *against* the hypothesis: a truncated *with* slot counts as `no`, a
   truncated *without* slot as `yes`. A truncation can then never help a
   pass, and an experiment is not left `incomplete` by one long response.
   This changes `reveal()` and `experimentOutcome` (`adjudication.ts` and
   `rules.ts`). Report imputed slots separately. The alternative, if the
   owner prefers not to impute: keep `incomplete`, but continue the other
   experiment.
4. **Failure-path telemetry, no change to the request.**
   - Keep the truncated `raw_output` privately, in the trace or a private
     forensic export.
   - Store the assembled prompt on the failure path, so the "0 skills"
     label disappears.
   - Capture `usage.completion_tokens_details.reasoning_tokens` and the
     generation's `native_tokens_*` and `native_tokens_reasoning`, so that a
     future truncation is diagnosable.

**Rejected controls:**

- **A finding-count cap** (`maxItems` or a prompt limit). The only
  detecting finding in v3 was **f7, the 7th of 7**. A cap of 6 or fewer
  would have removed it, and any count cap interacts with the treatment.
- **A "be concise" instruction or a smaller output schema.** It changes
  the frozen reviewer, and its effect on detection is unmeasured.
- **Repetition or frequency penalties.** They change sampling in both arms
  for an unproven loop.
- **An explicit `reasoning` setting.** The default already shows 0
  reasoning tokens. With `require_parameters: true` the setting could change
  routing, and verifying it would need a paid exploratory slot.

### 3.2 Worst-case cost per condition

The formula is from `server/src/modules/_shared/experiment.ts` `preflight`:
**worst = (input bound × input price + cap × output price + request fee) ×
1.5** (`COST_CONTINGENCY`). `phase0Problems` in
`server/src/experiments/hw2/cli.ts` adds a requirement: **1.2 × the largest
worst case ≤ the per-slot reservation**. The inputs are the v3 bounds, which
the freeze will recompute (`inputUpperBound` = max(tokenizer count, UTF-8
bytes of the body) + 512), with $9e-8 input, $1.8e-7 output and $0 per
request.

| Cap | 17 with (9,474) | 17 without (8,967) | 18 with (10,921) | 18 without (8,879) | 1.2 × max | ≤ $0.005? | Σ worst, 20 slots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4,000 (v3) | 0.00235899 | 0.00229054 | 0.00255433 | 0.00227867 | 0.00306520 | yes | 0.04741268 |
| 6,000 | 0.00289899 | 0.00283055 | 0.00309434 | 0.00281867 | 0.00371320 | yes | 0.05821268 |
| **8,000** | **0.00343899** | **0.00337054** | **0.00363433** | **0.00335866** | **0.00436120** | **yes** | **0.06901267** |
| 9,971 (largest that fits) | 0.00397116 | 0.00390272 | 0.00416651 | 0.00389083 | 0.00499981 | yes | 0.07965607 |

- **$0.005 per slot is enough** for any cap up to 9,971 tokens at the v3
  input bounds. Above that, the reservation must rise.
- **Ledger now.** Applying the code's `spent()`/`charge()` to `ledger.jsonl`
  gives **$0.0163864** conservative: $0.01404478 exploration (including the
  $0.01 held for the `x-17-without-1` 429) plus $0.00234162 confirmatory.
  No slot is unresolved.
- **Envelope for 20 slots.** 20 × $0.005 = **$0.10 capability budget**.
  `scheduleFits` passes, since 0.10 ≤ the $1.00 confirmatory cap. The
  cumulative ceiling is **$0.0163864 + $0.10 = $0.1163864**, provided
  nothing else is charged first; `writeCapability` checks charged + budget
  ≤ ceiling. The totals stay far below the $1.50 aggregate cap.
- **Expected actual spend** is about 20 × $0.0003–0.0005 ≈ $0.006–0.010.

### 3.3 Discriminative validity

**#17: keep the two-part rule unchanged.** The Skill names "boundary" among
its categories, and the one completed *with* slot met both halves. Both
*without* slots met only the error-branch half. The fixture, the Skill v1
and the reviewer are fit to test the hypothesis.

**#18: the failure has a genuine engineering component; it is not just the
model.**

- **The diff hides nothing.** It shows `findPayment(id)` →
  `findOne({ id })` in context, the new `findPaymentByReference` →
  `findOne({ reference })`, and the unchanged
  `if (!payment) return reply.code(404)` line. The PR body even says the
  change avoids "exposing internal ids". A careful reviewer can derive the
  404 from the diff alone, so a detection is possible in principle.
- **The `breaking-change` Skill v1 points at the excluded answer.** Its
  first "What to flag" item is a path parameter "removed or renamed on an
  existing route". Its Severity section makes "a removal, rename or type
  change" CRITICAL. "Meaning" changes are listed only for *fields*. It never
  says that a path placeholder rename is wire-neutral. It has no category
  for "the same request now resolves differently (lookup key or
  interpretation changed in place)".
- **The model followed the Skill.** The v3 *with* finding (public packet)
  even notes that "the route pattern itself is the same". It still
  concluded that the rename breaks clients, citing "the breaking-change
  skill: a removal/rename". Phase 1 shows the rename framing is also the
  model's default: both arms flagged the rename and neither the 404. The v3
  *without* slot reported nothing.
- **So the treatment, as written, adds no knowledge that would separate the
  arms under the frozen rule.** Its text raises the odds of the excluded
  rename claim. Rerunning Skill v1 would test a mis-specified Skill.
  Expected: 0/5 against 0/5, `negative`.
- **There is also a ground-truth wording defect,** on the adjudicator side.
  The fixture's store comment says public references look like `pay_...`.
  `FIXTURE_GROUND_TRUTH['18']` and `hw2-fixture-ground-truth.test.ts` use
  `pay_123` as the *ID* and `ref_abc` as the reference. The model's input is
  unaffected, but the adjudicator-facing example contradicts the fixture.
  Fix it in packet v2: an ID such as `pmt_123` and a reference such as
  `pay_abc`, with the test changed to match.

**Recommendation for #18:**

- Report Skill v1 as **unresolved/unsupported**: 0/1 against 0/1 adjudicated,
  study incomplete. Its text gives no reason to expect a Skill-specific
  detection.
- A successor arm for #18 is defensible **only** with a disclosed Skill v2,
  under four conditions:
  - it is generic: it says a path-placeholder rename alone is wire-neutral,
    and it adds "a path or query parameter whose accepted values or lookup
    key change in place, so existing requests resolve to a different
    resource or a 404", with no payments or reference wording;
  - it is justified by v1's demonstrable false positive, not by the
    fixture;
  - it is re-approved through the Skill approval gate, under a new body
    sha;
  - the report states that the Skill was revised after v3's results, so
    the result says nothing about v1.
- If the owner does not accept that disclosure, run the successor for #17
  only.

### 3.4 Blinding: predeclared, versioned redaction

**Problem.** In v3, `blindingWarnings` (`adjudication.ts`) only *records*
leaking terms. One of the three *with* cases leaked its condition
("skill", "breaking-change").

**Proposal: packet and mapping version 2, redaction method `r1`, frozen in
the pre-registration.** The design (for the coordinator to implement and
test; not implemented here):

- **Terms.** `REDACTION_TERMS_R1` = the existing `LEAK_TERMS` (`skill`,
  `untrusted source`, `with-skill`, `without-skill`) plus every target Skill
  name. Each term is matched case-insensitively with word boundaries and
  common inflections (`skills`, `skill's`). Longer terms are matched first,
  so "Edge Cases and Error Paths" is replaced whole before "skill".
  Generic words ("error path", "boundary", "breaking change" without the
  hyphen) are **not** terms.
- **Replacement.** A single neutral token, `[review-guidance]`, applied to
  the title and rationale of **every case in both arms**.
- **`redactFinding(f, terms)`** returns the redacted title and rationale and
  a `redactions` count. `preparePacket` gains `redaction: 'none' | 'r1'`.
  The packet carries `version: 2` and `redaction: { method: 'r1',
  terms_sha256 }`. The term list itself stays out of the packet.
- **Originals stay private:** `private/originals.json` (mode 0600), with
  its digest recorded in the mapping. The mapping (`version: 2`) records,
  per case, `redactions` and `original_findings_sha256`.
- **Residual-compromise rules, recorded and never hidden:**
  - `marker-present`: the token appears in a case. The marker itself
    signals that a Skill was mentioned, so redaction reduces the leak but
    does not remove it.
  - `term-survived`: a condition-revealing term is still found after
    redaction.
  - `evidence-changed`: the anchored-regex screen from the frozen rules
    file gives a different result on the original and the redacted text.
    The redaction may have removed scoring evidence. The case is still
    judged on the redacted text; re-showing the original would unblind it.
- **`reveal()`** reports `blinding: { warnings_original, redacted_cases,
  residual: [...] }`. `blinding_compromised` is true when `residual` is not
  empty.
- **Hermetic tests:** term matching and inflections, symmetric application
  across arms, the three residual reasons, and digest stability.
- **Adjudicator instruction,** in the frozen text: the token is not
  evidence of a condition and must not be used to infer one.

### 3.5 Study skeleton

| Element | Successor | Same as v3? | Reason |
| --- | --- | --- | --- |
| Study / manifest | manifest version 4, new pre-registration file and sha | changed | v3 is closed; nothing is carried over or pooled |
| Slot IDs | `c-v4-<exp>-<cond>-<trial>`, for example `c-v4-17-with-1` | changed | IDs are never reused. The form keeps the `c-` prefix that `PHASE_SLOT_PREFIX` requires and matches the slot regex. It needs `slotId()`/`buildSchedule` to accept a study tag |
| Seed | uint32 of the first 8 hex digits of sha256(`"hw2-itemb-v4\|" + manifest fingerprint computed without the schedule`), recorded | changed | Derived, not hand-picked; reproducible; differs from 20261030 |
| n per condition | 5 scheduled pairs per experiment (20 slots), or 10 if #18 is dropped | same | Matches the frozen 4/5-versus-≤1/5 rule in `rules.ts` and `reveal()`. Even at true rates 0.8/0.2 the pass probability is only 0.54; at 0.9/0.1, 0.84. State this; do not call it significant |
| Stop rules | no retry, reprompt, fallback or replacement. Stop on 429, timeout, unknown cost, provenance gap, fingerprint mismatch or ambiguity. **A truncation continues** with conservative imputation | partly changed | v3 stopped on truncation; see 3.1 |
| Output cap | 8,000 | changed | 3.1; changes the non-Skill fingerprints, which include `max_tokens` |
| Model, endpoint, prices, temperature 0, single-pass, repo-intel off, retries 0 | unchanged | same | Isolates the cap and protocol changes |
| Reviewer prompts and output schema | unchanged | same | A changed reviewer would confound the comparison |
| #17 Skill, fixture #501, rule text | unchanged | same | Valid as is (3.3) |
| #18 Skill | v2, disclosed, or #18 excluded | changed or dropped | 3.3 |
| #18 ground-truth wording | ID/reference example fixed | changed (adjudicator side only) | Consistency with the fixture |
| Fixture diffs #501 and #502 | unchanged | same | No model-input defect found |
| Adjudication | 2 independent sealed adjudicators; packet v2 with redaction r1 | partly changed | 3.4 |
| Failure-path telemetry | raw truncated output kept privately; assembled prompt and reasoning-token fields stored | changed | 2.4 evidence limit |
| Budget | $0.005 per slot, $0.10 budget, ceiling $0.1163864 (recompute at freeze) | same per slot | 3.2 |
| Phase 1 and v3 slots | reported separately, never pooled | same | Different placement or cap |

### 3.6 Is a new study justified?

**For #17: yes.**

- Cost: ≤ $0.10 reserved, about $0.01 expected.
- The pilot direction is favourable: 1/1 against 0/2.
- The v3 defects (cap headroom, stop-on-truncation, failure-path evidence,
  blinding) have concrete and cheap fixes.

**For #18:**

- Only with a disclosed Skill v2.
- Otherwise report it as unresolved/unsupported for Skill v1, rather than
  spend on a predictable negative.
