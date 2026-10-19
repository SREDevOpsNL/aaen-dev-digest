# Homework 2 — final acceptance checklist (53 criteria)

Walkthrough for the final acceptance gate (plan rev. 4.3, Gate 5). A criterion moves to **Verified** in [`HW2-compliance-matrix.md`](HW2-compliance-matrix.md) only when its walkthrough step below is done and its evidence is recorded; tests and flows alone keep it at *Implemented* or *Pass (static)*.

- **Environment:** a disposable stack (isolated Postgres on alternate ports), never the development database and never demo PR #3, unless an action is separately authorized.
- **Order and stacks:** see [Stacks and order](#stacks-and-order). In short: run `npm run e2e:hermetic` (flows 01–13, read-only), then do the API Contract mandatory setup ([`docs/skills/api-contract/README.md`](../skills/api-contract/README.md)) and the manual and SQL steps on an unpaid walkthrough stack; the experiment rows come from the experiment report.
- **Paid calls:** none. Rows 17 and 18 come from the experiment report (Gates 2–4), and row 19 reuses a completed with-skill Gate 4 trace. Rows 14 and 20 have an [open decision](#open-decision-trace-evidence-for-rows-14-and-20).
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
| 14 | Drag-and-drop order determines prompt order | Manual (browser) + SQL | `skills-prompt.it.test.ts` | after a physical drag on the Test Quality Reviewer, reload keeps the order and SQL `agent_skills.order` matches it; trace order: [open decision](#open-decision-trace-evidence-for-rows-14-and-20) | |
| 15 | Import from `.md` (or `.zip`) with a content preview before saving | Manual (browser) | `ImportSkillDrawer.test.tsx` | import a `.md`: body visible before saving | |
| 16 | At least one skill linked to the new agents has imported origin | Manual (browser) + SQL | — | mandatory setup in `docs/skills/api-contract/README.md`: import `deprecation-policy.md`, link it; SQL `source = 'imported_file'`, 4 links | |
| 17 | Controlled experiment, Test Quality (without skill: missed; with: flagged) | Experiment | — | experiment 17 results (`docs/plans/HW2-skills-experiments.md`) | |
| 18 | Controlled experiment, API Contract (breaking route change) | Experiment | — | experiment 18 results | |
| 19 | Run trace: separate Skills block with its own token count | Manual (browser) | `TraceBody.test.tsx`, `skills-prompt.it.test.ts` | on the Gate 4 stack, before it stops: open a completed with-skill trace; the Skills block shows `~N tokens` | |
| 20 | Enabled skill appears as a block; disabled skill has none | Manual (browser) | `skills-prompt.it.test.ts` | same trace: the target skill appears as a block, and a without-skill trace has no Skills block; disabled skill: [open decision](#open-decision-trace-evidence-for-rows-14-and-20) | |
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
| 38 | `POST /repos/:id/conventions/extract` runs and persists | Evidence review | `conventions.it.test.ts` | decided ([below](#conventions-evidence-rows-38-46-47-49--decided)): no live extraction; record `conventions.it.test.ts` and the 2026-10-14 smoke-test record | |
| 39 | Sample selection without an LLM (configs + top 12) | Repo/CLI | `conventions/constants.ts` | configs + top 12 sampled without an LLM | |
| 40 | Candidate output `{category, rule, evidence file+line, confidence}` | Repo/CLI | `conventions/prompt.ts` | candidate schema fields | |
| 41 | Create-skill modal edits body and metadata | Manual (browser) | `CreateSkillModal.test.tsx` | edit body and metadata in the Conventions modal | |
| 42 | Approved candidates → one skill named `repo-conventions`, linked to an agent | Manual (browser) + SQL | `conventions.it.test.ts`, `agent-skill-limit.it.test.ts` | create `repo-conventions` linked to an agent with fewer than four skills (General Reviewer; the API Contract Reviewer is full after the setup) in one step; SQL link row | |
| 43 | Four API Contract skills with directive description and good/bad example | Repo/CLI + Flow 13 | `seed-content.test.ts`, flow 13 | four skill docs with Description + good/bad example; three seeded, fourth imported | |
| 44 | Conventions in the SKILLS LAB sidebar section | Flow 09 | flow 09 | sidebar SKILLS LAB → Conventions | |
| 45 | Separate Run Scan and ReScan buttons | Flow 09 | flow 09, `page.test.tsx` | Run Scan and ReScan are separate | |
| 46 | Candidate card: rule, source file, confidence % | Manual (browser) | — | a synthetic candidate card shows rule, file, confidence | |
| 47 | Accept, Reject and Edit on each candidate | Manual (browser) | — | Accept, Reject, Edit on a candidate | |
| 48 | Rejection persists and is excluded from the skill | Manual (browser) + SQL | `conventions.it.test.ts` (the draft holds only accepted ids), `page.test.tsx` (a rejected candidate does not enable Create skill); no test rejects through the API | reject a synthetic candidate → still rejected after reload, SQL `status = 'rejected'`; the Create-skill banner counts only accepted ones | |
| 49 | Inline Edit on the card | Manual (browser) | — | inline Edit on a card | |
| 50 | Create skill button appears after at least one Accept | Flow 09 | flow 09, `page.test.tsx` | Create skill appears only after an Accept | |
| 51 | Create-skill modal explains the source; Name, Description, Cancel, Create | Manual (browser) | `CreateSkillModal.test.tsx` | modal banner explains the source; Name, Description, Cancel, Create | |
| 52 | The new skill appears on the Skills page | Manual (browser) | — | after Create (row 12 or 42) the new skill is on the Skills grid | |
| 53 | Settings → Models → Conventions row with a searchable model dropdown | Flow 07 | flow 07 | Settings → Models → Conventions has a searchable dropdown | |

## Stacks and order

Prepared 2026-10-19; nothing below has been run. Both stacks are disposable and
neither uses the development database.

- **Walkthrough stack W (unpaid).** Used for every row except 17–20. Start
  `scripts/e2e.sh --serve` (operator guide §2) with valid provisional
  `DEVDIGEST_EXPERIMENT_*` values. If you start it before the Gate 2 key file
  exists, the server has no OpenRouter key at all. Even with the key, experiment
  mode refuses every generation before it reaches the provider unless an
  authorized slot is open (operator guide, "One door to paid generation"), and
  W gets no capability. So nothing on W can spend. Web
  `http://localhost:3250`, API `:3251`; the Postgres container and database are
  printed at start.
- **Experiment stack E (Gate 4).** Used for rows 17–20 only.
  - Stopping a stack removes its database (`docker rm -f` of the container) and
    every trace in it; only the ledger under `~/.devdigest/hw2-experiments/`
    survives. Open the row 19/20 trace **before** stopping E.
  - The runner relinks each reviewer's skills before every slot (target only,
    or none), so E no longer has the seeded links. Do not use E for rows 13,
    14, 16, 42 or 43.

Order:
1. Before starting W, run `npm run e2e:hermetic` in `e2e/`. It starts and
   stops its own stack.
2. Start W, then do the mandatory setup (row 16): import `deprecation-policy` and link it (4 / 4).
3. Skills rows 8, 12, 15, 24, 26, 28, 29 and 52, on a throwaway skill: create,
   edit twice, Diff, Restore, delete.
4. Agent rows 13, 14, 30, 31, 33, 35 and 36. The drag on the Test Quality
   Reviewer is done by a person; row 33 deletes a throwaway agent.
5. Conventions rows 46, 47, 48, 49, 50, 51, 41, 42 and 52, on the synthetic
   candidates (below). Press neither Run Scan nor ReScan.

## SQL on a disposable stack

Connect with the container and database that `--serve` printed:

```bash
docker exec -it <container> psql -U devdigest -d <database>
```

| Row | Query | Expect |
| --- | --- | --- |
| 8 | `select name, source, version from skills where name = '<throwaway>';` | one row after Create; none after Delete |
| 14 | `select s.name, ak."order" from agent_skills ak join skills s on s.id = ak.skill_id join agents a on a.id = ak.agent_id where a.name = 'Test Quality Reviewer' order by ak."order";` | the dragged order |
| 16 | the row 14 query with `s.source` added and `a.name = 'API Contract Reviewer'` | four rows; `deprecation-policy` is `imported_file` |
| 29 | `select sv.version from skill_versions sv join skills s on s.id = sv.skill_id where s.name = '<throwaway>' order by sv.version;` | every version, with the restored one last |
| 33 | `select count(*) from agents where name = '<throwaway agent>';` | `0` after Delete |
| 42 | `select s.name, s.source, a.name from skills s join agent_skills ak on ak.skill_id = s.id join agents a on a.id = ak.agent_id where s.name = 'repo-conventions';` | one row, linked to the chosen agent |
| 48 | `select rule, status from conventions order by created_at;` | the rejected candidate is still `rejected` |

## Open decision: trace evidence for rows 14 and 20

Each experiment slot links one skill or none. No planned trace therefore shows
two or more skills in a dragged order (row 14), or a skill that is linked but
disabled (row 20). The prompt side of both is covered by
`server/test/skills-prompt.it.test.ts`, which uses real PostgreSQL and the real
`assemblePrompt` with a mocked model:
- a relinked order reaches the Skills block in that order;
- a disabled skill linked between enabled ones never reaches the prompt.

- **A (recommended):** accept that test as the prompt-side evidence. The
  walkthrough adds the physical drag and SQL order (row 14), and the Gate 4
  with-skill trace for the enabled block (row 20).
- **B:** a separate paid trace with two or more enabled skills in a dragged
  order plus a linked, disabled one. Experiment slots relink target-only, so B
  needs a design change, its own authorization and its own budget. It is not
  planned.

## Conventions evidence (rows 38, 46, 47, 49) — decided

Approved: the walkthrough uses **synthetic, labelled candidates** in an isolated database, not a live extraction.

- `scripts/e2e.sh --serve` seeds four pending candidates for `acme/payments-api` (`DEVDIGEST_SEED_SYNTHETIC_CONVENTIONS=1`, disposable databases only), each labelled "Synthetic fixture — not a model extraction." in its rationale.
- They support the walkthrough steps for rows 46 (card fields), 47 (Accept / Reject / Edit), 48 (rejection persists across reload and is excluded from the draft), 49 (inline Edit), 50, 51, 42 and 52.
- Row 38 ("runs and persists") rests on `server/test/conventions.it.test.ts`, which drives the real `POST /repos/:id/conventions/extract` route against PostgreSQL with a mocked model and git, plus the 2026-10-14 smoke-test record. **No live model extraction is claimed.**
- Do not press ReScan on the walkthrough stack: it would call the real model.
