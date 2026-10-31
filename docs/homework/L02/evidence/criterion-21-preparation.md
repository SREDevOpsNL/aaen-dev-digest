# Criterion 21: isolated Claude Code demonstration preparation

**Status:** prepared, still Blocked. This is not evidence of a completed
Claude Code `/pr-self-review` session.

The scratch checkout is
`/home/dmitri/projects/aaen-dev-digest-l02-self-review`, detached at
`21c8f09bb6582495d24702afd8aa35c10c62c96f`. It contains only two
uncommitted, harmless comment markers:

- `client/src/app/skills/page.tsx`
- `server/src/modules/skills/routes.ts`

No PR #53 source checkout or running evidence stack was edited for this
demonstration. The deterministic router was run in the scratch checkout with:

```sh
/home/dmitri/.nvm/versions/node/v22.23.2/bin/node \
  .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD
```

It reported both changed files, no unrouted files and no warnings. The client
file routed to `frontend-ui-architecture`, `react-best-practices`,
`typescript-expert` and `next-best-practices`; the server route routed to
`onion-architecture`, `typescript-expert`, `fastify-best-practices` and
`zod`. That proves routing only.

After the owner restores the supported Claude Code CLI login and usage, run a
real local Claude Code session **in that scratch checkout** and manually invoke
`/pr-self-review --base HEAD`. Capture the command/session transcript showing
both skill sets loaded in one invocation, the checks and the final review
report. Check that no push hook invoked the skill. Redact credentials and local
tokens before adding evidence. Keep criterion 21 Blocked until this session is
captured or the mentor explicitly accepts an alternative.

## Running it from the Claude Code desktop app (2026-10-30)

The WSL Claude Code CLI 2.1.278 still holds the credentials from 2026-10-25;
it was not retried. Claude Code is available through the desktop app's Code
tab, which runs Claude Code inside WSL. Dependencies were installed from the
frozen lockfiles in the scratch checkout (`npm ci` in `reviewer-core/`,
`pnpm install --frozen-lockfile` in `server/` and `client/`), so the
skill's deterministic checks can run. The tracked diff is still the two
comment markers at `21c8f09`.

Owner steps:

1. In the Code tab, start a new session whose folder is
   `/home/dmitri/projects/aaen-dev-digest-l02-self-review` itself. Do not let
   the app create a new worktree for it: a fresh worktree would not contain the
   uncommitted mixed diff.
2. Type `/pr-self-review --base HEAD` as the first message and let it finish.
3. Keep the session. Its transcript is then exported and sanitized into a new
   evidence file. That file must show one invocation reading both the frontend
   and backend `SKILL.md` sets, the checks and the final report. The only
   project hook is `UserPromptSubmit` (the insights reminder); there is no
   push hook.

## Status check (2026-10-30, later)

Checked from the Claude Code desktop session working on PR #53:

- The scratch checkout is intact: detached at `21c8f09`, exactly the two
  comment-marker changes in `client/src/app/skills/page.tsx` and
  `server/src/modules/skills/routes.ts`.
- No session was ever opened with that folder (no transcript under
  `~/.claude/projects/` for it), so no `/pr-self-review` run exists.
- The standalone WSL CLI 2.1.278 reports `loggedIn: false`; it was checked
  once and not retried.
- This session cannot substitute: its folder is another checkout, and
  `pr-self-review` has `disable-model-invocation: true`, so only a person can
  invoke it by typing the slash command.

Criterion 21 stays Blocked until the owner opens a Code-tab session whose
folder is the scratch checkout and types `/pr-self-review --base HEAD`.
