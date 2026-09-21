# DevDigest — learnings

Cross-package guidance maintained by
[`engineering-insights`](.claude/skills/engineering-insights/SKILL.md). Apply it
unless current source contradicts it; then trust the source and add a dated
correction.

Module-local findings belong beside their subject —
[`client`](client/LEARNINGS.md) · [`server`](server/LEARNINGS.md) ·
[`reviewer-core`](reviewer-core/LEARNINGS.md) · [`e2e`](e2e/LEARNINGS.md).

## What Works

## What Doesn't Work

- **2026-09-17** — Editing `client/src/vendor/shared/` alone silently desyncs the
  client from the API: it is a hand-copy of the canonical
  `server/src/vendor/shared/`, there is no sync script, and five files already
  lag. Change the server copy first, then mirror. Evidence:
  `diff -rq server/src/vendor/shared client/src/vendor/shared` reports
  `adapters.ts`, `contracts/eval-ci.ts`, `contracts/knowledge.ts`,
  `contracts/productionize.ts` and `contracts/trace.ts` differ.

- **2026-09-17** — No package in this repository has ESLint — no config file, no
  `eslint` dependency, no `lint` script, and no lint step in any of the five
  workflows — so the `eslint-disable` comments in `client/src` suppress a rule
  that has never run, and nothing mechanically enforces hook deps or import
  direction. Do not assume a lint gate exists. Evidence:
  `client/src/lib/hooks/reviews.ts:212`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:39`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:52`.

- **2026-09-18** — The `.cursor/skills → ../.claude/skills` symlink is not checked
  in, so it is absent in a fresh clone and each developer has to create it to use
  the skills from Cursor. Evidence: `ls .cursor` → no such directory;
  `.claude/skills/README.md` now says so rather than asserting the link exists.

## Codebase Patterns & Tool / Library Notes

- **2026-09-20** — Do not assume that URLs, screenshots, or other source
  material supplied in a different ChatGPT or Codex chat is available to the
  active Codex task. Each chat keeps its own transcript, ordinary ChatGPT chats
  do not appear in the Codex sidebar, and request-specific files should be
  attached directly (or added to shared project sources) before a workflow
  depends on them. Evidence:
  https://learn.chatgpt.com/docs/projects?surface=web.

- **2026-09-17** — The starter ships scaffolding for lessons it has not built,
  well beyond empty tables: `client/messages/en/` carries 18 i18n namespaces
  (including `skills`, `conventions`, `eval`, `ci`, `memory`, `blast`, `brief`,
  `context`, `agentPerformance`, `conformance`, `compose`) and
  `server/src/db/schema/` carries 14 schema modules, for features with no module
  and no screen behind them. **Search for existing scaffolding before writing
  any of it**, and never read a contract or namespace as evidence that the
  feature works. Evidence: `client/messages/en/`, `server/src/db/schema/`,
  [product boundary](docs/ai-context/01_PRODUCT_BOUNDARY.md).

- **2026-09-17** — `.gitignore` carries un-ignore rules for an `agent-runner/dist/`
  directory that does not exist; they are pre-staged for the Export-to-CI lesson
  (L06), not leftovers to clean up. `reviewer-core/src/output/to-review.ts`
  likewise formats a `GitHubReviewPayload` for a CI runner that is not in this
  tree. Evidence: `.gitignore:3-6`, `reviewer-core/package.json` description.

- **2026-09-18** — This repository is a public fork of the course repo
  `ai-agentic-engineering-neo/dev-digest`, and no `gh` default repository is
  set. Do not rely on `gh` to choose the base repo: pass
  `--repo SREDevOpsNL/aaen-dev-digest` to every `gh pr` and `gh issue`
  command so nothing lands on the course repo, whose `main` was reverted
  because "homework belongs in forks". Everything pushed here is public.
  Evidence:
  `gh repo view SREDevOpsNL/aaen-dev-digest --json isFork,parent,visibility`
  → fork of `ai-agentic-engineering-neo/dev-digest`, `PUBLIC`;
  `gh repo set-default --view` → "No default remote repository has been
  set"; commit `c6af1e4`.

- **2026-09-20** — Correction to the earlier 2026-09-20 cross-chat context
  entry: the supported operational rule is only that required context and files
  from another ChatGPT or Codex chat must not be assumed available in the
  active Codex task; provide them explicitly or verify their availability before
  depending on them. Evidence:
  https://learn.chatgpt.com/docs/projects?surface=web.

- **2026-09-20** — The Run Cost Badge feature has two conflicting
  specifications. The L01 lab deck (`L01-Lab-slides.pdf`, task 3) puts it on
  two surfaces — a `COST` column in the PR list and a line in the PR-detail
  verdict badge carrying cost plus token counts — and derives the number as
  `tokens × price` from the OpenRouter `usage` field. The later product
  instruction supersedes it: persist a USD cost per run in a new column and
  never compute it from token pricing. Build the stored-USD version — the
  engine already returns a `costUsd` taken straight from the OpenRouter
  response, so no pricing table is needed, and a review points at exactly one
  run, which makes “the latest review’s cost” that run’s cost rather than an
  aggregate. Evidence: `reviewer-core/src/llm/openrouter.ts:107` (`costUsd`),
  `server/src/db/schema/reviews.ts:19` (`runId`),
  [product boundary](docs/ai-context/01_PRODUCT_BOUNDARY.md).

- **2026-09-21** — Correction to the earlier 2026-09-20 Run Cost Badge entry:
  `OpenRouterProvider.costUsd` is not always taken directly from OpenRouter. It
  uses provider-reported `usage.cost` when present, but otherwise falls back to
  the injected token-price estimator; `reviewPullRequest` then aggregates that
  mixed-semantics field. Persisted authoritative Cost must therefore use a
  separate provider-reported field and must not persist `costUsd`. Evidence:
  `reviewer-core/src/llm/openrouter.ts:96-107`
  (`OpenRouterProvider.completeStructured`),
  `reviewer-core/src/review/run.ts:159-184` (`reviewPullRequest`),
  `server/src/platform/container.ts:181-188` (`Container.buildLlm`).

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
