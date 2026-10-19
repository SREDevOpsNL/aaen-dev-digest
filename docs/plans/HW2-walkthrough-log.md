# Homework 2 — acceptance walkthrough log (unpaid part)

The record of the unpaid walkthrough on stack W, following the
[acceptance checklist](HW2-acceptance-checklist.md). A row is **Verified** here
only when its checklist step ran and succeeded. Screenshots are in
[`hw2-walkthrough/`](hw2-walkthrough/).

## Environment (2026-10-19)

- **Code:** `main` at `7feeb9d`, run from the worktree
  `aaen-dev-digest-hw2walk`.
- **Stack W:** `scripts/e2e.sh --serve` with provisional `DEVDIGEST_EXPERIMENT_*`
  values.

  | Item | Value |
  | --- | --- |
  | Stack | `hw2f-d5b65f48` |
  | Database | `devdigest_hw2f_d5b65f48` on `127.0.0.1:5450`, container `devdigest-hw2f-d5b65f48` |
  | API | `:3251` |
  | Web | `:3250` |

- **Keyless and unpaid:**
  - `GET /experiments/identity` returned `openrouter_key_configured: false`,
    `database_is_disposable: true` and `demo_pr_3_present: false`;
  - `~/.devdigest/hw2-experiments/secrets.json` did not exist;
  - there was no `capability.json`;
  - the runner's `check` passed its isolation checks;
  - no OpenRouter key was configured and no paid call was made. The
    development database and demo PR #3 were not touched.
- **Method:**
  - agent-browser 0.27.0 drove headless Chromium against the web app on
    `:3250`;
  - SQL went through `psql` inside the stack's own container;
  - API reads went through `curl` to `:3251`.

  "Manual" rows were done in that real browser, not in unit tests.

## Automated runs

- **Hermetic flows:** `npm run e2e:hermetic` gave **13/13 flows passed**, on
  its own isolated stack on ports 3100/3101/5433.

  | Flow | Steps passed |
  | --- | --- |
  | 01-app-boot | 5 |
  | 02-repo-pulls-detail | 8 |
  | 03-agents | 5 |
  | 04-pr-findings | 17 |
  | 05-pr-diff | 8 |
  | 06-onboarding | 5 |
  | 07-settings | 8 |
  | 08-skills | 9 |
  | 09-conventions | 8 |
  | 10-pr-intent | 10 |
  | 11-skills-lab | 47 |
  | 12-agent-skills | 11 |
  | 13-api-contract | 16 |

  No step failed.
- **Server tests:** `pnpm exec vitest run test/conventions.it.test.ts
  test/seed-content.test.ts test/skills-prompt.it.test.ts` gave **19/19
  passed** in 3 files. The `.it` tests ran against a testcontainers
  PostgreSQL.
  - `skills-prompt.it.test.ts`: "follows a reorder, excludes a globally
    disabled skill, and records no token count without skills". This is the
    Option A evidence for rows 14 and 20.

## Results

| # | Result | Evidence |
| --- | --- | --- |
| 1 | **Verified** | Git mode 120000 for `CLAUDE.md`, stored target exactly `AGENTS.md`; `verify-agent-instructions` passes; no `CLAUDE.local.md` or `.claude/CLAUDE.md` |
| 2 | **Verified** | The same for `server/`, `client/`, `reviewer-core/` (and `e2e/`) |
| 3 | **Verified** | `frontend-ui-architecture/SKILL.md` v1.1.0: "Where things live in `client/src`" (pages, page components, shared components, hooks, tests) and "Naming conventions" |
| 4 | **Verified** | `onion-architecture/SKILL.md` v1.1.0, "Non-negotiable boundaries": inward dependencies; adapters behind ports via `platform/container.ts`; "Routes never call adapters directly" with a Bad/Good example |
| 5 | **Verified** | `pr-self-review/SKILL.md`: `metadata.type: workflow`, `disable-model-invocation: true`; router tests 10/10 |
| 6 | **Verified** | Flow 11. In the browser, the sidebar shows WORKSPACE (Pull Requests), then SKILLS LAB with Conventions, Agents and Skills (`agents.png`) |
| 7 | **Verified** | Flow 03. The Agents page shows five agent cards (`agents.png`) |
| 8 | **Verified** | A skill created in the UI gave one `skills` row (`source manual`, v1). Delete → Confirm: 0 rows in `skills` and `skill_versions`, and absent from `GET /skills` |
| 9 | **Verified** | Flow 11. Each grid card has name, description, type badge and enabled switch (`skills-grid.png`) |
| 10 | **Verified** | A pointer click on a card's footer opens a right-hand drawer (`aria-modal` dialog) with the rendered body and Open details; the URL stays `/skills` (`skill-preview-drawer.png`) |
| 11 | **Verified** | Add skill shows "Create skill — Write a new skill" and "Import skill — From a Markdown file"; Create opens a dialog (`add-skill-menu.png`, `create-skill-modal.png`) |
| 12 | **Verified** | The modal has Name, Description, Type and "Skill body (Markdown)". Created `hw2-walkthrough-skill` with a heading, bold text and a list (`create-skill-filled.png`) |
| 13 | **Verified** | Link and unlink with the toggle passed: General Reviewer 0/4 → 1/4 (SQL 1 row), survived a reload → 0/4 (SQL 0). Physical drag by the user on 2026-10-20, about 00:21–00:24 local (22:21–22:23 UTC). The save history (`agent_versions` of the Test Quality Reviewer) records every change: v2 = the reported drag, Assertion Quality above Behavioral Coverage; v3–v5 further reorders, ending with Edge Cases and Error Paths on top; v6–v9 Test Isolation unlinked and relinked twice with its switch. Final order in SQL: Edge Cases and Error Paths 0, Assertion Quality 1, Behavioral Coverage 2, Test Isolation and Determinism 3. After a reload the page shows the same order (`tq-skills-after-drag.png`). The user confirmed the later saves were theirs. Every drag was saved and survived the reload |
| 14 | **Verified** (Option A, approved) | Before the drag: Behavioral Coverage 0, Assertion Quality 1, Edge Cases and Error Paths 2, Test Isolation and Determinism 3. After the physical drags (row 13), `agent_skills.order` = Edge Cases and Error Paths 0, Assertion Quality 1, Behavioral Coverage 2, Test Isolation and Determinism 3, matching the page after a reload. Prompt order follows `agent_skills.order`: `skills-prompt.it.test.ts` ("follows a reorder …") passed |
| 15 | **Verified** | Imported `docs/skills/api-contract/deprecation-policy.md`. Before saving, the drawer showed the body (1,750 characters) and the name `deprecation-policy` taken from the heading (`import-preview.png`) |
| 16 | **Verified** | Mandatory setup done. SQL: `deprecation-policy` is `imported_file`; the API Contract Reviewer has 4 rows in order (breaking-change 0, response-schema 1, semver-discipline 2, deprecation-policy 3); 4 / 4 attached after a reload; Imported badge on the grid (`api-contract-4of4.png`, `skills-grid-imported.png`) |
| 21 | **Verified** | The headless `/pr-self-review` run on a mixed diff, from PR #16, is recorded in the matrix. Re-checked without an LLM: `route-diff.mjs` on a throwaway client + server diff routed `client/src/app/skills/page.tsx` to frontend-ui-architecture, react-best-practices, typescript-expert and next-best-practices, and `server/src/modules/skills/routes.ts` to onion-architecture, typescript-expert, fastify-best-practices and zod. No active Git hooks, `core.hooksPath` unset, no `.husky`. CI runs only the router's unit tests |
| 22 | **Verified** | Flow 11. Cards show `v1` and "1 agent" (`skills-grid.png`) |
| 23 | **Verified** | Flow 11. Each card has "Delete skill <name>" |
| 24 | **Verified** | Flow 11 (Cancel, X). Confirm deleted the throwaway skill (`delete-skill-confirm.png`, row 8 SQL) |
| 25 | **Verified** | Tabs Config, Preview, Versioning (Stats is also present). The detail page also has an **Evals** tab; see the observations |
| 26 | **Verified** | The Preview tab renders the Markdown: `h1`, `strong` "untested", `li` "rule one" and "rule two" (`skill-preview-tab.png`) |
| 27 | **Verified** | After two edits, Versioning lists v3, v2 and v1 (`versioning.png`) |
| 28 | **Verified** | Diff on v1 shows "Changes from v1 to the current v3" with −/+ lines for the changed sentence and list item (`version-diff.png`) |
| 29 | **Verified** | Restore v1 → confirmation "Restore v1? … becomes a new version, v4" → v4. After a reload the list is v4…v1. SQL: versions 1–4 are kept and v4's body equals v1's (`restore-confirm.png`, `after-restore.png`) |
| 30 | **Verified** | Typing "schema" in "Filter skills…" leaves only response-schema; clearing it with the keyboard restores all rows (`agent-skills-filter.png`) |
| 31 | **Verified** | `Test Isolation and Determinism` was disabled globally for this check. DOM: `draggable="true"` only on the three linked, enabled rows; `"false"` on the disabled one and on unlinked rows. The user's physical attempt to drag it did not move it. In all 9 saved versions it is last or unlinked, never moved by a drag. It was re-enabled afterwards (SQL `enabled = t`) |
| 32 | **FAIL** | The cards show name, description, model and toggle, but **no linked-skill count** (`agents.png`). `AgentCard` renders the count only when given a `skillCount` prop, and neither call site passes it (`AgentsListView.tsx`, `agents/[id]/page.tsx`). `GET /agents` has no skill-count field. The unit test passes the prop itself, which is why the static audit missed this |
| 33 | **Verified** | A throwaway agent created through `POST /agents` was deleted from its card → Confirm. SQL: 0 rows (`delete-agent-confirm.png`) |
| 34 | **Verified** | Flow 11 (Cancel, X). Confirm: "Delete agent “…”? This cannot be undone." → deleted |
| 35 | **Verified** | The agent editor has exactly two tab buttons, Config and Skills (`agent-config.png`) |
| 36 | **Partial** | Name, Description, Provider, Model, Review strategy (3 options) and System prompt are all present. The **model list** shows "No models loaded — set the openrouter API key" on this keyless stack (`agent-model-select-keyless.png`). Re-check after Gate 2: listing models is free metadata |
| 37 | **Verified** | Flow 12. On the API Contract Reviewer, 9 of 9 skills (= `GET /skills`) each have a link switch and a category (rubric or convention) |
| 38 | **Verified** (evidence review, as decided) | `conventions.it.test.ts` passed: the real `POST /repos/:id/conventions/extract` route against PostgreSQL, with a mocked model and git. Plus the 2026-10-14 smoke-test record. No live extraction is claimed |
| 39 | **Verified** | `sample()` = `CONFIG_SAMPLE_PATHS` (14 config and instruction files) + `getTopFilesByRank(repoId, TOP_CODE_SAMPLES = 12)`. Both are a list and a DB rank query; the only model call comes after sampling (`conventions/service.ts`) |
| 40 | **Verified** | `ExtractionSchema` has `category`, `rule`, `evidence_path`, `evidence_line`, `confidence` (0–1), plus rationale, snippet and occurrences |
| 41 | **Verified** | In the Conventions modal, the description and the body were edited before Create; SQL shows both edits saved (`conventions-create-modal-edited.png`) |
| 42 | **Verified** | One `repo-conventions` skill (`source extracted`, `type convention`) was created and linked to the General Reviewer in one step; SQL shows one link row |
| 43 | **Verified** | Four docs, each with its heading, a `Description:` line and Good and Bad examples; `seed-content.test.ts` (16) passed; flow 13 passed; the fourth skill's row comes from the row 16 import |
| 44 | **Verified** | Flow 09. Conventions is under SKILLS LAB |
| 45 | **Verified** | Flow 09. Run Scan and ReScan are separate buttons; with candidates present Run Scan is disabled and ReScan enabled. Neither was pressed |
| 46 | **Verified** | Synthetic candidate cards show rule, `file:line`, snippet and confidence (82%, 74%, 70%, 66%), each labelled "Synthetic fixture — not a model extraction." (`conventions-candidates.png`) |
| 47 | **Verified** | Accept (2), Reject (1) and Edit rule used on cards. SQL: api and naming accepted, testing rejected, errors pending |
| 48 | **Verified** | After a reload the filter counts are Pending 1, Accepted 2, Rejected 1, and the rejected card is listed under Rejected; SQL `rejected`. The Create-skill draft says "Merged from 2 accepted conventions" and its body has neither the rejected nor the pending rule (`conventions-rejected-after-reload.png`) |
| 49 | **Verified** | Inline Edit rule → Save; the edited rule survived a reload; SQL shows the new text (`convention-inline-edit.png`) |
| 50 | **Verified** | Create skill was absent with 0 accepted and present after an Accept |
| 51 | **Verified** | The modal banner reads "Merged from 2 accepted conventions in acme/payments-api …", with Name, Description, Cancel and Create skill (`conventions-create-modal.png`) |
| 52 | **Verified** | After Create (rows 12 and 42), client-side navigation to Skills showed the new card without a reload (`skills-grid-new-skill.png`, `skills-grid-repo-conventions.png`) |
| 53 | **Verified** | The Conventions row has a model dropdown with "Search models…": "zzz" gives No matches, "gpt" gives gpt-5.4. Without a key it lists only the current model (`settings-models-conventions-open.png`) |

Not part of this walkthrough: rows 17 and 18 (the experiments, Gates 2–4), and
rows 19 and 20 (the Gate 4 trace).

## Summary

| Result | Rows |
| --- | --- |
| Verified | 47: 1–16, 21–31, 33–35, 37–53 |
| Fail | 1: 32 (no linked-skill count on agent cards) |
| Partial | 1: 36 (model list needs a key) |
| Not in this walkthrough | 4: 17–20 |

## Observations

- **Rows 13, 14 and 31:** the drags were done by a person with a real mouse.
  The user keeps their own before and after screenshots;
  `tq-skills-before-drag.png` and `tq-skills-after-drag.png` here were taken by
  agent-browser, read-only.
- **Row 25:** besides Config, Preview, Versioning and the optional Stats, the
  skill page has an **Evals** tab. The criterion does not forbid extra tabs.
  This is noted in case a grader reads it strictly.
- **Row 15:** the import stores the body without the file's trailing newline;
  otherwise it equals `deprecation-policy.md`. Saving the description and type
  made it v2.
- **Tooling:**
  - agent-browser `click` on a button below the 577 px viewport reported
    success but sent no request. Scrolling it into view first fixed this.
  - `fill ""` emptied the input without updating React state.

  Neither was a product defect; both steps were redone correctly.

## State changes on stack W

All in the disposable database `devdigest_hw2f_d5b65f48`. They are gone when
the stack stops.
- `deprecation-policy` was imported, enabled and linked to the API Contract
  Reviewer (4 / 4).
- `repo-conventions` was created and linked to the General Reviewer.
- Convention statuses changed, and the naming rule was edited.
- `Test Isolation and Determinism` was disabled for the row 31 check and
  re-enabled after it.
- The Test Quality Reviewer's order was changed by the physical drags (rows
  13 and 14).
- The throwaway skill and agent were deleted.
