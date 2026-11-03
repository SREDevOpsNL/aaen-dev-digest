# Criterion 21: steps for the owner

Goal: one real, manual `/pr-self-review --base HEAD` run, which only you can do, in the prepared scratch checkout. It takes about 5 to 15 minutes, mostly waiting for the client and server checks.

## Recommended pre-run step (owner decision, not executed)

Nothing below has been run. It is optional, and it reduces mentor question Q5 ([21-readiness.md](21-readiness.md)) by putting the scratch checkout at the PR #53 head that will actually be submitted, with the same two marker lines. It does not remove Q5 entirely: a later docs or evidence commit on the PR branch makes the run's commit an ancestor of the final head again.

- The PR branch is `homework/l02-mentor-submission`, pushed from local branch `codex/l02-extraction-authorization`. This cycle's docs are prepared on `docs/l02-acceptance-cycle`.
- **Run these only in the scratch checkout `~/projects/aaen-dev-digest-l02-self-review`. Never in the PR worktree `~/projects/aaen-dev-digest-l02-extraction`, and never in `~/projects/aaen-dev-digest`.**

Paste the whole block at once, or none of it. It runs in a subshell and
stops at the first failed check, so it cannot act on another checkout.

```sh
(
set -eu
S="$HOME/projects/aaen-dev-digest-l02-self-review"
# 0. Guards: S must be exactly the scratch checkout, and it must hold only the two marker edits.
[ "$(git -C "$S" rev-parse --show-toplevel)" = "$S" ] || { echo "wrong directory"; exit 1; }
[ "$(git -C "$S" status --short | sort)" = "$(printf ' M client/src/app/skills/page.tsx\n M server/src/modules/skills/routes.ts')" ] \
  || { echo "unexpected changes in the scratch checkout; stopping"; exit 1; }
# 1. The commit that will be submitted. It must equal the pushed head of homework/l02-mentor-submission.
H=$(git -C "$HOME/projects/aaen-dev-digest-l02-extraction" rev-parse codex/l02-extraction-authorization)
R=$(git ls-remote https://github.com/SREDevOpsNL/aaen-dev-digest.git refs/heads/homework/l02-mentor-submission | cut -f1)
[ -n "$H" ] && [ "$H" = "$R" ] || { echo "local head $H differs from the pushed head $R; stopping"; exit 1; }
echo "submitted head: $H"
# 2. Drop the two marker lines, move the detached HEAD, and re-add them.
git -C "$S" checkout -- client/src/app/skills/page.tsx server/src/modules/skills/routes.ts
git -C "$S" checkout --detach "$H"
sed -i '1i // L02 criterion 21 scratch diff: harmless review-routing marker.' \
  "$S/client/src/app/skills/page.tsx" "$S/server/src/modules/skills/routes.ts"
# 3. Verify: detached at $H, exactly the two ' M' lines, +2 lines in total.
git -C "$S" rev-parse HEAD; git -C "$S" status --short; git -C "$S" diff --stat
)
```

- If either lockfile changed between `21c8f09` and `$H`, you (not the model) run `pnpm install --frozen-lockfile` in `client/` and `server/` of the scratch checkout **before** opening the session, so the model never proposes an install. This writes only the gitignored `node_modules` there.
- If you take this step, use `$H` instead of `21c8f09` everywhere below and in the coordinator's ingestion checklist.

## Before you start (30 seconds)

In a WSL terminal:

```sh
git -C ~/projects/aaen-dev-digest-l02-self-review status --short
git -C ~/projects/aaen-dev-digest-l02-self-review rev-parse --short HEAD
```

You should see exactly these two lines, then `21c8f09`:

```
 M client/src/app/skills/page.tsx
 M server/src/modules/skills/routes.ts
```

If you see anything else, stop and tell the coordinator.

## Run it

Choose **one** of the two options.

**A. Desktop app, Code tab**

1. Start a new Code session and set its folder to exactly `~/projects/aaen-dev-digest-l02-self-review`.
2. If the app offers to create a new worktree or isolated copy, **decline**. A fresh worktree does not contain the uncommitted mixed diff.

**B. Terminal**

```sh
cd ~/projects/aaen-dev-digest-l02-self-review && claude
```

The standalone CLI previously reported `loggedIn: false`, so use option A unless you have logged in again.

Then, for either option:

3. Leave the permission mode at its default. Do not use auto-accept edits or bypass permissions.
4. As the **first message**, type exactly:

   ```
   /pr-self-review --base HEAD
   ```

5. Approve the read-only steps and the check commands when asked: `node .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD`, `git diff …`, and `pnpm typecheck`/`pnpm lint`/`pnpm test` in `client/`, `pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'` in `server/`.
6. Let it finish. It ends with a report that starts `PR Self Review: PASS|WARN|BLOCKED`. Record whatever verdict appears; whether the row needs PASS is a mentor question (Q4).

## What you should see

- The router JSON lists both changed files, one under `client/` and one under `server/`.
- Read calls (or `Skill` tool calls; either is recorded) for each of these `SKILL.md` files:
  - Frontend: `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`
  - Backend: `onion-architecture`, `fastify-best-practices`, `zod` (`typescript-expert` is shared with the frontend set)
- A **Routing** section in the report naming those skills, then **Checks** and **Findings**.
- No commit, no push, no PR.

## What NOT to do

- **Deny** any edit or write, and **deny any push**. A plain `git push` fails in the detached checkout, but an explicit refspec push would still work. The deny list includes a proposal to append to `INSIGHTS.md` or `LEARNINGS.md` (a project hook reminds the model about insights), a proposed fix, `pnpm install`, `git commit`, `git push`, `gh pr …` and anything that touches Docker.
- Do not run it in `aaen-dev-digest`, the PR #53 worktree (`aaen-dev-digest-l02-extraction`) or a fresh worktree.
- Do not type a second prompt before the report appears, and do not ask the model to "just say it loaded the skills". The evidence must be the unprompted run.
- Do not paste or open `~/.devdigest/...` files, env output or API keys in the session.

## Save the evidence safely

1. **Keep the session.** Do not delete it. Its raw transcript is stored under `~/.claude/projects/<the self-review project folder>/`.
2. Take screenshots of:
   - the first message showing `/pr-self-review --base HEAD` and the folder or cwd;
   - the Read calls of the `SKILL.md` files;
   - the final report.
3. Optionally, export the transcript with the app's export, or `/export` in the CLI. Save it **outside any git checkout** first, for example in `~/l02-evidence/`.
4. Before handing anything over, scan it. Search for `ghp_`, `github_pat_`, `sk-`, `Bearer`, `secrets.json`, `.devdigest`, `ANTHROPIC`, `OPENROUTER` and `token`, and crop or blur any hit that shows a value.
5. Tell the coordinator: the session's date and time, the folder, and where the screenshots and export are. **Do not commit anything yourself.**
