# Criterion 21: the owner's manual `/pr-self-review --base HEAD` run

**Result:** one real, user-typed invocation in the scratch checkout routed a
mixed client/server diff, read all seven routed `SKILL.md` files, ran the five
deterministic checks and reported `PR Self Review: PASS`. It made no edit,
commit or push (the checks only refreshed a gitignored build cache), and no
push hook exists.

This file is a sanitized excerpt of the session transcript. The raw transcript
stays outside Git (see [Provenance](#provenance)). Everything below was
re-derived from that raw file on 2026-11-04 by parsing it, using the parser in
the [ingestion checklist](../proposals/21-ingestion-checklist.md#b-required-observable-markers-all-must-be-present-in-one-invocation).
Output is quoted, not paraphrased, except where a passage is marked as a
summary. The preparation and earlier
attempts are in [criterion-21-preparation.md](criterion-21-preparation.md).

## Provenance

| Item | Value |
| --- | --- |
| Who invoked it | The owner, by typing the slash command in a new interactive Claude Code session. The owner confirmed the run, with its date, time, folder, baseline and verdict, to the coordinator session on 2026-11-04 |
| Date and time | 2026-11-04, 08:56:14 → 08:58:08 UTC (09:56–09:58 +01:00) |
| Client | Claude Code CLI 2.1.278, entrypoint `cli` (option B in the [owner steps](../proposals/21-owner-instructions.md#run-it)) |
| Model | `claude-sonnet-5` |
| Permission mode | `auto` for the whole session. See [Permission mode](#permission-mode-auto) |
| Working directory | `/home/dmitri/projects/aaen-dev-digest-l02-self-review`. All assistant entries have this cwd (0 mismatches); the check commands `cd` into `client/` and `server/` of the same checkout |
| Baseline | Detached `HEAD` at `b67740ed01038f2c6ef88c16f07deda6631710ea`, the PR #53 head when the run was made, plus the two uncommitted marker lines |
| Session | `1f3a2d32-4728-4708-b825-c707fc1339b5` |
| Raw transcript | `~/.claude/projects/-home-dmitri-projects-aaen-dev-digest-l02-self-review/1f3a2d32-4728-4708-b825-c707fc1339b5.jsonl`, 84 entries, SHA-256 `406124c47dc2e314bd6fa237aff264c854ef7cc22bbddcca08d3f028af017353`, 518,668 bytes, hashed at ingestion (2026-11-04 about 17:51 UTC) and unchanged when rechecked about 18:20 UTC. Its modification time changed after the run while its size and hash did not. Not committed; it also holds the account e-mail and the full system prompt, which is another reason it stays out of Git |
| Subagents | None: 0 sidechain entries and no `subagents/` directory |

The scratch checkout was moved from `21c8f09` to `b67740e` on 2026-11-03 by
the [guarded pre-run step](../proposals/21-owner-instructions.md#recommended-pre-run-step-owner-decision-not-executed),
which the owner authorized. A separate coordinator session
(`e1668702-…`) did that preparation with its folder set to the scratch
checkout, so the self-review project folder holds two transcripts. Only
`1f3a2d32-…` is the run. Its only user turn is the slash command.

## The invocation

The only user-typed turn, as recorded:

```text
<command-message>pr-self-review</command-message>
<command-name>/pr-self-review</command-name>
<command-args>--base HEAD</command-args>
```

It is followed, at the same timestamp, by the expanded skill text that Claude
Code injects ("Base directory for this skill: …/.claude/skills/pr-self-review"),
whose body equals the text after the frontmatter of
`.claude/skills/pr-self-review/SKILL.md` at `b67740e`, followed by the line
`ARGUMENTS: --base HEAD`. That
skill has `disable-model-invocation: true`, so the model cannot start it; only
a typed command can.

## The diff under review

`git diff HEAD -- client/src/app/skills/page.tsx server/src/modules/skills/routes.ts`,
run by the session (08:56:28 UTC):

```diff
diff --git a/client/src/app/skills/page.tsx b/client/src/app/skills/page.tsx
index bf98059..37ea60f 100644
--- a/client/src/app/skills/page.tsx
+++ b/client/src/app/skills/page.tsx
@@ -1,3 +1,4 @@
+// L02 criterion 21 scratch diff: harmless review-routing marker.
 "use client";

 import React from "react";
diff --git a/server/src/modules/skills/routes.ts b/server/src/modules/skills/routes.ts
index da29c77..245fade 100644
--- a/server/src/modules/skills/routes.ts
+++ b/server/src/modules/skills/routes.ts
@@ -1,3 +1,4 @@
+// L02 criterion 21 scratch diff: harmless review-routing marker.
 import type { FastifyInstance } from 'fastify';
 import type { ZodTypeProvider } from 'fastify-type-provider-zod';
 import { z } from 'zod';
```

The blank context line's single leading space is dropped here so that
`git diff --check` stays clean; nothing else differs from the session output.

## Router

`node .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD`
(08:56:18 UTC, no error). Full output:

```json
{
  "base": "HEAD",
  "baseSha": "b67740ed01038f2c6ef88c16f07deda6631710ea",
  "mergeBase": "b67740ed01038f2c6ef88c16f07deda6631710ea",
  "headSha": "b67740ed01038f2c6ef88c16f07deda6631710ea",
  "dirty": true,
  "files": [
    {
      "path": "client/src/app/skills/page.tsx",
      "status": "M",
      "skills": ["frontend-ui-architecture", "react-best-practices", "typescript-expert", "next-best-practices"],
      "rules": ["client-code", "client-app-router"]
    },
    {
      "path": "server/src/modules/skills/routes.ts",
      "status": "M",
      "skills": ["onion-architecture", "typescript-expert", "fastify-best-practices", "zod"],
      "rules": ["backend-code", "fastify-routes"]
    }
  ],
  "unrouted": [],
  "skills": {
    "frontend-ui-architecture": { "path": ".claude/skills/frontend-ui-architecture/SKILL.md", "exists": true, "files": ["client/src/app/skills/page.tsx"] },
    "react-best-practices": { "path": ".claude/skills/react-best-practices/SKILL.md", "exists": true, "files": ["client/src/app/skills/page.tsx"] },
    "typescript-expert": { "path": ".claude/skills/typescript-expert/SKILL.md", "exists": true, "files": ["client/src/app/skills/page.tsx", "server/src/modules/skills/routes.ts"] },
    "next-best-practices": { "path": ".claude/skills/next-best-practices/SKILL.md", "exists": true, "files": ["client/src/app/skills/page.tsx"] },
    "onion-architecture": { "path": ".claude/skills/onion-architecture/SKILL.md", "exists": true, "files": ["server/src/modules/skills/routes.ts"] },
    "fastify-best-practices": { "path": ".claude/skills/fastify-best-practices/SKILL.md", "exists": true, "files": ["server/src/modules/skills/routes.ts"] },
    "zod": { "path": ".claude/skills/zod/SKILL.md", "exists": true, "files": ["server/src/modules/skills/routes.ts"] }
  },
  "checks": [
    { "package": "client", "cwd": "client", "commands": ["pnpm typecheck", "pnpm lint", "pnpm test"] },
    { "package": "server", "cwd": "server", "commands": ["pnpm typecheck", "pnpm exec vitest run --exclude '**/*.it.test.ts'"] }
  ],
  "warnings": []
}
```

Arrays are joined onto one line here; the values and order are unchanged.

## Skill loading (not only router selection)

Each routed skill was loaded by a separate `Read` tool call, in one invocation,
after the router and before the checks. For every call the transcript holds a
successful `tool_result`; the Read returned the whole file (lines returned =
total lines), and the returned content is byte-identical to the file, whose
blob equals the one committed at `b67740e`.

| Set | Skill | `Read` at (UTC) | Lines returned / total | Blob at `b67740e` |
| --- | --- | --- | --- | --- |
| Frontend | `frontend-ui-architecture` | 08:56:31.6 | 58 / 58 | `22d1116b77ed` |
| Frontend | `react-best-practices` | 08:56:32.2 | 176 / 176 | `9a56f72d5f8b` |
| Shared | `typescript-expert` | 08:56:32.8 | 432 / 432 | `546dfedbf9f7` |
| Frontend | `next-best-practices` | 08:56:33.4 | 154 / 154 | `437896b40cc3` |
| Backend | `onion-architecture` | 08:56:34.0 | 54 / 54 | `dc7577a4af93` |
| Backend | `fastify-best-practices` | 08:56:34.5 | 76 / 76 | `439e684d678e` |
| Backend | `zod` | 08:56:35.0 | 128 / 128 | `7c85830999f9` |

No `references/` file was read. `SKILL.md` step 2 also asks for "the
references it points to for the matched files"; for this comment-only diff
the session read only the seven `SKILL.md` files.

Mechanism: `Read` for all seven, `Skill` tool for none. This is the design in
`pr-self-review/SKILL.md` step 2. Whether it satisfies "loads" is mentor
question Q1 in [21-readiness.md](../proposals/21-readiness.md#7-minimum-evidence-and-interpretation).

Ingestion parser output (checklist section B, run unchanged):

```text
[main] start marker found: True; sidechain assistant entries: 0
  frontend-ui-architecture: Read=1 Skill=0
  react-best-practices: Read=1 Skill=0
  next-best-practices: Read=1 Skill=0
  typescript-expert: Read=1 Skill=0
  onion-architecture: Read=1 Skill=0
  fastify-best-practices: Read=1 Skill=0
  zod: Read=1 Skill=0
  SKILL.md Read/Skill calls denied, errored or without result: 0
  SKILL.md Reads outside the session cwd: 0
  assistant entries whose cwd is not the scratch checkout: 0
  Bash git push/commit or gh pr calls: 0
subagent transcripts: 0
```

## Checks

The five commands the router listed, run in the scratch checkout. Each was
run as `cd <scratch>/<package> && <command> 2>&1 | tail -n <N>`.

| Package | Command | Ran (UTC) | Output |
| --- | --- | --- | --- |
| client | `pnpm typecheck` | 08:56:39 → 08:56:53 | `tsc --noEmit`, no diagnostics |
| client | `pnpm lint` | 08:56:39 → 08:56:57 | `eslint . --max-warnings=0`, no problems printed |
| client | `pnpm test` | 08:56:40 → 08:57:05 | `Test Files 31 passed (31)`, `Tests 136 passed (136)` |
| server | `pnpm typecheck` | 08:56:41 → 08:57:14 | `tsc --noEmit -p tsconfig.json`, no diagnostics |
| server | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | 08:56:42 → 08:57:42 | `Test Files 50 passed (50)`, `Tests 654 passed (654)` |

Limitation: the `| tail` pipe means the recorded exit status is `tail`'s, not
the command's. The PASS lines rest on the printed output: the test summaries
state their counts, and `tsc` and `eslint --max-warnings=0` print diagnostics
when they fail, and printed none. The client test run also printed two
chart zero-size warnings ("The width(0) and height(0) of chart …") on stderr from `src/test/smoke.test.tsx`,
whose 3 tests passed. No DB-backed test was run, as the router specified.

The last tool call (08:58:00 UTC) was `git status --short`, which showed only
the two ` M` marker files.

## Final report

Verbatim, as the session ended it (08:58:08 UTC):

```text
PR Self Review: PASS
Baseline: HEAD@b67740e … HEAD@b67740e + local changes (dirty: yes)

Routing
- frontend-ui-architecture <- client/src/app/skills/page.tsx
- react-best-practices <- client/src/app/skills/page.tsx
- typescript-expert <- client/src/app/skills/page.tsx, server/src/modules/skills/routes.ts
- next-best-practices <- client/src/app/skills/page.tsx
- onion-architecture <- server/src/modules/skills/routes.ts
- fastify-best-practices <- server/src/modules/skills/routes.ts
- zod <- server/src/modules/skills/routes.ts
- unrouted: none

Checks
- PASS client: pnpm typecheck
- PASS client: pnpm lint
- PASS client: pnpm test (31 files, 136 tests)
- PASS server: pnpm typecheck
- PASS server: pnpm exec vitest run --exclude '**/*.it.test.ts' (50 files, 654 tests)

Findings
(none)
```

The session then added this explanation, verbatim:

> The entire diff is two one-line comments added at the top of each file (`// L02 criterion 21 scratch diff: harmless review-routing marker.`), with no other code changes. Both are non-functional:
> - `client/src/app/skills/page.tsx`: comment precedes `"use client"` — Next.js treats directives by statement position, not literal first line, so a leading comment doesn't break the directive (confirmed by passing typecheck/lint/tests).
> - `server/src/modules/skills/routes.ts`: comment precedes the imports, no effect on the Fastify route module.
>
> No rule from any routed skill (React, Next.js, TypeScript, onion-architecture, Fastify, Zod) applies to a comment-only change, and security review wasn't triggered since nothing touches credentials, untrusted input, or auth. All required checks passed. Verdict: **PASS**.

## No push hook

**During the run.** The session made 8 `Bash` calls (the router, `git diff`,
the five checks and `git status`); none ran `git commit`, `git push` or
`gh pr`. There was no `Edit`, `Write` or `NotebookEdit` call. The only hook
event recorded is the project's `UserPromptSubmit` reminder, which fired
once on the typed command.

**Static re-check at ingestion (2026-11-04), checklist section C:**

| Check | Result |
| --- | --- |
| Active git hooks in the shared `~/projects/aaen-dev-digest/.git/hooks` (the scratch and PR worktrees use the same common dir) | none; only `*.sample` |
| `core.hooksPath` at repository, global and system level; `extensions.worktreeConfig` | all unset; no `config.worktree` |
| `.claude/settings.json` | only the `UserPromptSubmit` hook running `engineering-insights-reminder.mjs`; `.claude/hooks/` holds only that script. User-level `hooks`: unset |
| husky, lefthook, pre-commit, or `prepare`/`postinstall`/`pre-push`/`pre-commit` package scripts | none in the root, `client/`, `server/`, `e2e/` or `reviewer-core/` |
| CI | `agent-instructions.yml` (triggers: push to `main`, `pull_request`) runs `node scripts/verify-agent-instructions.mjs`; its only `pr-self-review` step is `node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs`. It never invokes the skill (mentor Q3) |
| `.claude/` in the scratch checkout vs the PR worktree | identical (`diff -r`) at ingestion, about 18:54 +01:00. Afterwards the coordinator session's own scheduled wake-up made Claude Code create `.claude/scheduled_tasks.lock` in the scratch checkout (18:55:24 +01:00). That runtime lock file is ignored by `.git/info/exclude`, is not tracked, postdates the run and has no bearing on it; `git status` is unchanged |

**After the run.** The scratch checkout is still detached at `b67740e`, its
last commit is still `b67740e`, and `git status --porcelain --untracked-files=all`
shows only ` M client/src/app/skills/page.tsx` and
` M server/src/modules/skills/routes.ts` (2 files, +2 lines). Among ignored
files (outside `node_modules`), the client typecheck rewrote
`client/tsconfig.tsbuildinfo` (08:56:53 UTC, when it finished), and the
`scheduled_tasks.lock` described above appeared later. Neither is tracked.

## Permission mode: `auto`

The session ran in `auto` permission mode: all 5 `permission-mode` entries
in the transcript are `auto`, from the first entry on. Neither the user nor
the project settings set a `defaultMode`, so this is Claude Code's own
default; the owner reported that the session banner said the same. The
owner left it at its default, as the [owner steps](../proposals/21-owner-instructions.md#run-it)
asked, but those steps assumed a mode that prompts for each command. In
`auto`, Claude Code approves lower-risk calls itself, so the owner was not
asked to approve the router, the reads or the checks.

What this does and does not show:

- It is an execution detail, not a failure: criterion 21 asks for a manual
  invocation, both skill sets loaded and no push hook. All three hold, and
  the invocation itself was typed by the owner.
- The model attempted no write, commit or push, so nothing had to be denied.
  **No permission-denial test took place**, and this evidence does not claim
  one. The "deny any edit or push" safeguard in the owner steps was not
  exercised.

## Open mentor questions

Row 21 is Verified under the ingestion rule: every section-B marker is
present, and nothing in the run contradicts Q1. These questions from
[21-readiness.md](../proposals/21-readiness.md#7-minimum-evidence-and-interpretation)
stay open for the mentor, with what this run adds:

- **Q1 (what "loads" means):** all seven skills were loaded by the dispatcher
  with `Read`, the documented design; none by the `Skill` tool. If the mentor
  requires native skill activation per sub-skill, row 21 goes back to
  Implemented.
- **Q2 (no push hook):** the static checks and a run with zero push or commit
  calls. No push was performed to show that it triggers nothing.
- **Q3 (CI):** the `agent-instructions` workflow (push to `main` and
  pull requests) runs the router's fixture tests, never the review skill.
- **Q4 (verdict):** the verdict was `PASS`, so this question does not affect
  the row.
- **Q5 (commit):** the run used `b67740e`, the PR #53 head at the time. The
  commit that adds this file is a later, documentation-only head, so
  `b67740e` is again an ancestor of the submitted head. Check with
  `git diff --stat b67740e <head> -- . ':!docs'`, which should print nothing.
- **Permission mode (new):** the run used Claude Code's default `auto` mode,
  not a mode that prompts per command. Please confirm that this is
  acceptable for "manual". The invocation itself was typed by the owner, and
  no denial was tested.

## Redaction

The raw transcript was parsed, not copied. This excerpt keeps commands, the
router JSON, Read metadata, test summaries and the report. It omits the
skill bodies, the injected instructions and per-test output. A scan of the raw
transcript found no credential value: no `ghp_`, `github_pat_`, `Bearer`,
`ANTHROPIC` or `OPENROUTER`. `secrets.json` and `.devdigest` appear only in
quoted `AGENTS.md` text, `sk-` only inside the word "task-", and `token` (including
`GITHUB_TOKEN`/`GITHUB_PAT`) only as a word in instructions, skill text and
usage counters. The section-D scan of this file matches only the two lines of
this paragraph that name the search terms; no value appears. No
screenshots are filed with this record.

## Checklist status

| Checklist item | Status |
| --- | --- |
| A. Session with the scratch cwd, typed first turn, after 2026-11-03, owner confirmation, checkout unchanged | met (two transcripts in the folder; only `1f3a2d32-…` is the run; owner confirmed on 2026-11-04) |
| B. Router run listing both files, `unrouted: []`, `warnings: []` | met |
| B. Mixed diff covers both packages | met |
| B. Frontend set loaded | met (Read ×4, incl. shared `typescript-expert`) |
| B. Backend set loaded | met (Read ×3 + shared `typescript-expert`) |
| B. Report with Routing, Checks, Findings; verdict recorded | met: `PASS` |
| B. No push or commit | met: 0 calls; scratch `HEAD` unchanged |
| C. Static no-push-hook evidence unchanged | met |
| D. Redaction | met; raw jsonl not committed |

## Correction and preliminary review (2026-11-04, later)

Appended after the commit that added this file (`85ab923`). The text above
is unchanged.

### Correction to the Q5 note

The Q5 note in [Open mentor questions](#open-mentor-questions) says that
`git diff --stat b67740e <head> -- . ':!docs'` "should print nothing". At
`85ab923` it prints `INSIGHTS.md` and `LEARNINGS.md`: the root insights
entries were added to that commit after the note was written. The correct
statement:

- Between `b67740e` and `85ab923`, only `docs/homework/L02/**`, the root
  `INSIGHTS.md` and the root `LEARNINGS.md` changed
  (`git diff --name-status b67740e 85ab923`).
- `.claude/`, every `AGENTS.md` and `CLAUDE.md`, `.github/`, `scripts/` and
  all package source are unchanged. This prints nothing:
  `git diff --stat b67740e <head> -- . ':!docs' ':!INSIGHTS.md' ':!LEARNINGS.md'`.
- The root `AGENTS.md` tells agents to read the root `LEARNINGS.md` and
  `INSIGHTS.md` for cross-package work, so those two files belong to the
  general instruction surface. They do not affect the router, the
  permissions or the `pr-self-review` instructions. The recorded run read
  neither: its only `Read` calls were the seven `SKILL.md` files.

### Preliminary review of the mentor questions

On 2026-11-04 the owner shared a written review of Q1–Q5 and the
permission-mode question, titled as a mentor review. It says its verdicts are
"engineering judgments based on the provided criterion, rather than a claim
that the instructor has approved the implementation", and it works from the
translated rubric, not the original. It is recorded here as a **preliminary
review, not a mentor or instructor ruling**. Its reading of the translated
criterion adds two points to the row's paraphrase: automatic invocation
through a `git push` hook is disabled locally, and the manual run must load
both Skill sets at the same time. The rubric text itself stays private.

| Question | Preliminary verdict and its condition | This run |
| --- | --- | --- |
| Q1 (loading) | Conditionally yes. Native invocation of the dispatcher plus reading both child `SKILL.md` sets is sufficient, though it is not native activation of each child Skill, *provided the transcript shows their instructions being applied* | Native invocation: yes; the typed command is followed by the skill text Claude Code injects. Dispatcher instructions applied: the report follows its format, its security rule is reflected ("security review wasn't triggered since nothing touches credentials, untrusted input, or auth") and the verdict follows its PASS rule. Child skills: all seven were read in full and each file was discussed in its own domain (the Next.js `"use client"` directive, the Fastify route module). The comment-only diff gave no rule anything to act on, so **no finding shows a child skill changing the outcome** |
| Q2 (no push hook) | Yes for the static configuration, though not absolute proof of runtime behaviour. A real push is needed only if the original rubric asks for one | The static checks in [No push hook](#no-push-hook) cover the effective git hooks, `core.hooksPath`, husky/lefthook/package scripts, Claude Code settings and the workflows |
| Q3 (CI) | Not a push hook, provided CI never invokes the review skill | CI runs only the router's fixture tests and the instruction checker |
| Q5 (earlier commit) | Valid if the effective harness is unchanged; documentation can change agent behaviour, so check the changed files | Met, with the correction above |
| Permission mode | `auto` is acceptable as manual: who started the run and how tools are approved are separate | Met: the owner typed the command |
| Original rubric | Not verified against the original LMS text | Still open |

What follows for row 21:

- The review recommends marking the criterion "Implemented" once its
  conditions hold. In this matrix, **Implemented** means *not* shown at
  runtime, so the review's recommendation corresponds to what row 21 already
  records. Row 21 stays **Verified**; the count stays 51 Verified,
  2 Implemented, 0 Blocked.
- **Weakest point:** the Q1 condition that the child skills' instructions are
  applied. On this diff it is shown only as each skill being read and
  considered. A stronger demonstration needs a new run on a diff that breaks
  a rule from each set. No new run is authorized.
- **Still open:** whether the original rubric requires native activation of
  each child Skill. The translated wording cannot settle it.
