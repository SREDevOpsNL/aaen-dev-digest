# HW2 Gate 3 — exploration plan

**Status (2026-10-20):** prepared; **Gate 3 is not authorized.**
- No spending capability exists.
- No paid request has been made; the dedicated key's usage is 0.

Execution needs your separate, explicit Gate 3 authorization. The commands are
in the [operator guide](HW2-experiment-operator-guide.md#gate-3-exploration-on-stack-x--usd-050).
Facts are marked **[F]** and estimates **[E]**.

## Preconditions (GO checklist)

| # | Condition | State |
| --- | --- | --- |
| 1 | The preparation PR is merged, with green CI: experiment 17 reviewer seeding, condition-faithful `preview`, `require_parameters` | pending review |
| 2 | Phase 0 endpoint check passes for the chosen slug (`structured_outputs`, status 0, one endpoint for a full slug) | **[F]** passes for `deepinfra/fp8` (2026-10-20) |
| 3 | Phase 0 previews pass for all four experiment/condition pairs | **[F]** pass (below) |
| 4 | Routing slug decided: copy it from the model page's provider copy button | pending your confirmation |
| 5 | Key `limit_remaining` is 2, usage 0 | **[F]** 2 / 0 after the previews |
| 6 | Explicit Gate 3 authorization | not given |

## Provider and routing

Live metadata comes from the public `GET /api/v1/models/deepseek/deepseek-v4-flash/endpoints`,
which needs no key (2026-10-20) **[F]**:

| Provider | Tag | `structured_outputs` | Status | Uptime 30 min / 1 day | Max completion | In / Out USD per 1M tokens | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DeepInfra | `deepinfra/fp8` | yes | 0 | 100 / 100 | 65,536 | 0.090 / 0.180 | **preferred** |
| StreamLake | `streamlake/fp8` | yes | 0 | 100 / 100 | 384,000 | 0.0826 / 0.1652 | proposed planning alternative |
| GMICloud | `gmicloud/fp8` | **no** | 0 | 100 / 100 | 943,717 | 0.091 / 0.182 | unsuitable (below) |

- **Routing.** The request sends `order = only = [slug]`,
  `allow_fallbacks: false` and `require_parameters: true`.
  - OpenRouter therefore never routes it to an endpoint that would ignore the
    strict `json_schema` response format.
  - It never falls back to another provider. An alternative is for planning
    only: switching provider means new settings, a new exploration slot on the
    new slug and, at Gate 4, a new manifest.
- **GMICloud.** It advertises only `response_format`, not `structured_outputs`,
  so `require_parameters` filters it out. That is why StreamLake is proposed in
  its place, subject to your decision.
- **Slug.** OpenRouter documents full slugs as
  `provider[/variant][/region][/tier]` (e.g. `deepinfra/turbo`, `baseten/fp4`).
  - A base slug (`deepinfra`) matches every endpoint of that provider.
  - The endpoints `tag` is not documented as a routing value.
  - Use the slug copied from the model page. If it is `deepinfra/fp8`, freeze
    that. Otherwise use `deepinfra`, which Phase 0 shows matches exactly one
    endpoint today.

## Real free-preview figures [F]

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

- **Reservation per slot:** the smallest round value ≥ 1.2 × the largest worst
  case (1.2 × $0.005947 = $0.0071), which is **$0.01**.
- **Capability:** `--budget 0.15` is proposed as the hard cap. The formal
  Gate 3 ceiling stays $0.50; the total stays ≤ $1.50; the key limit is $2.

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
- completion tokens: the largest must be ≤ 50% of the cap.

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
