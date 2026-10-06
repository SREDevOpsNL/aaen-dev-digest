# Agent environment

How a coding agent — any vendor — locates, edits, and verifies its workspace.
The invariants live in [`../../AGENTS.md`](../../AGENTS.md); this document holds
the procedure behind them.

## Canonical execution environment

Development happens in a **native-filesystem checkout**:

| Host | Canonical checkout |
| --- | --- |
| Linux (and CI) | The checkout on the native Linux filesystem |
| macOS | The checkout on the native local filesystem |
| Windows | A Git worktree on the Ubuntu 24.04 WSL2 Linux filesystem (under `/home/...`) |

On a Windows host, the path forms mean:

| Path form | Role |
| --- | --- |
| `/home/<user>/.../<worktree>` inside WSL | Canonical. Edits, Git, `pnpm`/`npm`, builds, tests, and verification run here. |
| `\\wsl.localhost\Ubuntu-24.04\home\<user>\...\<worktree>` | Windows view of the same files, for Explorer, Git GUIs, and editors. Not an agent's working path. |
| `/mnt/c/...`, `/mnt/d/...` | Windows drives seen from WSL. Never a substitute for an existing Linux worktree. |
| A separate clone on a Windows drive | Not a delivery source. Do not edit it to mirror newer repository state. |

Prefer running the agent itself inside WSL (for example the Claude Code CLI or
the Codex CLI started from the worktree) for substantial implementation work: it
removes the Windows ↔ WSL boundary entirely. A Windows-hosted desktop agent may
open the `\\wsl.localhost\...` view, but should execute commands in WSL as
described below.

## Establish the workspace before editing

Worktree paths change per task, so discover them from Git rather than assuming
a directory name. Before substantial modification, run in the intended worktree:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git log -1 --oneline
```

For delivery work, also establish the upstream and the pull request:

```bash
git rev-parse --abbrev-ref '@{u}'
git rev-list --left-right --count '@{u}...HEAD'
git worktree list
gh pr list --head <remote-branch>
```

State the result (path, branch, `HEAD`, upstream, pull request) before editing.
When several worktrees are active, the conversation's topic does not identify
the target: a repository-wide change discussed in a feature conversation does
not automatically belong on that feature's branch. Ask when the target is not
explicit.

A local branch name can differ from its pull-request branch (for example a
local `-wsl` suffix). Push explicitly to the remote branch and pin the expected
old tip so the lease actually protects concurrent work:

```bash
git push --force-with-lease=<remote-branch>:<expected-old-sha> origin HEAD:<remote-branch>
```

Never use plain `--force`, and never create a remote branch from the local
name by accident.

## Editing fallback order

1. Edit the native-filesystem worktree with the agent's normal file tools.
2. If a Windows-hosted agent's patch tool cannot write the WSL file, execute
   the edit **inside WSL**, with an explicit working directory and the script on
   stdin (see the next section).
3. If a unified diff is the clearest edit, stream it to `git apply` inside WSL
   without writing a file:

   ```bash
   patch=$(cat <<'PATCH'
   --- a/path/to/file
   +++ b/path/to/file
   @@ ... @@
   PATCH
   )
   printf '%s\n' "$patch" | git apply --check - && printf '%s\n' "$patch" | git apply -
   ```

4. Only if a file is genuinely required, keep it inside WSL under `/tmp`, check
   it, apply it, and remove it:

   ```bash
   p=$(mktemp /tmp/<task>.XXXXXX.patch)
   # write the patch to "$p"
   git apply --check "$p" && git apply "$p"; rm -f "$p"
   ```

5. A transport file on a Windows drive (for example `D:\...\.codex-*.patch`) is a
   last resort only.

Every transport artifact is temporary: never stage or commit it, never place it
inside the worktree when another option exists, and delete it after successful
application. Finish with `git status --short` and confirm no artifact remains.

## Invoking WSL from a Windows-hosted agent

Complex nested shell strings whose quoting or variable expansion crosses the
Windows and Linux shell boundary have lost variables and run in the caller's
Windows working directory instead of the intended worktree. Make every boundary
explicit — distribution, working directory, Linux shell, script — and send
non-trivial scripts through stdin:

```text
wsl.exe -d Ubuntu-24.04 --cd /home/<user>/.../<worktree> -- bash -s < script.sh
```

Do not rely on the caller's Windows working directory, and do not embed
multi-line scripts in a single quoted `bash -c` argument. When the caller is Git
Bash (MSYS), its argument path conversion rewrites a Linux path given to
`--cd`; set `MSYS_NO_PATHCONV=1` for that call.

A non-interactive `bash -s` shell may not initialize user-managed toolchains
such as nvm, so Node, npm, or pnpm can be missing from its `PATH` even though an
interactive terminal finds them. When the script needs them, initialize the
toolchain explicitly in the script (for nvm: `. "$NVM_DIR/nvm.sh"`, with
`NVM_DIR` defaulting to `$HOME/.nvm`) or call an executable path resolved
beforehand. Always inspect each command's exit status: exit 127 means the
command was not found and the intended check did not run.

## Verifying instruction discovery

`node scripts/verify-agent-instructions.mjs` checks the repository side of the
`AGENTS.md` contract on every pull request. Its scope is the five canonical
project/package instruction files — `AGENTS.md`, `client/AGENTS.md`,
`server/AGENTS.md`, `reviewer-core/AGENTS.md`, `e2e/AGENTS.md` — not tool- or
skill-local files such as `.claude/skills/zod/AGENTS.md`. It checks regular
(non-symlink) files,
resolvable relative links, each package file extending `../AGENTS.md`, the root
map linking every package file, and no `CLAUDE.md`, `CLAUDE.local.md`, or
`.claude/CLAUDE.md` in the instruction directories.

Whether a particular agent surface actually loads the hierarchy is a runtime
question the script cannot answer. Verify it per surface with sentinel facts
that cannot be inferred from repository content — one in the root `AGENTS.md`,
one in a package `AGENTS.md` — asked from a session started in that package,
then remove the sentinels. Record each surface's result in
[`LEARNINGS.md`](../../LEARNINGS.md); add a vendor compatibility shim only after
a demonstrated failure, and allow exactly that form in the verifier.
