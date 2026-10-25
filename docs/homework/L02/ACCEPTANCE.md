# L02 acceptance matrix (53 mandatory criteria)

Pass requires all 53. A row is **Verified** only when its behaviour has been
shown **on this branch** and the evidence is linked here. A passing test on
`main`, a merged PR or an earlier report does not count.

## Rubric source

| Item | Value |
| --- | --- |
| Working rubric | Recovered **English translation** (prepared 2026-10-16 from the supplied Homework No. 2 criteria). Approved as the authoritative working rubric on 2026-10-24 |
| Not | A verbatim Ukrainian LMS export. **Original-source verification is still open** |
| Private copy | Kept outside this public repository (paid course material) |
| SHA-256 | `4c67b68b1fdbe403d5b0ebac51d56a19fc547050c4c5559f61c8a00ddd6d4902` |
| Wording here | Short paraphrases with the translation's numbering |

Status values:
- **Not started**
- **Implemented**: the code is on this branch and its automated tests pass, but the behaviour has not yet been shown at runtime.
- **Verified**: shown at runtime, with evidence linked.
- **Blocked**: cannot be verified; the reason is given.

**Current count:** 0 Verified · 51 Implemented · 2 Not started (17, 18: experiments not run) · 0 Blocked.

## Matrix

Commits are on `homework/l02-mentor-submission`. Tests are server (`server/test/`), client (beside the component), e2e (`e2e/specs/`).

| # | Requirement (short) | Status | Implementation | Automated test | Runtime evidence | Commit | Open issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Root `AGENTS.md` with `CLAUDE.md` symlink (or `@AGENTS.md` import) | Implemented | `CLAUDE.md` → `AGENTS.md`, Git mode 120000; `scripts/verify-agent-instructions.mjs` | checker in the `agent-instructions` workflow | — | d97aeb3 | |
| 2 | Same in `server/`, `client/`, `reviewer-core/` | Implemented | symlinks in the three packages (and `e2e/`) | same checker | — | d97aeb3 | |
| 3 | UI architecture skill: pages, page components, shared components, tests, naming | Implemented | `.claude/skills/frontend-ui-architecture/SKILL.md` | — | — | 23cbb50, d97aeb3 | |
| 4 | Onion skill: route → service → domain via container; adapters at the boundary; inward dependencies; no adapters from routes | Implemented | `.claude/skills/onion-architecture/SKILL.md` | — | — | 23cbb50, d97aeb3 | |
| 5 | `pr-self-review` skill, Workflow type | Implemented | `.claude/skills/pr-self-review/SKILL.md` (`metadata.type: workflow`, `disable-model-invocation: true`), `scripts/route-diff.mjs` | `route-diff.test.mjs` (10) | — | d97aeb3 | |
| 6 | Agents under SKILLS LAB in the sidebar | Implemented | `client/src/vendor/ui/nav.ts` | `nav-sections.test.ts`; e2e 11 | — | 91b174a | |
| 7 | Agents page: card grid | Implemented | `AgentsListView`, `AgentCard` | e2e 03, 11 | — | 23cbb50, 91b174a | |
| 8 | Skills CRUD really reads and writes Postgres (API create → row; DB delete → gone from `GET /skills`) | Implemented | `modules/skills/{routes,repository}.ts` | `skills.it.test.ts` | — | 23cbb50, 021128c | the rubric's API + SQL procedure, at runtime |
| 9 | Skills page cards: name, type, description, toggle | Implemented | `app/skills/page.tsx`, `SkillCard` | `page.test.tsx`; e2e 11 | — | 91b174a | |
| 10 | Card click opens a side preview | Implemented | `SkillPreviewDrawer` | `page.test.tsx`; e2e 11 | — | 91b174a | |
| 11 | Add → Create / Import; create in a modal | Implemented | `AddSkillMenu`, `CreateSkillModal` | `page.test.tsx`; e2e 11 | — | 91b174a | |
| 12 | Create modal: name, description, type, Markdown body | Implemented | `CreateSkillModal` | `page.test.tsx`; e2e 11 | — | 91b174a | |
| 13 | Agent Skills tab: link, enable/disable, drag-and-drop | Implemented | `SkillsTab`: link toggle, **per-agent enabled switch** (`agent_skills.enabled`, `PATCH /agents/:id/skills/:skillId`), native drag-and-drop | `SkillsTab.test.tsx`, `agent-skill-enabled.it.test.ts`; e2e 12 | — | 10bd7db, a98d1aa, ce85dd9 | a physical drag at runtime |
| 14 | Drag order = prompt order, **shown in the run trace** | Implemented | `enabledSkillsForPrompt` orders by `agent_skills.order` | `skills-prompt.it.test.ts`, `agent-skill-enabled.it.test.ts` | — | 10bd7db | needs one real run after a UI drag (paid) |
| 15 | Import `.md` (or `.zip`) with a preview before saving | Implemented | `ImportSkillDrawer` (`.md`, `.markdown`, `.txt`) | `ImportSkillDrawer.test.tsx` | — | 23cbb50, 021128c | |
| 16 | At least one skill linked to the new agents is "imported" | Implemented | `SkillSource = imported_file`, `SourceBadge`; `deprecation-policy` is import-only | `skills.it.test.ts`, `seed.it.test.ts` | — | 021128c, c391400 | the real import plus SQL proof |
| 17 | Test Quality experiment: missed without the skill, branch **and** edge case flagged with it | Not started | fixture #501, harness (`experiments/`, `experiments/hw2/`), Run Review dispatch | `experiments.it.test.ts`, `hw2-*.test.ts` | — | c391400, 10a1701 … 8a03fa8 | paid pilot and confirmatory runs ([EXPERIMENTS.md](EXPERIMENTS.md)) |
| 18 | API Contract experiment: route-signature change missed without, detected with | Not started | harness; the fixture is to be redesigned as a route-signature change | as 17 | — | as 17 | fixture redesign, pilot, pre-registration, runs |
| 19 | Separate Skills block in the trace with its own token count | Implemented | `renderSkillsSection`, `skills_tokens` (js-tiktoken over the Skills section), `PromptBlock` | `skills-prompt.it.test.ts`, `TraceBody.test.tsx` | — | 10bd7db | a live trace via PR → Agent runs (paid run) |
| 20 | In the trace: enabled skill has a block, disabled skill none | Implemented | both the skill's and the link's switch must be on | `skills-prompt.it.test.ts`, `agent-skill-enabled.it.test.ts` | — | 10bd7db, a98d1aa | a live trace with a disabled linked skill (paid run) |
| 21 | Manual `pr-self-review` on a mixed diff loads both skill sets; no push hook | Implemented | no hook; `disable-model-invocation`; router | `route-diff.test.mjs` | — | d97aeb3 | the headless mixed-diff run |
| 22 | Card shows version and `agent_count` | Implemented | `SkillCard` `v{n}`; `GET /skills` → `agent_count` (= `used_by_count`) | `skills.it.test.ts`, `page.test.tsx` | — | 91b174a, 077305a | |
| 23 | Delete button on the skill card | Implemented | `SkillCard` | `page.test.tsx` | — | 91b174a | |
| 24 | Skill delete modal: Confirm, Cancel, X | Implemented | `DeleteSkillModal`, `ConfirmModal` | `DeleteSkillModal.test.tsx`; e2e 11 | — | 91b174a | |
| 25 | `/skills/:id`: Config, Preview, Versioning (Stats optional) | Implemented | `SKILL_TABS` (with Evals and Stats placeholders) | `VersionsTab.test.tsx`; e2e 11 | — | 23cbb50, 021128c | |
| 26 | Preview renders Markdown | Implemented | `PreviewTab` → `Markdown` | — | — | 23cbb50 | |
| 27 | Versioning lists all versions | Implemented | `VersionsTab`, `GET /skills/:id/versions` | `VersionsTab.test.tsx` | — | 021128c | |
| 28 | Diff per previous version, compared with the current one | Implemented | `lineDiff(version.body, skill.body)` | `helpers.test.ts`, `VersionsTab.test.tsx` | — | 021128c | |
| 29 | Restore per version | Implemented | `POST …/restore` → `restoreVersion` | `skills.it.test.ts`, `VersionsTab.test.tsx` | — | 021128c | |
| 30 | Search by name in the agent Skills tab | Implemented | `SkillsTab` filter | `SkillsTab.test.tsx` | — | 23cbb50, 10bd7db | |
| 31 | Drag-and-drop only for enabled skills | Implemented | draggable only when linked, on for the agent and enabled | `SkillsTab.test.tsx`; e2e 12 | — | 10bd7db, ce85dd9 | |
| 32 | Agent card: name, description, model, toggle, linked-skill count | Implemented | `AgentCard`, `skill_count` from `GET /agents` | `AgentCard.test.tsx`, `agent-skill-count.it.test.ts`; e2e 14 | — | 91b174a, 780d5ea | |
| 33 | Agent Delete removes it from the DB | Implemented | `DELETE /agents/:id` | `AgentCard.test.tsx` | — | 91b174a | SQL before and after |
| 34 | Agent delete modal: Confirm, Cancel, X | Implemented | `AgentCard` + `ConfirmModal` | `AgentCard.test.tsx`; e2e 11 | — | 91b174a | |
| 35 | `/agents/:id`: exactly Config + Skills | Implemented | `AgentEditor/constants.ts` | `AgentEditor.test.tsx` | — | 23cbb50 | |
| 36 | Agent config: name, description, provider, model list, strategy, system prompt | Implemented | `ConfigTab` | — | — | baseline, 23cbb50 | the model list needs a key (a free `GET`) |
| 37 | Agent Skills tab lists **all** skills with a toggle and a category label | Implemented | `SkillsTab` | `SkillsTab.test.tsx`; e2e 12 | — | 10bd7db, ce85dd9 | |
| 38 | Extraction **really runs**, persists, survives a restart | Implemented | `modules/conventions/service.ts` | `conventions.it.test.ts` (mocked model) | — | 23cbb50, dc9e3de | one live extraction plus an API restart (paid) |
| 39 | Configs + top 12 via `getConventionSamples()`, no LLM | Implemented | `CONFIG_SAMPLE_PATHS`, `TOP_CODE_SAMPLES = 12` | `conventions-helpers.test.ts` | — | 23cbb50 | |
| 40 | Output `{category, rule, evidence file + line, confidence}` | Implemented | `ExtractionSchema` | `conventions.it.test.ts` | — | 23cbb50 | |
| 41 | Create modal edits the body and metadata | Implemented | conventions `CreateSkillModal` | `CreateSkillModal.test.tsx` | — | 23cbb50, dc9e3de | |
| 42 | Accepted candidates → one `repo-conventions` skill, linked to an agent | Implemented | `buildSkillDraft`, create-linked transaction | `conventions.it.test.ts`, `agent-skill-limit.it.test.ts` | — | dc9e3de | |
| 43 | Four API Contract skills with a description and good/bad examples | Implemented | `docs/skills/api-contract/*.md`, `seed-skills.ts` | `seed-content.test.ts`; e2e 13 | — | c391400 | |
| 44 | Conventions under SKILLS LAB | Implemented | `nav.ts` | `nav-sections.test.ts`; e2e 09, 11 | — | 91b174a | |
| 45 | Separate Run Scan and ReScan | Implemented | `conventions/page.tsx` | `page.test.tsx`; e2e 09 | — | dc9e3de | |
| 46 | Candidate card: rule, file, confidence % | Implemented | `ConventionCard` | — | — | 23cbb50 | |
| 47 | Accept, Reject, Edit | Implemented | `ConventionCard` | — | — | 23cbb50 | |
| 48 | Rejection survives a reload and is excluded from the skill | Implemented | `conventions.status` | `conventions.it.test.ts`, `migration-0011-upgrade.it.test.ts` | — | 23cbb50, dc9e3de | |
| 49 | Inline Edit | Implemented | `ConventionCard` editing state | — | — | 23cbb50 | |
| 50 | Create skill after at least one Accept | Implemented | `counts.accepted > 0` | `page.test.tsx` | — | dc9e3de | |
| 51 | Create modal explains its source; Name, Description, Cancel, Create | Implemented | conventions `CreateSkillModal` | `CreateSkillModal.test.tsx` | — | 23cbb50, dc9e3de | |
| 52 | The new skill appears on the Skills page | Implemented | `useCreateSkill` invalidates `["skills"]` | — | — | 23cbb50, 91b174a | |
| 53 | Settings → Models → Conventions row, searchable, model chosen dynamically | Implemented | `SettingsModels`, `resolveFeatureModel(…, 'conventions')` | `settings-models.it.test.ts` | — | baseline, 23cbb50 | |

## Interpretation notes (to check against the original wording)

- **13 / 37, "enable/disable"**: covered under both readings. The link toggle
  attaches or detaches a skill, and a separate per-agent switch turns an
  attached skill on or off for that agent (A1).
- **17 / 18, "PR page → Run Review"**: the experiments dispatch through the
  PR page's Run Review button: the runner arms the slot and the click
  dispatches it (A5).
- **22, `agent_count`**: returned by the API alongside `used_by_count` (A3).
- **25**: the extra Evals and Stats tabs are placeholders. The rubric says the
  page "contains" the three tabs, unlike row 35's "exactly two".
