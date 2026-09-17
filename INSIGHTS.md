# DevDigest — insights

Durable findings recorded by the `engineering-insights` skill: things that are
true about this code but not visible in it. Append within a section, newest
first. Correct a stale entry with a dated note beneath it rather than editing it
away.

This is the **root** file: it holds only findings that cross package boundaries.
Anything scoped to one package lives in that package's file —
[`client`](client/INSIGHTS.md) · [`server`](server/INSIGHTS.md) ·
[`reviewer-core`](reviewer-core/INSIGHTS.md) · [`e2e`](e2e/INSIGHTS.md).

Sections are fixed. Add to the one that fits; never invent a new heading. When an
entry becomes stable reference material, promote it into `docs/` and delete it
here.

## Decisions

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

## Codebase Patterns

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

## Tool & Library Notes

## Recurring Errors & Fixes

## Open Questions
