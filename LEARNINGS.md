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

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
