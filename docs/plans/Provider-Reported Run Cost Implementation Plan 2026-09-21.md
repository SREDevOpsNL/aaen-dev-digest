# Provider-Reported Run Cost Implementation Plan 2026-09-21

## Summary and Current State

Implement a nullable, provider-reported USD Cost for each agent run and expose it on the PR list, review-run accordion, and run-trace sidebar. Existing token-price estimation remains available internally but is explicitly separated from the authoritative value persisted as Cost.

Repository inspection resolves the earlier ambiguities:

- Each `reviews` row has one nullable `run_id`; each agent pass creates its own `agent_runs` row and review.
- “Latest applicable review” is the existing PR-list definition: the newest `reviews` row for that PR where `kind = 'review'`, ordered by `reviews.created_at DESC`.
- PR Cost is the authoritative cost stored on that review’s associated run. Do not aggregate multiple runs and do not fall back to an older review when the latest review has no linked or authoritative cost.
- `OpenRouterProvider` currently conflates provider-reported `usage.cost` with an `estimateCost(...)` fallback in `costUsd`. That field cannot be persisted directly.
- Existing/applied migrations must not be modified. New schema changes use `pnpm db:generate`; generated migrations are reviewed and committed with the schema.

Current working tree:

```text
 M .claude/skills/engineering-insights/SKILL.md
 M CLAUDE.md
 M LEARNINGS.md
?? docs/plans/
```

Provenance:

- The three tracked modifications are recent Engineering Insights work, not committed baseline content.
- The untracked Sequential Prompt-Entry plan must be preserved.
- The Run Cost entry in root `LEARNINGS.md` is also a recent uncommitted addition.
- No files were changed during this Plan Mode investigation.

One prerequisite correction remains pending because Plan Mode prohibits mutation: append a dated entry at the end of root `LEARNINGS.md` → `Codebase Patterns & Tool / Library Notes`, explicitly correcting the existing Run Cost entry. State that `OpenRouterProvider.costUsd` uses `usage.cost` when present but otherwise uses the injected estimator; cite `reviewer-core/src/llm/openrouter.ts:96-107`, `reviewer-core/src/review/run.ts:159-184`, and `server/src/platform/container.ts:181-188`. Preserve the original entry unchanged.

## Confirmed Requirements and Existing Behavior

### Confirmed product requirements

- Persist USD Cost per agent run.
- Persist only supplied/provider-reported cost, never a token-price calculation.
- Display the associated run’s Cost for the latest applicable PR review.
- Display Cost for each individual reviewer run near its timestamp.
- Display Cost in the General Reviewer trace sidebar beside Duration, Tokens, and Findings.
- When authoritative cost is unavailable, persist `NULL` and display `—`, not `$0.00`.

### Existing system behavior

- OpenRouter requests `usage.cost`; `OpenRouterProvider` currently returns that value or an estimator fallback through the same `costUsd` field.
- OpenAI and Anthropic adapters populate `costUsd` exclusively through `estimateCost(...)`.
- `reviewPullRequest` sums `costUsd` across single-pass or map-reduce calls.
- `run-executor` currently persists tokens, duration, findings, score, blockers, and trace data, but discards the engine’s cost.
- `agent_runs` is the persistence record for one agent pass. `reviews.run_id` links one review to that run without a database foreign key.
- The PR-list query selects the newest `kind = 'review'` row per PR for Score.
- Canonical contracts live under `server/src/vendor/shared`; the client copy is updated afterward.
- UI hosts are `PRRow`, `ReviewRunAccordion`, and `RunTraceDrawer` → `TraceBody`.

## Ordered Implementation

### 0. Append the prerequisite Engineering Insights correction

- **Modules/files:** root `LEARNINGS.md`.
- **Change:** Append a dated correction to the existing Run Cost entry. Explain that engine `costUsd` is provider-reported-or-estimated, so it is not safe as the persisted authoritative value.
- **Dependencies:** None; do this before Cost code.
- **Gate:** Verify the original entry remains byte-for-byte unchanged and the correction is appended at the end of the same heading.

### 1. Separate provider-reported cost from estimated cost

- **Modules/files:** canonical shared LLM adapter contract, its client mirror, OpenRouter/OpenAI/Anthropic implementations, server mocks.
- **Change:** Add nullable `providerCostUsd` to `StructuredResult`. Preserve existing `costUsd` as the current best-available provider-or-estimated value.
  - OpenRouter: populate `providerCostUsd` only when every response involved in that structured call reports numeric `usage.cost`; sum retries. If any response omits cost, return `NULL`.
  - OpenAI and Anthropic: continue returning estimates in `costUsd`; return `providerCostUsd: null`.
  - Treat a provider-reported zero as authoritative zero.
- **Dependencies:** Server canonical contract changes before the client mirror.
- **Gate:** Reviewer-core/provider tests prove that an estimator fallback can populate `costUsd` while `providerCostUsd` remains null.

### 2. Aggregate authoritative cost through reviewer-core

- **Modules/files:** `reviewer-core/src/review/run.ts` and reviewer-core tests.
- **Change:** Add `providerCostUsd` to `ReviewOutcome`. Sum it across all single-pass/map-reduce calls only when every call has authoritative cost; otherwise return null. Leave the existing `costUsd` aggregation unchanged for current consumers.
- **Dependencies:** Step 1.
- **Gate:** Unit tests cover one call, multiple chunks, real zero, and one missing chunk cost causing the authoritative aggregate to become null.

### 3. Add generated run-cost persistence

- **Modules/files:** `server/src/db/schema/runs.ts` and generated Drizzle migration artifacts.
- **Change:** Add nullable `doublePrecision('cost_usd')` to `agent_runs`, matching existing repository cost-column conventions. Historical rows remain null; no backfill.
- **Migration workflow:** Change schema first, run `pnpm db:generate`, review the generated additive `ALTER TABLE`, and commit schema plus generated migration metadata together. Never hand-write or modify migrations `0000`–`0009`.
- **Dependencies:** Data semantics from Steps 1–2.
- **Gate:** Generated SQL only adds the nullable column; Testcontainers migrations succeed from an empty database.

### 4. Persist and trace only authoritative cost

- **Modules/files:** review run executor and review run repository.
- **Change:** Extend `completeAgentRun` with nullable `costUsd`. On successful completion, store `outcome.providerCostUsd`; on failed or cancelled runs, leave/store null. Add the same authoritative value as nullable `trace.stats.cost_usd`.
- **Dependencies:** Steps 2–3.
- **Gate:** DB integration tests prove provider cost is stored, estimator-only cost is not stored, and failed/cancelled runs retain null.

### 5. Expose Cost through existing reads and contracts

- **Modules/files:** pull-list route, review/run repositories and DTO helpers, canonical shared contracts, client mirror.
- **Change:**
  - `PrMeta.cost_usd`: cost from the run linked to the newest `kind = 'review'` row selected by the existing PR-list ordering.
  - `ReviewRecord.cost_usd`: left-join the review’s `run_id` to `agent_runs`.
  - `RunSummary.cost_usd`: read directly from `agent_runs`.
  - `RunStats.cost_usd`: nullable/optional so historical trace JSON without the field remains safe.
- **Lookup semantics:** If the newest review has `run_id = null`, its run was deleted, or its run has no authoritative cost, return null. Do not use another run or older review.
- **Dependencies:** Steps 3–4; server contract first, client mirror second.
- **Gate:** Integration tests verify the correct newest review/run is selected and legacy/null records serialize safely.

### 6. Add shared formatting and translations

- **Modules/files:** a non-vendored client formatting helper and English `prReview`/`runs` messages.
- **Change:** Add `formatUsdCost(value)`:
  - null, undefined, invalid, or negative → `—`;
  - authoritative zero → `$0.000`;
  - positive values → USD with 3–6 significant digits, preserving values such as `$0.012` without rounding them to `$0.01`.
- **Component decision:** Do not introduce a shared visual Cost component. The three hosts use different existing presentations; only the formatter is shared.
- **Translations:** Add PR-list Cost heading, review-run Cost label, and trace-stat Cost label.
- **Dependencies:** Contract shapes from Step 5.
- **Gate:** Formatter unit tests cover null, zero, small fractional cost, ordinary cost, and invalid input.

### 7. Render the three UI surfaces

| Surface | Existing host | Planned change | Exact proposed placement |
| --- | --- | --- | --- |
| Pull Requests list | `PRRow`, `COLUMN_KEYS`, and shared grid styles | Add a dedicated Cost column using `PrMeta.cost_usd` | Immediately after Score and before Status |
| Individual reviewer run | `ReviewRunAccordion` | Render the formatted `ReviewRecord.cost_usd` with the existing compact metadata styling | After the score badge and immediately before the run timestamp |
| General Reviewer sidebar | `RunTraceDrawer` → `TraceBody` | Add a fourth existing `Stat` using `trace.stats.cost_usd` | After Findings in the Stats row, alongside Duration, Tokens, and Findings |

- **Dependencies:** Steps 5–6.
- **Gate:** Component tests verify known and missing Cost values on all three surfaces without touching `client/src/vendor/ui`.

### 8. Update canonical documentation after implementation

- **Modules/files:** product boundary and architecture documentation.
- **Change:** Mark run-cost attribution operational only after persistence, contracts, and all three UI surfaces work. Document that persisted Cost is provider-reported while existing estimation remains internal and separately named.
- **Dependencies:** Steps 1–7 passing.
- **Gate:** Check relative links and ensure documentation does not claim providers always report cost.

## Data and Interface Semantics

- **Authoritative source:** `providerCostUsd`, derived only from provider-supplied usage cost.
- **Estimated source:** Existing `costUsd`, which may be provider-reported or token-price-estimated. It remains available internally but is never written to `agent_runs.cost_usd`.
- **Database:** Nullable PostgreSQL double precision column `agent_runs.cost_usd`.
- **Historical data:** Existing rows remain null.
- **Missing provider data:** Persist null across the DB, DTOs, and trace; display `—`.
- **Map-reduce/retries:** Authoritative run cost is the sum only when all constituent provider responses report cost; otherwise the entire authoritative run cost is null rather than partial.
- **PR Cost:** The cost of the run linked by `run_id` from the newest `kind = 'review'` row for the PR, using the same ordering as the current Score rollup.
- **No aggregation:** Multiple agents create separate reviews/runs; the PR list uses only the latest review’s associated run.
- **Formatting:** USD, 3–6 significant digits; missing and true zero remain distinguishable.

Public interface additions:

- `StructuredResult.providerCostUsd: number | null`
- `ReviewOutcome.providerCostUsd: number | null`
- `PrMeta.cost_usd`
- `ReviewRecord.cost_usd`
- `RunSummary.cost_usd`
- `RunStats.cost_usd`

## Test Plan

### Reviewer-core unit tests

- Provider-reported OpenRouter cost populates both existing cost and `providerCostUsd`.
- Missing `usage.cost` with a working estimator populates only existing `costUsd`.
- Map-reduce sums complete provider costs.
- One missing provider cost makes authoritative aggregate null.
- Provider-reported zero remains zero.

### Server unit and DB integration tests

- Generated migration creates nullable `agent_runs.cost_usd`.
- Provider-reported cost persists through a completed review.
- Estimated-only cost is not persisted.
- Failed/cancelled and legacy runs remain null.
- Run history, review DTO, and trace expose the same authoritative value.
- PR list selects the linked run of the newest review, not the highest-cost, newest run, or aggregate.
- Latest review with null/missing run cost returns null rather than falling back.
- Existing pull-list Score and status behavior remains unchanged.

### Client tests

- Formatter tests cover precision and null behavior.
- New `PRRow` test covers Cost and `—`.
- New `ReviewRunAccordion` test covers Cost immediately before the timestamp and missing Cost.
- Extend `RunTraceDrawer.test.tsx` to assert the fourth Cost stat and null fallback.
- Verify grid header and row cell counts remain aligned.

### E2E

Do not add a Cost-specific E2E flow in this slice. The current deterministic seed has a review without a linked run/trace; restructuring seed ownership solely for this display would expand scope. Existing hermetic E2E remains a regression gate, while DB integration and component tests cover the complete data/UI path.

## Validation and Final Order

Implementation order:

1. Append the Engineering Insights correction.
2. Separate provider-reported and estimated cost.
3. Aggregate provider cost in reviewer-core.
4. Add schema and generate the new migration.
5. Persist cost and include it in traces.
6. Extend reads and canonical contracts, then mirror the client contracts.
7. Add formatter/i18n.
8. Render and test the three UI surfaces.
9. Update product documentation.
10. Run the complete validation set and inspect the final diff.

Expected commands:

```powershell
cd reviewer-core
npm run typecheck
npm test

cd ..\server
pnpm db:generate
pnpm db:migrate
pnpm typecheck
pnpm exec vitest run --exclude '**/*.it.test.ts'
pnpm exec vitest run .it.test

cd ..\client
pnpm typecheck
pnpm test

cd ..\e2e
npm run typecheck
npm run e2e:hermetic

cd ..
git diff --check
git status --short
```

Migration cautions:

- Never edit migrations `0000`–`0009`.
- Do not hand-write the new migration.
- Review the generated journal/snapshot changes.
- Apply only to the intended database; Testcontainers integration remains the safe migration proof.
- Preserve every unrelated dirty or untracked file.

Unresolved questions: none. Current source resolves PR-level semantics and cost provenance.

No Cost schema field, migration, contract, UI, or Cost test was created while producing this plan.
