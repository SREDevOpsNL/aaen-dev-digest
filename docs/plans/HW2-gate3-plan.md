# HW2 Gate 3 — exploration plan

**Status (2026-10-22):** two slots ran on stack X, one at a time, each
separately authorized (see [Execution log](#execution-log-stack-x-hw2f-f53ed971)).
- No spending capability exists; both were revoked after their slot.
- Stack X was closed on 2026-10-22 at 19:25:56 UTC, after its evidence was
  exported and verified ([Closure of stack X](#closure-of-stack-x)). Further
  slots run on a new stack X2 and need separate authorization
  ([Next stack X2](#next-stack-x2-planning-not-authorized)).

Phase 0 is the unpaid part of Gate 3: the free endpoint check and the four
free previews, on the final stack X. Execution of paid slots needs your
separate, explicit Gate 3 authorization after Phase 0 passes. The commands are
in the [operator guide](HW2-experiment-operator-guide.md#gate-3-exploration-on-stack-x--usd-050).
Facts are marked **[F]** and estimates **[E]**.

## Preconditions (GO checklist)

| # | Condition | State |
| --- | --- | --- |
| 1 | The preparation PR (#28) is merged, with green CI: experiment 17 reviewer seeding, condition-faithful `preview`, `require_parameters` | **[F]** merged as `f786c94` (2026-10-21) |
| 2 | Phase 0 endpoint check passes for the confirmed endpoint-specific slug (exactly one live endpoint, `structured_outputs`, status 0) | **[F]** passed on stack X `hw2f-f53ed971` (2026-10-21 08:59 and before each slot); rerun on X2 |
| 3 | Phase 0 previews pass for all four experiment/condition pairs | **[F]** passed on X, identical to the figures below; rerun on X2 |
| 4 | Endpoint-specific routing slug confirmed from the model page's copy button (no provider-wide fallback) | **[F]** `deepinfra/fp8`, confirmed by you (2026-10-21) |
| 5 | Key `limit_remaining` covers the slot; usage equals the recorded spend | **[F]** usage $0.00022896, remaining $1.99977104 (2026-10-21 16:26); recheck on X2 |
| 6 | Explicit Gate 3 authorization, per slot | **[F]** given for `x-18-with-1` and `x-18-without-1` only; none active |

## Provider and routing

Live metadata comes from the public `GET /api/v1/models/deepseek/deepseek-v4-flash/endpoints`,
which needs no key (2026-10-20; rechecked 2026-10-21 07:20 UTC with the same
tags, `structured_outputs` flags, status and prices) **[F]**:

| Provider | Tag | `structured_outputs` | Status | Uptime 30 min / 1 day | Max completion | In / Out USD per 1M tokens | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DeepInfra | `deepinfra/fp8` | yes | 0 | 100 / 100 | 65,536 | 0.090 / 0.180 | **preferred** |
| StreamLake | `streamlake/fp8` | yes | 0 | 100 / 99.7 | 384,000 | 0.0826 / 0.1652 | planning alternative |
| GMICloud | `gmicloud/fp8` | **no** | 0 | 100 / 100 | 943,717 | 0.091 / 0.182 | unsuitable (below) |

- **Routing.** The request sends `order = only = [slug]`,
  `allow_fallbacks: false` and `require_parameters: true`.
  - OpenRouter therefore never routes it to an endpoint that would ignore the
    strict `json_schema` response format.
  - It never falls back to another provider. An alternative is for planning
    only: switching provider means new settings, a new exploration slot on the
    new slug and, at Gate 4, a new manifest.
- **DeepInfra** is the preferred provider, subject to the endpoint check on
  the final stack X.
- **StreamLake** is the planning alternative. Using it at Gate 3 means
  starting X with its slug and prices, and rerunning Phase 0 there.
- **GMICloud** is not an alternative. It advertises only `response_format`,
  not `structured_outputs`, so `require_parameters` filters it out. This
  holds unless fresh metadata shows `structured_outputs` for it.
- **Slug.** OpenRouter documents full slugs as
  `provider[/variant][/region][/tier]` (e.g. `deepinfra/turbo`, `baseten/fp4`).
  - Gate 3 requires an **endpoint-specific** slug that you confirm from the
    model page's copy button, expected to be `deepinfra/fp8`. It must match
    exactly one live endpoint.
  - A provider-wide selector (`deepinfra`) matches every endpoint of that
    provider, including ones added later, so it is never used and the checks
    refuse it.
  - The endpoints `tag` is not documented as a routing value. Phase 0
    compares the confirmed slug with it, so a slug that matches no tag is a
    blocker too.
  - If the copy button shows no endpoint-specific slug, or the confirmed slug
    does not match exactly one live endpoint, that is a **blocker**: stop and
    decide (for example StreamLake's endpoint-specific slug) before Phase 0.

## Real free-preview figures [F]

These measured bounds replace the earlier planning estimate of 20,000 input
tokens per call. They are 10,009–12,051 tokens.

Measured on a keyed disposable stack (`hw2f-14e8ba66`) from the preparation
branch, with:
- `deepinfra/fp8`, frozen prices equal to live (9e-8 / 1.8e-7 USD per token);
- a 16,000 output cap;
- the runner's condition-faithful `preview` command;
- no capability.

Key usage was 0 before and after, and no run was created.

| Pair | Linked skills | Input bound | Worst case (× 1.5) |
| --- | --- | --- | --- |
| 18 / with | breaking-change | 12,051 | $0.005947 |
| 18 / without | — | 10,009 | $0.005671 |
| 17 / with | Edge Cases and Error Paths | 11,177 | $0.005829 |
| 17 / without | — | 10,670 | $0.005760 |

The preflight checks held for every pair:
- one live endpoint matched (`deepinfra/fp8`);
- the bound plus the cap fit the 1,048,576-token context;
- the cap is within the 65,536 maximum completion.

The non-Skill fingerprint is equal across conditions within each experiment.
The `without` previews carry the empty-list Skill fingerprint, and the `with`
previews carry a real one.

## Schedule and costs

| Value | Proposed | Unchanged limit |
| --- | --- | --- |
| Capability budget (`authorize --budget`) | stack X: **$0.15** per slot (historical). X2: per slot, X2's charge plus one $0.01 reservation, within an X2 maximum of **$0.13** ([addendum](HW2-experiment-operator-guide.md#gate-3-on-stack-x2-addendum)) | formal Gate 3 ceiling $0.50 |
| Per-slot reservation | **$0.01**: the smallest round value ≥ 1.2 × the largest worst case (1.2 × $0.005947 = $0.0071) | — |
| Slots | **4** initial, **2** optional | — |
| Output cap | **16,000** tokens | endpoint maximum completion 65,536 |
| Total across Gates 3 and 4 | — | $1.50 |
| Dedicated key | — | $2 limit, never resets |

Every Gate 3 command in the operator guide uses these values, and its checks
fail if a capability or reservation differs. On X2, the capability checked
before a slot must equal the amount in that slot's written authorization. If 1.2 × the largest worst case on
X exceeds $0.01, Phase 0 fails: a higher reservation needs a new approval.

| Order | Slot | Fixture / reviewer | Condition |
| --- | --- | --- | --- |
| 1 | `x-18-with-1` | #502 / API Contract Reviewer | with `breaking-change` |
| 2 | `x-18-without-1` | #502 | without |
| 3 | `x-17-with-1` | #501 / Test Quality Reviewer | with `Edge Cases and Error Paths` |
| 4 | `x-17-without-1` | #501 | without |
| 5 (optional) | `x-18-with-2` | #502 | with |
| 6 (optional) | `x-17-with-2` | #501 | with |

Slots 5–6 run only if the first four leave the output cap or provenance in
doubt.

| Quantity | Value |
| --- | --- |
| Reserved per slot | $0.01 **[F, derived]** |
| Maximum reserved, 4 / 6 slots | $0.04 / $0.06 |
| Expected actual per call | about $0.0008–0.0025 **[E]** (L03 reviews: about 1.7k–2.9k input and 2.6k–2.75k output tokens) |
| Expected actual, 6 slots | about $0.005–0.015 **[E]** |
| Gate 4 projection | 20 × about $0.01 ≈ $0.20, under $1.00 **[E]**; recomputed on stack E |

## Revalidate on the final stack X

Values measured on another stack, or on an earlier day, do not carry over.
Before Gate 3 authorization, Phase 0 on X must show:

| # | Item | How (operator guide, Gate 3) | Expected |
| --- | --- | --- | --- |
| R1 | Exact routing slug | the model page's copy button | one endpoint-specific slug, confirmed by you and frozen for X; a provider-wide selector is refused |
| R2 | Strict structured-output support | step 2 endpoint check | exactly one live endpoint for the slug, `structured_outputs` advertised, status 0 |
| R3 | Live endpoint prices and limits | step 2 settings check | X's frozen prices equal the live ones; 16,000 ≤ maximum completion; bound + cap within context |
| R4 | Key usage and remaining limit | Gate 2 checklist, `GET /api/v1/key` | usage 0 (or the recorded total), limit 2, `limit_remaining` covers the authorized capability |
| R5 | Four free previews | step 3, `phase0-check` | all four `ok`, at the $0.01 reservation and the 16,000 cap, each with exactly its condition's links |
| R6 | Reservation | step 3 check | 1.2 × the largest worst case ≤ $0.01 |
| R7 | Prompt fingerprints | step 3, `phase0-check` | non-Skill fingerprint equal across `with` and `without` per experiment; Skill fingerprint equal to the one recomputed from the current target skill (`with`) or from no Skills (`without`) |
| R8 | Fixture identity | `check` (§3) | PRs #501 and #502 only, fresh intents, frozen diff hashes; no PR #3 |
| R9 | Isolation | `check` (§3) | disposable database, loopback non-development port, empty per-stack clone directory, dedicated key file |
| R10 | No spending capability | step 3, capability check (fails closed) | neither `capability.json` nor `capability.token` exists for X before the previews |

## Per-slot checks

Never judge a slot from the runner's exit code. Judge it from the ledger state
and the trace:
- the selected endpoint;
- router `attempt` = `attempts` = 1, or a single `provider_responses` entry;
- the serving provider's display name and the served model;
- a generation id that the lookup accepts, or its unavailability recorded;
- a known reported cost that agrees with the change in the key's usage
  (`GET /api/v1/key`) to within $0.001;
- `finish_reason: stop` and a valid schema;
- completion tokens: the largest must be ≤ 50% of the cap;
- for a failed slot, the attempt's sanitized `errorDetail`: origin, `error_type`,
  `provider_code`, provider name, `Retry-After`, request id.

## Stops

**Operational, checked by the operator after every slot.** Stop at the **first**
occurrence of any of these and investigate manually before any further paid
slot:
- unknown cost, or an `ambiguous` slot;
- truncation (`finish_reason: length`);
- a schema failure;
- a timeout;
- insufficient or conflicting provenance;
- a provider, model or fallback mismatch, or more than one attempt;
- any refusal;
- charged (actual plus reserved) above $0.10;
- the key's usage exceeding the ledger total by more than $0.01.

**Built-in, enforced by the code:**
- The runner stops on a refusal, a budget refusal, a fingerprint mismatch,
  2 consecutive unknown-cost slots or 3 consecutive infrastructure failures.
- The server enforces the capability (phase, gate, budget, expiry), the phase
  and total budgets (409), one slot in flight, and no replay of a used slot id.
- The preflight refuses at zero cost when the worst case exceeds the
  reservation.

The operational stops are stricter than the built-in ones. They do not replace
them.

A provider error is diagnosed from the persisted `errorDetail` only, never by
sending another request. An endpoint `status` of 0 does not guarantee capacity:
slot 2 met a 429 ten seconds after a status-0 check.

## Execution log (stack X `hw2f-f53ed971`)

Slot ids are scoped to a stack, so every slot is named by its
`(stack_id, slot_id)`; X's slots are `(hw2f-f53ed971, …)`.

| Slot | When (UTC) | Outcome | Cost |
| --- | --- | --- | --- |
| `x-18-with-1` | 2026-10-21 09:46:10–09:46:47 | **completed**: one request to DeepInfra (`deepseek-v4-flash-20260423`), one provider response, `finish_reason: stop`, schema valid, 1,586 in / 479 out / 0 reasoning tokens (3% of the cap), 1 grounded CRITICAL finding | $0.00022896, equal in ledger, generation record and key usage |
| `x-18-without-1` | 2026-10-21 16:14:26 | **failed**: HTTP 429 `Provider returned error` after 906 ms; no response id, generation id, router metadata or tokens | unknown; no change in key usage after about 11 minutes; charged at its $0.01 reservation |

- **Accounting:** confirmed spend $0.00022896. The ledger and server charge
  $0.01022896, because the unknown-cost slot counts at its full reservation.
- **Diagnosis of the 429:** not possible from the record. The engine kept only
  the status and the message, so it is unknown whether OpenRouter or DeepInfra
  limited the request. That gap is what the error-diagnostics change closes.
- **Timing:**
  - the generation lookup right after slot 1 returned `not_found`, and
    succeeded 38 s later;
  - key usage reflected slot 1 about 100 s after completion;
  - for later slots, poll both for up to about 10 minutes, and stop and report
    when attribution stays uncertain.
- **Endpoint status:** `deepinfra/fp8` showed status -2 from about 08:37 to
  08:40 UTC, with 100% uptime, and status 0 at 08:34 and from 08:59.
- **Recorded deviations:**
  - the revoked slot-1 token was kept as `capability.token.slot1-revoked`,
    because the runbook's no-capability check rejects any `capability.token`;
  - slot 2 used the approved $0.15 aggregate budget, a form that was not
    stated before it ran.
- **Reviewer finding of slot 1:** the expected breaking change, but labelled
  `category: "security"`. It is recorded for the final report; no Skill,
  rule or fixture changes because of it.
- **Evidence:** outside the repository, in
  `~/.devdigest/hw2-experiments/hw2f-f53ed971/` (`phase0/`, `gate3-slot1/`,
  `gate3-slot2/`, `evidence/`, `gate3-export/` and `closure/`, each with
  `SHA256SUMS`).

### Closure of stack X

Stack X `hw2f-f53ed971` was closed on **2026-10-22 at 19:25:56 UTC**. It was
stopped by its own `scripts/e2e.sh --serve` teardown (Ctrl-C in its terminal),
under separate approval, after every pre-shutdown check had passed:
- **Capability:** none active, and no symlinked capability file. The two
  remaining token files are inert without `capability.json`.
- **In flight:** no slot; both slots terminal on the server; no runner process
  and no runner lock.
- **Runs:** exactly two in the database, each matching its ledger slot.
- **Traces:** the exported traces name the right stack, slot and run, and are
  equal to the live ones.
- **Database export:** 2 `agent_runs` and 2 `run_traces` records with the
  ledger's run ids.
- **Integrity:** every evidence checksum verified, and a secret scan of 59
  files was clean (no API key, no capability token).

Final ledger:

| Slot `(stack_id, slot_id)` | Run | Outcome | Charge |
| --- | --- | --- | --- |
| `(hw2f-f53ed971, x-18-with-1)` | `b111a514-113f-407a-bca9-23d1ebdd2878` | completed | $0.00022896 (known cost) |
| `(hw2f-f53ed971, x-18-without-1)` | `6fd06290-8e91-46b5-a57f-3fe695d6a867` | failed, HTTP 429, cost unknown | $0.01 (full reservation) |

- **Confirmed OpenRouter spend:** $0.00022896.
- **Conservative ledger charge:** $0.01022896. This is the value counted
  against the original $0.15 exploration envelope.
- **Teardown:** the container `devdigest-hw2f-f53ed971` was removed, and ports
  3250, 3251 and 5450 were released. The development database container was
  not touched.
- **After teardown:** all 59 evidence files were byte-identical to a snapshot
  taken before it, and every checksum still verified.
- **Evidence location:** outside the repository, in
  `~/.devdigest/hw2-experiments/hw2f-f53ed971/`. The closure records are in
  `closure/`, with their own `SHA256SUMS`.

**Neither Gate 3 outcome is evidence for or against the effectiveness of a
Skill.**
- Exploration validates infrastructure only, and its slots are excluded from
  the experiment result ([Methodology](#methodology)).
- `(hw2f-f53ed971, x-18-with-1)` completed and reported the fixture's breaking
  change, labelled `category: "security"`.
- `(hw2f-f53ed971, x-18-without-1)` produced no review at all.

The with-Skill versus without-Skill comparison belongs only to the
pre-registered Gate 4 confirmatory runs.

## Next stack X2 (planning, not authorized)

- The diagnostics change (PR #31, merged as `9f6f955`) altered the
  implementation fingerprint, so stack X no longer represented `main`. X was
  closed on 2026-10-22 ([Closure of stack X](#closure-of-stack-x)).
- X2 starts from the updated `main` and repeats Phase 0 (R1–R10) in full.
- **Budget** (approved policy, 2026-10-22; procedure in the
  [operator guide's X2 addendum](HW2-experiment-operator-guide.md#gate-3-on-stack-x2-addendum)):
  - X2's planning maximum is **$0.13** of its own conservative charge.
  - X's **$0.01022896** stays counted separately against the original $0.15
    exploration envelope.
  - Each X2 slot gets a capability of X2's current charge plus exactly one
    $0.01 reservation. The written authorization names that amount, and the
    check before the slot requires the capability to equal it.
  - The capability bounds spend, not attempts: a slot refused at zero cost
    adds nothing, so the same capability would admit another attempt. One
    attempt per authorization comes from the procedure: one guarded block
    authorizes, runs every check, runs a single `run --count 1`, and revokes
    the capability on every exit after authorizing, a failed check included.
  - An X2 server knows nothing about X. Before every X2 authorization, and
    again immediately before dispatch, the operator checks X's ledger against
    its recorded charge, X2's charge against $0.13, and both together against
    $0.15.
- **Slot identity** (approved, 2026-10-22): slot ids stay scoped to their
  stack; the runner is unchanged. Every record names a slot by
  `(stack_id, slot_id)`.
  - `(hw2f-f53ed971, x-18-without-1)` is the first without-Skill attempt of
    experiment 18. It is consumed, never replayed, and keeps its unknown cost
    and full $0.01 charge.
  - The second attempt, if authorized, will be `(<X2 id>, x-18-without-1)`.

## Evidence and the Gate 3 report

Before X stops:
- export in exploration mode (operator guide, *Export the evidence before
  teardown*, with steps 2 and 5 skipped and step 7 run with `exploration`);
- the secret scan must be clean;
- record the checksums;
- the offline settlement must equal the runner's charged total.

Then stop X and write the Gate 3 report, proposing the frozen Gate 4 values:
- slug and display name;
- served model and endpoint;
- prices and retrieval time;
- output cap: at least 2× the largest observed completion, within 65,536;
- per-slot reservation;
- generation-lookup policy.

## Methodology

Exploration validates infrastructure only. Detection outcomes are never used to
tune fixtures, skills or rules; any change and its reason is recorded.
Exploration slots are excluded from the experiment result.
