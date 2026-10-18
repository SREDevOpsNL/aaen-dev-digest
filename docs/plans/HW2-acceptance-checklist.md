# Homework 2 — final acceptance checklist (53 criteria)

Walkthrough for the final acceptance gate (plan rev. 4.3, Gate 5). A criterion moves to **Verified** in [`HW2-compliance-matrix.md`](HW2-compliance-matrix.md) only when its walkthrough step below is done and its evidence is recorded; tests and flows alone keep it at *Implemented* or *Pass (static)*.

- **Environment:** a disposable stack (isolated Postgres on alternate ports), never the development database and never demo PR #3, unless an action is separately authorized.
- **Order:** run `npm run e2e:hermetic` first (flows 01–13, read-only); then do the API Contract mandatory setup ([`docs/skills/api-contract/README.md`](../skills/api-contract/README.md)); then the manual and SQL steps; experiment rows come from the experiment report.
- **Paid calls:** none in this checklist, except the open decision below. Row 19 reuses a completed with-skill experiment trace.
- **Physical drag (rows 13, 14, 31):** done by a person with a real mouse; agent-browser cannot start a native HTML5 drag (`e2e/LEARNINGS.md`).

| # | Criterion | Method | Automated coverage | Walkthrough step | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | `AGENTS.md` migration at the root (`CLAUDE.md` symlink or `@AGENTS.md` import) | Repo/CLI | `verify-agent-instructions` (CI) | `git ls-files -s CLAUDE.md` shows mode 120000 → `AGENTS.md` | |
| 2 | Same pattern in `server/`, `client/`, `reviewer-core/` | Repo/CLI | same checker | same for `server/`, `client/`, `reviewer-core/` (and `e2e/`) | |
| 3 | UI architecture skill (pages, page components, shared components, tests, naming) | Repo/CLI | — | open `.claude/skills/frontend-ui-architecture/SKILL.md`: placement + naming sections | |
| 4 | Onion architecture skill (route → service → domain via container; adapters at the boundary; inward dependencies; no adapters from routes) | Repo/CLI | — | open `.claude/skills/onion-architecture/SKILL.md`: boundaries + routes-never-call-adapters example | |
| 5 | `pr-self-review` skill exists, type Workflow (skill dispatcher) | Repo/CLI | router tests (CI) | `pr-self-review/SKILL.md` has `metadata.type: workflow` | |
| 6 | Agents in the SKILLS LAB sidebar section | Flow 11 | flow 11 (SKILLS LAB section) | sidebar shows SKILLS LAB → Agents | |
| 7 | Agents page shows agent cards | Flow 03 | flow 03 | Agents page shows cards | |
| 8 | Skills CRUD reads and writes PostgreSQL | Manual (browser) + SQL | `skills.it.test.ts` | create a skill in the UI → `select * from skills where name=…`; delete it → row gone and absent from `GET /skills` | |
| 9 | Skills page card grid (name, type, description, toggle) | Flow 11 | flow 11, `page.test.tsx` | grid card shows name, type, description, toggle | |
| 10 | Card click opens a side preview (not a modal or page) | Flow 11 | flow 11 | card click opens the side drawer, not a page | |
| 11 | Add button offers Create and Import; Create in a modal | Flow 11 | flow 11 | Add skill menu shows Create and Import; Create opens a modal | |
| 12 | Create Skill modal: name, description, type, Markdown body | Manual (browser) | `page.test.tsx` | create a skill with a Markdown body (write path, so manual) | |
| 13 | Agent Skills tab: link, enable/disable, drag-and-drop reorder | Manual (browser) | flow 12, `SkillsTab.test.tsx` | link/unlink with the toggle; **physical mouse drag** reorders and survives reload | |
| 14 | Drag-and-drop order determines prompt order | Manual (browser) + SQL | `skills-prompt.it.test.ts` | after a drag, `agent_skills.order` matches; the next trace lists skills in that order | |
| 15 | Import from `.md` (or `.zip`) with a content preview before saving | Manual (browser) | `ImportSkillDrawer.test.tsx` | import a `.md`: body visible before saving | |
| 16 | At least one skill linked to the new agents has imported origin | Manual (browser) + SQL | — | mandatory setup in `docs/skills/api-contract/README.md`: import `deprecation-policy.md`, link it; SQL `source = 'imported_file'`, 4 links | |
| 17 | Controlled experiment, Test Quality (without skill: missed; with: flagged) | Experiment | — | experiment 17 results (`docs/plans/HW2-skills-experiments.md`) | |
| 18 | Controlled experiment, API Contract (breaking route change) | Experiment | — | experiment 18 results | |
| 19 | Run trace: separate Skills block with its own token count | Manual (browser) | `TraceBody.test.tsx`, `skills-prompt.it.test.ts` | open a completed with-skill trace from the experiments: Skills block shows `~N tokens` | |
| 20 | Enabled skill appears as a block; disabled skill has none | Manual (browser) | `skills-prompt.it.test.ts` | same trace: only enabled skills appear in the Skills block | |
| 21 | Manual `pr-self-review` on a mixed diff loads both skill sets; no automatic push hook | Repo/CLI | PR #16 headless run | evidence recorded in the matrix (row 21) | |
| 22 | Skill card also shows version and `agent_count` | Flow 11 | flow 11 | card shows `vN` and the agent count | |
| 23 | Delete button on the skill card | Flow 11 | flow 11 | Delete button on the card | |
| 24 | Skill delete confirmation modal (Confirm, Cancel, X) | Flow 11 | flow 11 (Cancel, X) | Confirm deletes (manual, write path) | |
| 25 | `/skills/:id` tabs Config, Preview, Versioning (Stats optional) | Flow 11 | flow 11 | detail tabs Config, Preview, Versioning | |
| 26 | Preview renders Markdown | Manual (browser) | `PreviewTab` | Preview tab renders Markdown | |
| 27 | Versioning lists all versions | Flow 11 | flow 11 | Versioning lists every version | |
| 28 | Diff button per previous version | Manual (browser) | `VersionsTab.test.tsx` | edit a skill twice, Diff an older version | |
| 29 | Restore button per version | Manual (browser) + SQL | `skills.it.test.ts` | Restore an older version → new version, reload persists; SQL `skill_versions` keeps history | |
| 30 | Search/filter in the agent Skills tab | Manual (browser) | `SkillsTab` | filter the agent Skills tab | |
| 31 | Drag-and-drop only for enabled skills | Manual (browser) | flow 12, `SkillsTab.test.tsx` | a disabled skill cannot be dragged | |
| 32 | Agent card: name, description, model, toggle, linked-skill count | Flow 03 | `AgentCard.test.tsx` | card shows name, description, model, toggle, skill count | |
| 33 | Agent card Delete removes it from the database | Manual (browser) + SQL | `AgentCard.test.tsx` | delete a throwaway agent → row gone from `agents` | |
| 34 | Agent delete confirmation modal (Confirm, Cancel, X) | Flow 11 | flow 11 (Cancel, X) | Confirm deletes (manual) | |
| 35 | `/agents/:id` has exactly two tabs: Config and Skills | Manual (browser) | `AgentEditor/constants.ts` | agent editor has exactly Config and Skills | |
| 36 | Agent Config: name, description, provider, model list, strategy, system prompt | Manual (browser) | — | Config tab fields incl. the model list and strategy | |
| 37 | Agent Skills tab lists all skills, each with a toggle and a category label | Flow 12 | flow 12 | every skill has a toggle and a category | |
| 38 | `POST /repos/:id/conventions/extract` runs and persists | Manual (browser) + SQL | `conventions.it.test.ts` | **needs a decision** (below): run an extraction, then SQL `conventions` rows | |
| 39 | Sample selection without an LLM (configs + top 12) | Repo/CLI | `conventions/constants.ts` | configs + top 12 sampled without an LLM | |
| 40 | Candidate output `{category, rule, evidence file+line, confidence}` | Repo/CLI | `conventions/prompt.ts` | candidate schema fields | |
| 41 | Create-skill modal edits body and metadata | Manual (browser) | `CreateSkillModal.test.tsx` | edit body and metadata in the Conventions modal | |
| 42 | Approved candidates → one skill named `repo-conventions`, linked to an agent | Manual (browser) + SQL | `conventions.it.test.ts`, `agent-skill-limit.it.test.ts` | create `repo-conventions` linked to an agent in one step; SQL link row | |
| 43 | Four API Contract skills with directive description and good/bad example | Repo/CLI + Flow 13 | `seed-content.test.ts`, flow 13 | four skill docs with Description + good/bad example; three seeded, fourth imported | |
| 44 | Conventions in the SKILLS LAB sidebar section | Flow 09 | flow 09 | sidebar SKILLS LAB → Conventions | |
| 45 | Separate Run Scan and ReScan buttons | Flow 09 | flow 09, `page.test.tsx` | Run Scan and ReScan are separate | |
| 46 | Candidate card: rule, source file, confidence % | Manual (browser) | — | **needs the extraction** (row 38): candidate card shows rule, file, confidence | |
| 47 | Accept, Reject and Edit on each candidate | Manual (browser) | — | Accept, Reject, Edit on a candidate | |
| 48 | Rejection persists and is excluded from the skill | Manual (browser) + SQL | `conventions.it.test.ts` | reject a candidate → status persisted and excluded from the draft | |
| 49 | Inline Edit on the card | Manual (browser) | — | inline Edit on a card | |
| 50 | Create skill button appears after at least one Accept | Flow 09 | flow 09, `page.test.tsx` | Create skill appears only after an Accept | |
| 51 | Create-skill modal explains the source; Name, Description, Cancel, Create | Manual (browser) | `CreateSkillModal.test.tsx` | modal banner explains the source; Name, Description, Cancel, Create | |
| 52 | The new skill appears on the Skills page | Manual (browser) | — | after Create (row 12 or 42) the new skill is on the Skills grid | |
| 53 | Settings → Models → Conventions row with a searchable model dropdown | Flow 07 | flow 07 | Settings → Models → Conventions has a searchable dropdown | |

## Open decision: a real Conventions extraction (rows 38, 46, 47, 49)

These rows need a scan that runs and persists. Extraction needs a cloned, indexed repository and one paid model call; the seeded `acme/payments-api` has no clone, so the disposable stack cannot run it as is. Choose one before the walkthrough:

1. **Disposable stack + a small public repository:** import it (GitHub token, clone, index), then one extraction with the Conventions feature model. Needs a separate paid-call authorization (one extraction call, bounded by the same preflight as the experiments).
2. **Existing evidence:** cite the 2026-10-14 post-migration smoke test on the development database (9 candidates persisted) and do a **read-only** SQL check there. Needs a separate authorization to read the development database.

Until one is chosen, rows 38, 46, 47 and 49 stay *Pass (static)*.
