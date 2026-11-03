# Criterion 21: readiness check for the owner's manual `/pr-self-review --base HEAD`

Checked 2026-11-03 20:38 +01:00 by Agent C (read-only). **This file does not record a `/pr-self-review` run.** Nobody invoked, simulated or forged the slash command, and no Claude Code session was opened in the scratch checkout. Criterion 21 stays **Blocked** until the owner's real run is captured.

- Extraction worktree (PR #53): `~/projects/aaen-dev-digest-l02-extraction`, branch `codex/l02-extraction-authorization`, HEAD `7b066cb85af3d08478101640d312ddc2de966890`, clean. The PR branch is `homework/l02-mentor-submission`, pushed from local branch `codex/l02-extraction-authorization`; this cycle's docs are prepared on `docs/l02-acceptance-cycle`.
- Scratch checkout: `~/projects/aaen-dev-digest-l02-self-review`. It is a linked worktree of `~/projects/aaen-dev-digest/.git`, with git dir `.git/worktrees/aaen-dev-digest-l02-self-review`.

**Verdict: ready.** The only open items are the owner's action, the mentor questions in §7, and the optional pre-run step in [21-owner-instructions.md](21-owner-instructions.md#recommended-pre-run-step-owner-decision-not-executed), which would reduce Q5.

| # | Check | Command(s) | Result |
|---|---|---|---|
| 1a | The scratch checkout is detached at the expected commit | `git -C S rev-parse HEAD`; `rev-parse --abbrev-ref HEAD`; `status --porcelain=v1 -b` | `21c8f09bb6582495d24702afd8aa35c10c62c96f`, `HEAD`, `## HEAD (no branch)`. PASS |
| 1b | The diff is exactly the intended mixed change | `git -C S diff --stat`, `git -C S diff` | 2 files, +2 lines. Each file gains one line at the top: `// L02 criterion 21 scratch diff: harmless review-routing marker.` (`client/src/app/skills/page.tsx` and `server/src/modules/skills/routes.ts`). There are no untracked files, and `--ignored` shows nothing besides `node_modules`. PASS |
| 1c | No secrets in the diff | `git diff \| grep -ciE "ghp_\|github_pat_\|sk-\|token\|secret\|bearer\|password"` | `0`. PASS |
| 1d | The base relates to PR #53 | `git merge-base --is-ancestor 21c8f09 7b066cb` | `21c8f09` is an ancestor of the PR head, and `.claude/` is unchanged between them (see 3c). PASS |
| 2a | The router script is read-only | Read the source of `.claude/skills/pr-self-review/scripts/route-diff.mjs` | It runs only `git rev-parse`, `symbolic-ref`, `merge-base`, `diff --name-status`, `ls-files` and `status --porcelain` through `execFileSync`, plus `existsSync`. It never writes files and never runs a check. Safe to run |
| 2b | The router selects both Skill sets on the scratch diff | `cd S && node .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD` (node v22.23.2). The full JSON output was inspected during the check but is not kept in this repository | Exit 0. `dirty: true`, base, mergeBase and head are all `21c8f09`. The client file routes to `frontend-ui-architecture`, `react-best-practices`, `typescript-expert` and `next-best-practices` (rules `client-code`, `client-app-router`). The server file routes to `onion-architecture`, `typescript-expert`, `fastify-best-practices` and `zod` (rules `backend-code`, `fastify-routes`). 7 distinct skills, every one `exists: true`. `unrouted: []`, `warnings: []`. Checks: client `pnpm typecheck`/`lint`/`test`; server `pnpm typecheck` and `vitest run --exclude '**/*.it.test.ts'`, with no DB-backed tests. `git status` was unchanged afterwards. This matches [criterion-21-preparation.md](../evidence/criterion-21-preparation.md). PASS (routing only) |
| 2c | The router's unit tests pass | `TMPDIR=<scratchpad>/tmp node --test <E>/.claude/skills/pr-self-review/scripts/route-diff.test.mjs`. The output is not kept in this repository; its result is summarized here | 10/10 pass, 0 fail. The tests create and delete throwaway git repos under `os.tmpdir()`, so TMPDIR pointed them at the scratchpad; the folder was empty afterwards and is now removed. The extraction worktree stayed clean. The test file is identical in both checkouts. PASS |
| 3a | Slash-command definition | `.claude/skills/pr-self-review/SKILL.md` frontmatter | `name: pr-self-review`, `disable-model-invocation: true`, `metadata.type: workflow`. There is no `argument-hint` (it is optional). The body documents `/pr-self-review [--base <ref>]`. `disable-model-invocation: true` means the model cannot trigger it, but a user can still type it, which matches "manual only". PASS |
| 3b | The skill is present in the scratch checkout | `ls S/.claude/skills` | 14 skill directories, including `pr-self-review` and all 7 routed skills. No `settings.local.json`. PASS |
| 3c | Identical to the PR head | `diff -r E/.claude S/.claude` | No differences (`CLAUDE_DIR_IDENTICAL`). PASS |
| 3d | The CLAUDE.md symlinks resolve | `find` + `readlink` in S, excluding `clones/` and `node_modules` | `./`, `client/`, `server/`, `e2e/`, `reviewer-core/` each have `CLAUDE.md -> AGENTS.md`, and all five resolve. PASS |
| 4a | No git hooks | `ls` of the common `.git/hooks` (worktrees share it) | Only `*.sample` files, so no active hook. PASS |
| 4b | No hooksPath override | `git config --get core.hooksPath` (repo), `--global`, `--system`; `extensions.worktreeConfig` | Unset everywhere, and there is no per-worktree config. PASS |
| 4c | No husky, lefthook or pre-commit tooling | `ls -a` of the root, `client/` and `server/`; grep of `prepare`/`postinstall`/`pre-push` scripts in the four `package.json` files | None found. PASS |
| 4d | Claude hooks | `S/.claude/settings.json`; the `hooks` key of `~/.claude/settings.json` (only that key was printed) | The project has one hook: `UserPromptSubmit` runs `engineering-insights-reminder.mjs`. That script only prints an `additionalContext` reminder about insights and runs nothing else. The user-level setting is `hooks: null`. No Pre/PostToolUse or push hooks. PASS |
| 4e | CI | `grep pr-self-review .github/workflows/*` | `agent-instructions.yml` (on push and pull_request) runs only `node --test …/route-diff.test.mjs`. It never invokes the review skill. Note for the mentor: see Q3 |
| 5 | Secret exposure | Read SKILL.md, the router and `.gitignore`; grep for `.devdigest` | The skill has no step that reads env, keys or `~/.devdigest`. Residual risk: the server unit tests load `server/src/platform/config.ts`, which knows the path of `~/.devdigest/secrets.json`. Tool output that a model echoes could show paths, though no test is expected to print secret values. The owner should check the transcript before sharing it (see the ingestion checklist) |
| 6a | Cannot push to PR #53 | Detached HEAD; `git config --get-regexp '^(remote\|branch\|push)\.'` | `origin` is shared with the main repository, so it does exist. HEAD has no branch, so it has no upstream, and a plain `git push` fails with "not currently on a branch". An explicit refspec push (for example `git push origin HEAD:<branch>`) would still work, so the owner must deny any push. `codex/l02-extraction-authorization` has no `branch.*` upstream entry at all. PASS (owner-controlled) |
| 6b | The skill makes no commits or pushes | SKILL.md | "It never edits files, commits, pushes or opens a PR … Stop after the report." PASS |
| 6c | Steps that might write | SKILL.md step 3 and the project AGENTS.md | (i) The client and server checks may create gitignored build or cache artifacts in S. That is harmless and does not touch PR #53. (ii) **Risk:** the `UserPromptSubmit` reminder and the project AGENTS.md "After finishing" rule may lead the model to propose appending to `INSIGHTS.md`/`LEARNINGS.md` in S. The owner must decline that edit, or the diff stops being the two-marker mixed diff. (iii) If a dependency is missing, the model might propose `pnpm install`; decline that too. WARN (owner-controlled) |
| 7 | Minimum evidence for row 21 | Read the ACCEPTANCE row, the rubric-source table, `repo-checks.md` row 21, [criterion-21-preparation.md](../evidence/criterion-21-preparation.md), MENTOR-WALKTHROUGH §1 and PLAN.md. The private rubric file was not opened | See below |

## 7. Minimum evidence and interpretation

The row text is a paraphrase of the recovered English translation; the ACCEPTANCE "Rubric source" table says original-source verification is still open: "Manual `pr-self-review` on a mixed diff loads both skill sets; no push hook".

The minimum evidence I derive from that text alone:

1. **Manual:** a transcript, export or screenshot showing that the owner typed `/pr-self-review --base HEAD` in a session whose cwd is the scratch checkout.
2. **Mixed diff:** the run's routing shows both `client/src/app/skills/page.tsx` and `server/src/modules/skills/routes.ts`.
3. **Both Skill sets loaded in the same invocation:** Read tool calls (or the report's Routing section) for the frontend set (`frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`) and the backend set (`onion-architecture`, `typescript-expert`, `fastify-best-practices`, `zod`).
4. **No push hook:** the static evidence (4a–4e) plus a run that finishes without any push or commit.

The verdict (PASS, WARN or BLOCKED) is not part of the row text.

**Mentor questions. Do not resolve these by inventing a rule:**

- **Q1:** Does "loads both skill sets" accept the dispatcher reading each `SKILL.md` with the Read tool, which is the design in SKILL.md step 2? The alternative reading would require Claude Code's native skill activation for each sub-skill.
  - **Q1 sub-case:** if the run loads some or all sub-skills through the `Skill` tool instead of a Read, does that count? The ingestion count records which mechanism was used per skill, so either answer can be applied without re-running.
- **Q2:** Is a static absence-of-hook check (4a–4d) plus the observed run enough for "no push hook", or must a push also be shown to trigger nothing? That would need a real push, which is out of scope and unsafe here.
- **Q3:** CI runs the router's fixture tests on `push`. Confirm that this does not count as a "push hook", since it never runs the review.
- **Q4:** Does the row need the run's verdict to be PASS? The checks could fail for environmental reasons and yield WARN or BLOCKED.
- **Q5:** Is running in a scratch checkout at `21c8f09` acceptable, rather than at the PR head `7b066cb`? `21c8f09` is an ancestor of the PR head, and `.claude/` is byte-identical between the two. ACCEPTANCE line 5 says evidence must come from this branch. The [recommended pre-run step](21-owner-instructions.md#recommended-pre-run-step-owner-decision-not-executed) reduces this question if the owner takes it (a later docs or evidence commit makes the run's commit an ancestor again).
