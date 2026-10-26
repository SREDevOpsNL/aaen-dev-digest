# Repository checks (rows 1–5, 39, 43)

Run in the worktree at `544ca92`. Output verbatim.

## Rows 1 and 2: CLAUDE.md symlinks to AGENTS.md

```
$ git ls-files -s CLAUDE.md server/CLAUDE.md client/CLAUDE.md reviewer-core/CLAUDE.md e2e/CLAUDE.md
120000 47dc3e3d863cfb5727b87d785d09abf9743c0a72 0	CLAUDE.md
120000 47dc3e3d863cfb5727b87d785d09abf9743c0a72 0	client/CLAUDE.md
120000 47dc3e3d863cfb5727b87d785d09abf9743c0a72 0	e2e/CLAUDE.md
120000 47dc3e3d863cfb5727b87d785d09abf9743c0a72 0	reviewer-core/CLAUDE.md
120000 47dc3e3d863cfb5727b87d785d09abf9743c0a72 0	server/CLAUDE.md
$ for f in CLAUDE.md server/CLAUDE.md client/CLAUDE.md reviewer-core/CLAUDE.md e2e/CLAUDE.md; do printf "%s -> %s\n" $f "$(git cat-file -p HEAD:$f)"; done
CLAUDE.md -> AGENTS.md
server/CLAUDE.md -> AGENTS.md
client/CLAUDE.md -> AGENTS.md
reviewer-core/CLAUDE.md -> AGENTS.md
e2e/CLAUDE.md -> AGENTS.md
$ node scripts/verify-agent-instructions.mjs
ok   AGENTS.md is a regular file with resolvable links
ok   client/AGENTS.md is a regular file with resolvable links
ok   server/AGENTS.md is a regular file with resolvable links
ok   reviewer-core/AGENTS.md is a regular file with resolvable links
ok   e2e/AGENTS.md is a regular file with resolvable links
ok   client/AGENTS.md extends ../AGENTS.md
ok   AGENTS.md links client/AGENTS.md
ok   server/AGENTS.md extends ../AGENTS.md
ok   AGENTS.md links server/AGENTS.md
ok   reviewer-core/AGENTS.md extends ../AGENTS.md
ok   AGENTS.md links reviewer-core/AGENTS.md
ok   e2e/AGENTS.md extends ../AGENTS.md
ok   AGENTS.md links e2e/AGENTS.md
ok   CLAUDE.md is a symlink to AGENTS.md
ok   no CLAUDE.local.md
ok   no .claude/CLAUDE.md
ok   client/CLAUDE.md is a symlink to AGENTS.md
ok   no client/CLAUDE.local.md
ok   no client/.claude/CLAUDE.md
ok   server/CLAUDE.md is a symlink to AGENTS.md
ok   no server/CLAUDE.local.md
ok   no server/.claude/CLAUDE.md
ok   reviewer-core/CLAUDE.md is a symlink to AGENTS.md
ok   no reviewer-core/CLAUDE.local.md
ok   no reviewer-core/.claude/CLAUDE.md
ok   e2e/CLAUDE.md is a symlink to AGENTS.md
ok   no e2e/CLAUDE.local.md
ok   no e2e/.claude/CLAUDE.md
ok   README.md resolves to AGENTS.md
ok   client/src/app resolves to client/AGENTS.md
ok   server/src/modules resolves to server/AGENTS.md
ok   reviewer-core/src resolves to reviewer-core/AGENTS.md
ok   e2e/specs resolves to e2e/AGENTS.md

All agent-instruction checks passed.
```

## Rows 3, 4, 5: development skills

```
$ grep -n "^#\|^##" .claude/skills/frontend-ui-architecture/SKILL.md
8:# Frontend UI Architecture
12:## Workflow
21:## Placement rules
32:## Where things live in `client/src`
44:## Naming conventions
51:## Project routing
$ grep -n "^#\|^##\|Routes never call adapters" .claude/skills/onion-architecture/SKILL.md
8:# Onion Architecture
12:## Workflow
21:## Non-negotiable boundaries
29:- **Routes never call adapters directly.** A route handler must not import from `server/src/adapters/**`, an SDK (Octokit, OpenAI, Anthropic, simple-git) or the database client; it calls a service, and the service obtains adapters through ports resolved by `platform/container.ts`.
47:## Project routing
$ sed -n 1,12p .claude/skills/pr-self-review/SKILL.md
---
name: pr-self-review
description: Workflow skill (dispatcher) that reviews the complete local change set before a PR is opened. It routes every changed file to the project skills that govern it, loads those skills, runs the deterministic checks for the touched packages, and reports PASS, WARN or BLOCKED. Manual only — run it with /pr-self-review [--base <ref>]; it is never triggered by a git hook.
disable-model-invocation: true
metadata:
  version: "1.0.0"
  type: workflow
---

# PR Self Review

A **Workflow skill**: it owns no review rules itself. It dispatches each slice of the diff to the skills that do, then combines their findings with deterministic checks into one verdict. Design rationale, severity policy and the deferred hook/CI phases are in [PLAN.md](../../../../.claude/skills/pr-self-review/PLAN.md).
$ node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs
ok 1 - client-only change loads only frontend skills
ok 2 - server-only change loads only backend skills
ok 3 - mixed client + server diff loads both skill sets at once
ok 4 - committed, renamed and untracked files are all collected
ok 5 - docs-only change forces no code skill; imported clones are never read
ok 6 - markdown inside a package triggers no package checks
ok 7 - a change to this workflow also lists its own router tests
ok 8 - a change to the instruction checker itself re-runs the checker
ok 9 - an unknown base fails clearly
ok 10 - routing table: persistence, security and contracts
# tests 10
# pass 10
# fail 0
```

## Row 39: sample selection without an LLM

```
$ sed -n 1,18p server/src/modules/conventions/constants.ts
export const TOP_CODE_SAMPLES = 12;

export const CONFIG_SAMPLE_PATHS = [
  'package.json',
  'tsconfig.json',
  'eslint.config.mjs',
  'eslint.config.js',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.editorconfig',
  'biome.json',
  'CONTRIBUTING.md',
  // Agent instructions: AGENTS.md is the portable format; CLAUDE.md is still common.
  'AGENTS.md',
  'CLAUDE.md',
] as const;
$ grep -n "getConventionSamples" server/src/modules/conventions/service.ts server/src/modules/repo-intel/service.ts
server/src/modules/conventions/service.ts:136:      .getConventionSamples(repoId, TOP_CODE_SAMPLES)
server/src/modules/repo-intel/service.ts:630:  async getConventionSamples(repoId: string, n: number): Promise<string[]> {
$ (cd server && pnpm exec vitest run test/conventions-helpers.test.ts)
 ✓ test/conventions-helpers.test.ts (10 tests) 9ms
      Tests  10 passed (10)
```

## Row 43: four API Contract skills with a directive description and good/bad examples

```
$ for f in docs/skills/api-contract/{breaking-change,response-schema,semver-discipline,deprecation-policy}.md; do echo "$f: $(grep -c "^Description:" $f) description, $(grep -c "^## Good" $f) Good, $(grep -c "^## Bad" $f) Bad"; done
docs/skills/api-contract/breaking-change.md: 1 description, 1 Good, 1 Bad
docs/skills/api-contract/response-schema.md: 1 description, 1 Good, 1 Bad
docs/skills/api-contract/semver-discipline.md: 1 description, 1 Good, 1 Bad
docs/skills/api-contract/deprecation-policy.md: 1 description, 1 Good, 1 Bad
```

## Row 21: `pr-self-review` on a mixed client + server diff

A throwaway change to `client/src/app/skills/helpers.ts` and `server/src/modules/skills/helpers.ts` in a disposable worktree (never committed). The router the workflow runs first routes both packages' skill sets:
```
$ node .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD
{
  "base": "HEAD",
  "baseSha": "544ca92eb353fb90ca6b99fec9885ab6f8d2069d",
  "mergeBase": "544ca92eb353fb90ca6b99fec9885ab6f8d2069d",
  "headSha": "544ca92eb353fb90ca6b99fec9885ab6f8d2069d",
  "dirty": true,
  "files": [
    {
      "path": "client/src/app/skills/helpers.ts",
      "status": "M",
      "skills": [
        "frontend-ui-architecture",
        "react-best-practices",
        "typescript-expert",
        "next-best-practices"
      ],
      "rules": [
        "client-code",
        "client-app-router"
      ]
    },
    {
      "path": "server/src/modules/skills/helpers.ts",
      "status": "M",
      "skills": [
        "onion-architecture",
        "typescript-expert"
      ],
      "rules": [
        "backend-code"
      ]
    }
  ],
  "unrouted": [],
  "skills": {
    "frontend-ui-architecture": {
      "path": ".claude/skills/frontend-ui-architecture/SKILL.md",
      "exists": true,
      "files": [
        "client/src/app/skills/helpers.ts"
      ]
    },
    "react-best-practices": {
      "path": ".claude/skills/react-best-practices/SKILL.md",
      "exists": true,
      "files": [
        "client/src/app/skills/helpers.ts"
      ]
    },
    "typescript-expert": {
      "path": ".claude/skills/typescript-expert/SKILL.md",
      "exists": true,
      "files": [
        "client/src/app/skills/helpers.ts",
        "server/src/modules/skills/helpers.ts"
      ]
    },
    "next-best-practices": {
      "path": ".claude/skills/next-best-practices/SKILL.md",
      "exists": true,
      "files": [
        "client/src/app/skills/helpers.ts"
      ]
    },
    "onion-architecture": {
      "path": ".claude/skills/onion-architecture/SKILL.md",
      "exists": true,
      "files": [
        "server/src/modules/skills/helpers.ts"
      ]
    }
  },
  "checks": [
    {
      "package": "client",
      "cwd": "client",
      "commands": [
        "pnpm typecheck",
        "pnpm lint",
        "pnpm test"
      ]
    },
    {
      "package": "server",
      "cwd": "server",
      "commands": [
        "pnpm typecheck",
        "pnpm exec vitest run --exclude '**/*.it.test.ts'"
      ]
    }
  ],
  "warnings": []
}
$ grep -n "disable-model-invocation\|type: workflow" .claude/skills/pr-self-review/SKILL.md
4:disable-model-invocation: true
7:  type: workflow
$ ls "$(git rev-parse --git-common-dir)/hooks" | grep -v sample || echo "no active git hooks"
no active git hooks
```
The headless session that Reads the routed skills could not run on 2026-10-25: the WSL Claude Code CLI reported "OAuth session expired and could not be refreshed". Open issue for row 21.
