# Homework 2 — compliance matrix (53 mandatory criteria)

Tracks the official Neoversity **Homework No. 2** pass/fail rubric (L02: Skills, Agents, Conventions). **Pass = all 53.** Homework 2 is marked Pass only when every row is *Verified* with behavioural evidence, not when the remediation PRs merge.

- **Baseline:** read-only static audit of `main` at `8a7ffbb` (2026-10-16): 25 pass, 8 partial, 19 fail, 1 no evidence. A static pass means the code supports the behaviour; it still needs a browser or API check at final acceptance.
- **Plan:** six PRs (A–F) and a final acceptance walkthrough; see the remediation plan summary in [PR #16](https://github.com/SREDevOpsNL/aaen-dev-digest/pull/16).
- **Columns:** *implementation evidence* = file, route or function. *Behavioural evidence* = API or unit test, SQL query, browser result or experiment trace. *Regression watch* = what must keep working when a later PR touches the area.

Status values: `Fail`, `Partial`, `No evidence`, `Pass (static)` (audit only), `Implemented (PR #n)` (open or merged, behaviour shown in that PR), `Verified` (final acceptance done).

| # | Criterion | Status | Owner | Implementation evidence | Behavioural evidence | Regression watch |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `AGENTS.md` migration at the root (`CLAUDE.md` symlink or `@AGENTS.md` import) | Implemented (PR #16) | A | `CLAUDE.md` → `AGENTS.md` symlink (Git mode 120000, stored target `AGENTS.md`); `scripts/verify-agent-instructions.mjs` enforces it | Checker passes. Negative runs (regular file, wrong target, `AGENTS.md\n` blob, missing, `CLAUDE.local.md`) each fail. A headless sentinel probe from the root loaded the root instructions once. Imports were rejected: a probe showed no instructions loaded from `client/src/app` (`LEARNINGS.md` 2026-10-16) | Checker in CI (`agent-instructions` workflow) |
| 2 | Same pattern in `server/`, `client/`, `reviewer-core/` | Implemented (PR #16) | A | Symlinks in `server/`, `client/`, `reviewer-core/` (and `e2e/`), enforced by the same checker | Sentinel probes from `client/`, `client/src/app` and `server/src/modules` loaded root + package instructions exactly once each (0 tool calls) | As for 1 |
| 3 | UI architecture skill (pages, page components, shared components, tests, naming) | Implemented (PR #16) | A | `.claude/skills/frontend-ui-architecture/SKILL.md` § "Where things live in `client/src`" and § "Naming conventions" (v1.1.0) | Paths and conventions checked against the tree (`app/**/_components/<Name>/`, `components/<area>/`, `lib/hooks/`, colocated `*.test.tsx`). Loaded in the `/pr-self-review` demo | Keep in sync if PR-B adds shared components |
| 4 | Onion architecture skill (route → service → domain via container; adapters at the boundary; inward dependencies; no adapters from routes) | Implemented (PR #16) | A | `.claude/skills/onion-architecture/SKILL.md` "Non-negotiable boundaries", including "Routes never call adapters directly" with a good/bad example (v1.1.0) | Loaded in the `/pr-self-review` demo for the server file | Existing drift: `modules/pulls/routes.ts` and `modules/polling/routes.ts` call the GitHub port from routes (not changed here) |
| 5 | `pr-self-review` skill exists, type Workflow (skill dispatcher) | Implemented (PR #16) | A | `.claude/skills/pr-self-review/SKILL.md` (`metadata.type: workflow`, `disable-model-invocation: true`) + router `scripts/route-diff.mjs` | Router fixture tests 10/10 (`node --test …/route-diff.test.mjs`, also in CI) | Router tests in CI |
| 6 | Agents in the SKILLS LAB sidebar section | Fail | B | — | — | — |
| 7 | Agents page shows agent cards | Pass (static) | — | `app/agents/_components/AgentsListView`, `AgentCard` | — | PR-B (agent delete modal) |
| 8 | Skills CRUD reads and writes PostgreSQL | Pass (static) | — | `modules/skills/routes.ts` (GET/POST/PUT/DELETE `/skills[/:id]`), `modules/skills/repository.ts` | — (final: API create → SQL row; SQL delete → absent from `GET /skills`) | PR-C (restore, provenance) |
| 9 | Skills page card grid (name, type, description, toggle) | Partial | B | Rail list in `app/skills/_components/SkillsRail` | — | — |
| 10 | Card click opens a side preview | Partial | B | Click navigates to `/skills/:id` | — | — |
| 11 | Add button offers Create and Import; Create in a modal | Partial | B | Separate New / Import buttons | — | — |
| 12 | Create Skill modal: name, description, type, Markdown body | Fail | B | No body field | — | — |
| 13 | Agent Skills tab: link, enable/disable, drag-and-drop reorder | Fail | D | Up/down buttons only (`AgentEditor/_components/SkillsTab.tsx`) | — | — |
| 14 | Drag-and-drop order determines prompt order | Pass (static) | — | `agents/repository.ts` `enabledSkillsForPrompt` orders by `agent_skills.order` | — | PR-D must preserve the order |
| 15 | Import from `.md` (or `.zip`) with a content preview before saving | Pass (static) | — | `ImportSkillDrawer` accepts `.md/.markdown/.txt` and shows the body before saving | — (final: check the preview counts as "preview") | PR-B (Add menu), PR-C (`imported_file`) |
| 16 | At least one skill linked to the new agents has imported origin | Fail | C, F | `source` is always `manual` on import | — | — |
| 17 | Controlled experiment, Test Quality (without skill: missed; with: flagged) | No evidence | F | Test Quality Reviewer + 4 skills seeded | — | — |
| 18 | Controlled experiment, API Contract (breaking route change) | Fail | F | No API Contract reviewer | — | — |
| 19 | Run trace: separate Skills block with its own token count | Fail | D | Skills block shown, no token count | — | — |
| 20 | Enabled skill appears as a block; disabled skill has none | Pass (static) | — | `enabledSkillsForPrompt` filters `skills.enabled`; `assemblePrompt` wraps each skill | — | PR-D must preserve |
| 21 | Manual `pr-self-review` on a mixed diff loads both skill sets; no automatic push hook | Implemented (PR #16) | A | No hook or CI gate; `disable-model-invocation: true`; the router routes client and server files separately | Headless `/pr-self-review` on a throwaway `client/src` + `server/src` diff Read `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert` and `onion-architecture` in one session, ran the checks (PASS) and reported WARN. A plain-language request could not invoke it: Claude Code refused `Skill(pr-self-review)` because of `disable-model-invocation` | Router tests in CI |
| 22 | Skill card also shows version and `agent_count` | Fail | B | Card shows "Used by N" (`used_by_count`), no version | — | — |
| 23 | Delete button on the skill card | Fail | B | Delete only in the Config tab | — | — |
| 24 | Skill delete confirmation modal (Confirm, Cancel, X) | Fail | B | `window.confirm` | — | — |
| 25 | `/skills/:id` tabs Config, Preview, Versioning (Stats optional) | Pass (static) | — | `SKILL_TABS`; tab label currently "Versions" | — | PR-C renames it to "Versioning" |
| 26 | Preview renders Markdown | Pass (static) | — | `PreviewTab` uses `Markdown` | — | — |
| 27 | Versioning lists all versions | Pass (static) | — | `VersionsTab` + `GET /skills/:id/versions` | — | PR-C |
| 28 | Diff button per previous version | Fail | C | — | — | — |
| 29 | Restore button per version | Fail | C | — | — | — |
| 30 | Search/filter in the agent Skills tab | Pass (static) | — | `SkillsTab` filter input | — | PR-D |
| 31 | Drag-and-drop only for enabled skills | Fail | D | — | — | — |
| 32 | Agent card: name, description, model, toggle, linked-skill count | Pass (static) | — | `AgentCard` | — | PR-B |
| 33 | Agent card Delete removes it from the database | Pass (static) | — | `useDeleteAgent` → `DELETE /agents/:id` | — | PR-B (modal) |
| 34 | Agent delete confirmation modal (Confirm, Cancel, X) | Fail | B | `window.confirm` | — | — |
| 35 | `/agents/:id` has exactly two tabs: Config and Skills | Pass (static) | — | `AgentEditor/constants.ts` `TABS` | — | — |
| 36 | Agent Config: name, description, provider, model list, strategy, system prompt | Pass (static) | — | `AgentEditor/_components/ConfigTab` | — | — |
| 37 | Agent Skills tab lists all skills, each with a toggle and a category label | Pass (static) | — | `SkillsTab` lists all skills (checkbox + type badge) | — | PR-D swaps the checkbox for `Toggle` |
| 38 | `POST /repos/:id/conventions/extract` runs and persists | Pass (static) | — | `modules/conventions/service.ts` | Post-migration smoke test 2026-10-14: 9 candidates persisted | PR-E |
| 39 | Sample selection without an LLM (configs + top 12) | Pass (static) | — | `conventions/constants.ts` `CONFIG_SAMPLE_PATHS`, `TOP_CODE_SAMPLES = 12` | — | — |
| 40 | Candidate output `{category, rule, evidence file+line, confidence}` | Pass (static) | — | `conventions/prompt.ts` `ExtractionSchema` | — | — |
| 41 | Create-skill modal edits body and metadata | Pass (static) | — | Conventions `CreateSkillModal` (body textarea, type, enabled) | — | PR-E must preserve |
| 42 | Approved candidates → one skill named `repo-conventions`, linked to an agent | Partial | E | Name `<repo>-conventions`; agent link optional | — | — |
| 43 | Four API Contract skills with directive description and good/bad example | Fail | F | — | — | — |
| 44 | Conventions in the SKILLS LAB sidebar section | Fail | B | — | — | — |
| 45 | Separate Run Scan and ReScan buttons | Partial | E | One button whose label changes | — | — |
| 46 | Candidate card: rule, source file, confidence % | Pass (static) | — | `ConventionCard` | Smoke test 2026-10-14 | PR-E |
| 47 | Accept, Reject and Edit on each candidate | Pass (static) | — | `ConventionCard` | — | PR-E |
| 48 | Rejection persists and is excluded from the skill | Pass (static) | — | `conventions.status`, default "pending" filter | Smoke test: status transitions persisted | PR-E must preserve |
| 49 | Inline Edit on the card | Pass (static) | — | `ConventionCard` editing state | — | PR-E |
| 50 | Create skill button appears after at least one Accept | Partial | E | Always visible, disabled until accepted | — | — |
| 51 | Create-skill modal explains the source; Name, Description, Cancel, Create | Pass (static) | — | Conventions `CreateSkillModal` | — | PR-E |
| 52 | The new skill appears on the Skills page | Pass (static) | — | Skill created via `POST /skills` | — | PR-B (grid) |
| 53 | Settings → Models → Conventions row with a searchable model dropdown | Pass (static) | — | `SettingsModels` `SearchableSelect`; `FEATURE_MODELS` `conventions` | — | — |

## Totals

| Status | Count |
| --- | --- |
| Implemented (PR #16, open) | 6 (1, 2, 3, 4, 5, 21) |
| Pass (static) | 25 |
| Partial | 6 |
| Fail | 15 |
| No evidence | 1 |
| Verified | 0 |
| **Total** | **53** |
