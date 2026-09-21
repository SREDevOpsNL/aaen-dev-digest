# DevDigest Product Boundary

> **Document role:** Canonical statement of what is operational, partially wired,
> or scaffolded in the current product.
> **Last verified:** 2026-09-21 against `main` at
> `4cdbd57db1345c0d80dcc0ef82d6831fc400797b`.

This document prevents future-facing schemas, contracts, prompts, and UI mounts
from being mistaken for shipped capabilities. For the stable product definition,
read [`00_PRODUCT_IDENTITY.md`](./00_PRODUCT_IDENTITY.md). For implementation
flow, read
[`docs/architecture/00_ARCHITECTURE_OVERVIEW.md`](../architecture/00_ARCHITECTURE_OVERVIEW.md).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Operational** | Reachable through the registered application and wired end to end through the required service and persistence layers. |
| **Partial** | Some useful runtime behavior exists, but the named product capability is incomplete or has a material limitation. |
| **Scaffolded** | Schema, contract, prompt slot, helper, or UI placeholder exists without a registered end-to-end feature. |
| **Not operational** | No current end-to-end product path was verified. |

## Operational product surface

| Capability | Status | Current behavior |
| --- | --- | --- |
| Local workspace | Operational | The MVP runs as one seeded user in one default workspace without a login flow. |
| Provider and GitHub keys | Operational | Keys can be entered and tested in Settings; values are stored outside Postgres and are never returned by the API. |
| Repository registration | Operational | A GitHub URL is parsed, deduplicated in the workspace, persisted, and queued for cloning. |
| Local clone and refresh | Operational | Repositories are cloned/fetched through the Git adapter; private repositories can use the configured GitHub token. |
| Repository indexing | Operational | JS/TS-family source is indexed after clone and incrementally on refresh/resync. |
| Pull-request import | Operational | PR lists and details are fetched from GitHub and persisted; cached data remains readable when GitHub is unavailable. |
| PR browsing | Operational | The UI provides repository PR lists and PR overview, findings, and files-changed views. |
| Agent management | Operational | Users can create, update, enable/disable, delete, and version reviewer configurations. |
| One-agent review | Operational | A selected agent can review a PR even when that agent is disabled for “run all.” |
| Run-all selection | Operational | All enabled agents receive run rows and execute with failure isolation. They currently execute sequentially, not in parallel. |
| Structured model output | Operational | Review output is validated against the shared schema, with bounded repair/retry behavior. |
| Custom agent output schema | Partial | Agent records can store and version `output_schema`, but the current executor always asks `reviewer-core` for the shared `Review` schema and does not pass the custom schema. |
| Single-pass and map-reduce review | Operational | Agents can use single-pass, map-reduce, or automatic selection. Automatic mode maps by file only for multi-file diffs over 400 changed lines. |
| Prompt-injection boundary | Operational | PR prose, diff content, repo maps, caller context, and project-context slots are delimiter-wrapped and treated as untrusted data. |
| Citation grounding | Operational | Diff findings whose file/range does not intersect a real changed hunk are discarded. |
| Deterministic score | Operational | Score starts at 100 and subtracts 35/12/3 for grounded critical/warning/suggestion findings, with a floor of zero. |
| Review decision signals | Operational | The stored verdict remains model-generated, while score and blocker count are derived deterministically from grounded severities. These signals can disagree and are not normalized into one authority. |
| Live run progress | Operational | Run events are streamed through SSE from an in-process event bus. |
| Run history and trace | Operational | Run status, metrics, logs, prompt assembly, raw model output, and findings are persisted. Failure and cancellation traces are also retained. |
| Map-reduce prompt trace | Partial | A map-reduce trace stores chunk labels, joined raw outputs, and a whole-diff prompt-assembly representation; it does not persist every exact per-file message sent to the model. |
| Run cost attribution | Operational | Authoritative provider-reported USD cost is persisted per run and exposed through the APIs and all three UI surfaces. Missing provider cost remains `null`, and the engine's best-available estimated `costUsd` stays separate. Database-backed migration/persistence tests and the hermetic end-to-end regression gate passed against the verified source revision above. |
| Run cancellation | Partial | Cancellation is checked before model chunks. It cannot interrupt a model request already in flight, and a single-pass review has no later chunk checkpoint. |
| Finding disposition | Operational | Findings can be accepted or dismissed locally. |
| Inline GitHub comments | Operational | Comments authored in the Files view are read from and posted directly to GitHub; they are not a local comment mirror. |
| Offline read degradation | Partial | Persisted repositories, PRs, and review history remain viewable, but cloning, fresh GitHub sync, comments, and LLM review require their external services. |

## Partially wired or scaffolded capabilities

| Capability | Verified implementation state | Boundary conclusion |
| --- | --- | --- |
| Skills | Tables, agent-skill link routes, contracts, and a review-engine prompt slot exist. There is no registered skills module or primary skills management UI, and the studio run executor does not resolve and pass skill bodies into reviews. | Scaffolded, not an operational review input. |
| Persistent memory / RAG | Tables, vector-oriented schema, embedder wiring, trace fields, and a prompt slot exist. The studio executor does not retrieve memory or pass it to `reviewer-core`. | Not operational. `EMBEDDINGS_ENABLED=true` alone does not make it operational. |
| Project context / specs | Tables, contracts, client hooks, and prompt slots exist, but no context module is registered and the studio executor supplies no specs. | Scaffolded. |
| Intent and PR brief | Schema/contracts exist, but no registered intent or brief module participates in the current review flow. | Scaffolded. |
| Blast Radius | The repo-intelligence facade can calculate impact data, but there is no registered Blast Radius product module or primary UI. Reviews use only caller signatures, repo map, and a high-rank note. | Partial infrastructure, not an operational user feature. |
| Onboarding generator | Schema and a system prompt exist, but no registered onboarding service/route/UI was verified. | Scaffolded. |
| Evaluation and conformance | Schema and contracts exist without a registered eval module or current UI workflow. | Scaffolded. |
| CI export / GitHub Action | CI tables and `reviewer-core` payload helpers exist, but this repository has no active CI runner/export product workflow. | Scaffolded. |
| Automatic reviews | A manual polling route and UI refresh behavior exist, but polling explicitly does not trigger review and the UI displays auto-trigger as off. | Not operational; reviews are manual. |
| Configurable/background PR polling | The `polling_interval_min` setting is stored, but no background scheduler consumes it. The current PR-list page uses a hard-coded 60-second refetch interval while open, plus refresh-on-focus and a manual poll endpoint. | Partial; there is page-driven synchronization, not scheduled background polling. |
| Composed multi-agent review | Selecting all enabled agents is operational, but each agent produces an independent review. The `multi_agent_runs`/composed-review model is not wired into the current run path. | Scaffolded beyond independent sequential runs. |
| Plugins | Installed-plugin schema exists without registered plugin import/export modules or UI. | Scaffolded. |
| Agent performance dashboard | Trace and run metrics provide raw inputs, but no performance dashboard route or primary UI is registered. | Not operational. |
| Weekly digest | A `digests` table exists, but no scheduler, digest module, generator, delivery path, or primary UI is registered. | Not operational. |
| Feature-model settings | Settings can store model choices for future system features. This does not make onboarding, intent, risk brief, conformance, or conventions operational. | Operational configuration surface for mostly scaffolded consumers. |

## Important boundaries and constraints

### Review publication

- Accepting a finding updates its local disposition only.
- Dismissing a finding updates its local disposition only.
- Writing an inline comment in the Files view calls GitHub immediately.
- The local studio does not automatically publish the entire AI review as a
  GitHub review event.
- `reviewer-core` can format a GitHub review payload, but that helper is not an
  end-to-end publishing workflow in the current studio.

### Language coverage

- LLM diff review is text-based and is not hard-limited to one programming
  language.
- Deep repository intelligence currently walks only `.ts`, `.tsx`, `.js`,
  `.jsx`, `.mjs`, and `.cjs` files.
- Repository-intelligence benefits therefore degrade for other languages.

### Local-first and external disclosure

- Local: database, repository clone, settings, run history, findings, and secret
  file.
- GitHub-bound: repository/PR reads, clone authentication, and inline comments.
- LLM-bound during review: diff, PR description, agent prompt, and enabled
  repository-derived context.

### Runtime topology

- The current authentication adapter always resolves one local seeded user and
  workspace.
- The API assumes one process per database for stale-run reaping.
- Clone/index jobs execute in an in-process queue. The `jobs` table records
  status, but it is not a durable broker and queued work is not reconstructed on
  process restart.
- Live SSE buffers and cancellation signals are process-local. Completed traces
  and run status are database-backed.
- On API startup, orphaned `running` review rows are reaped rather than resumed.

### Schema is not capability evidence

The database intentionally includes tables for later course stages. The
following table families must not be cited as proof of operational product
features without registered modules and an end-to-end path:

- `skills`, `skill_versions`, `agent_skills`;
- `memory`, `conventions`;
- `code_chunks`, general `symbols`/`references`, `onboarding`;
- `pr_intent`, `pr_brief`;
- `eval_*`, `conformance_checks`, `composed_reviews`;
- `ci_installations`, `ci_runs`;
- `multi_agent_runs`;
- `installed_plugins`, `digests`.

## Boundary maintenance rule

Move a capability from scaffolded/partial to operational only when all required
pieces are verified together:

1. the server module or equivalent runtime entry point is registered;
2. the service path performs the intended behavior;
3. required data is persisted or returned correctly;
4. the user-facing or automation entry point can reach it;
5. a test or direct runtime observation covers the end-to-end behavior.

Adding a schema, contract, prompt slot, navigation placeholder, or isolated
helper does not satisfy this rule.

## Verification anchors

- Active modules: [`server/src/modules/index.ts`](../../server/src/modules/index.ts)
- Primary navigation: [`client/src/vendor/ui/nav.ts`](../../client/src/vendor/ui/nav.ts)
- Studio review inputs: [`server/src/modules/reviews/run-executor.ts`](../../server/src/modules/reviews/run-executor.ts)
- Finding actions: [`server/src/modules/reviews/findings.ts`](../../server/src/modules/reviews/findings.ts)
- GitHub comments: [`server/src/modules/pulls/routes.ts`](../../server/src/modules/pulls/routes.ts)
- Complete schema: [`server/src/db/schema.ts`](../../server/src/db/schema.ts)
- In-process jobs: [`server/src/platform/jobs.ts`](../../server/src/platform/jobs.ts)
- In-process run bus: [`server/src/platform/sse.ts`](../../server/src/platform/sse.ts)
