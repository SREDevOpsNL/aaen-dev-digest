# Test results

Baseline run on 2026-10-25 at commit `d07e4fe` of
`homework/l02-mentor-submission`. The table below records that baseline, not a
fresh run at the current head. Later commits changed source and tests; use the
PR checks and dated experiment evidence for their subsequent verification.

**Environment:** Ubuntu 24.04.5 LTS on WSL2 (kernel 6.18.33.2), Node v22.23.2,
pnpm 10.34.5, npm 10.9.8, Docker 29.8.1, agent-browser 0.27.0.

Server tests run with an unreachable `DATABASE_URL`, an empty sandboxed `HOME`
and no API keys. Server tests also isolate themselves (`test/setup/isolate-database.ts`).
DB-backed tests use disposable testcontainers Postgres. The browser flows run
on a disposable stack (`scripts/e2e.sh`). No test reaches the development
database or makes a model call.

| Check | Command (in WSL) | Result |
| --- | --- | --- |
| Agent instructions | `node scripts/verify-agent-instructions.mjs` | all checks pass |
| `pr-self-review` router | `node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs` | 10 / 10 |
| reviewer-core types | `cd reviewer-core && npm run typecheck` | pass |
| reviewer-core tests | `cd reviewer-core && npm test` | 102 / 102 (8 files) |
| server types | `cd server && pnpm typecheck` | pass |
| server unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | 337 / 337 (35 files) |
| server DB-backed | `cd server && pnpm exec vitest run .it.test` | 139 / 139 (17 files) |
| client types | `cd client && pnpm typecheck` | pass |
| client lint | `cd client && pnpm lint` | pass |
| client tests | `cd client && pnpm test` | 115 / 115 (29 files) |
| e2e types | `cd e2e && npm run typecheck` | pass |
| e2e browser flows | `cd e2e && npm run e2e:hermetic` | 14 / 14 flows |
| Schema drift | `cd server && pnpm db:generate` | "No schema changes"; the journal ends at `0012_outstanding_roxanne_simpson` |
| L03 audit | whole tree: no L03 paths, no L03 symbol above the L01 baseline's counts, no intent imports, no L03 columns in the 0012 snapshot | pass |
| Secret scan | added lines of `5a3b496..HEAD` checked for OpenRouter, Anthropic, OpenAI and GitHub key patterns | clean |

## Notable tests added on this branch

- **Run lifecycle** (`run-lifecycle.it.test.ts`): a cancel after the last
  checkpoint, and a late provider success after a cancel. Removing the
  compare-and-set guard makes them fail.
- **Migrations** (`migration-0011-upgrade.it.test.ts`): a 0010 database with
  conventions upgrades through 0011 (`accepted` → `status`, data kept,
  constraints, hashes, journal order, idempotence), and a pre-0012 link stays
  enabled.
- **Per-agent switch** (`agent-skill-enabled.it.test.ts`, `SkillsTab.test.tsx`):
  the switch's scope, prompt exclusion, order, 4-skill limit and 404/422.
  Mutations of the prompt filter and the drag rule make them fail.
- **Run Review dispatch** (`experiments.it.test.ts`): an armed slot is clicked
  once; a wrong agent, a disarm, an expiry and a revoked capability are all
  refused.
- **Runner** (`hw2-runner-run-review.test.ts`, `hw2-crash-recovery.test.ts`,
  `hw2-key-usage.test.ts`):
  - Run Review mode;
  - crash recovery with real processes killed by SIGKILL;
  - key-usage settlement.

## CI

GitHub Actions runs the same suites on every push to PR #53. The latest
results are in the PR's Checks tab and summarized in the PR description.


## Isolated unpaid checkpoint, 2026-10-27

Run from the separate `aaen-dev-digest-l02-extraction` WSL checkout; the
PR #53 checkout and the previously running evidence stack were unchanged.

| Check | Result |
| --- | --- |
| Server typecheck | passed |
| Full server suite (unit and DB-backed, Testcontainers) | **494 / 494**, 54 files |
| Focused extraction authorization and spend-gate tests | **17 / 17** |
| reviewer-core typecheck and tests | passed, **102 / 102** |
| E2E typecheck | passed |
| Hermetic browser suite on separate ports 5440/3201/3200 | **14 / 14 flows**, exit 0 |
| Staged `git diff --check` | passed |

The free conventions preflight is documented in
[CONVENTIONS-EXTRACTION-PREFLIGHT.md](CONVENTIONS-EXTRACTION-PREFLIGHT.md).
It performed no model generation and issued no capability. A no-capability
extraction request was refused with HTTP 403 before any receipt or provider
call. Criterion 21 still needs a real Claude Code session; criteria 17, 18,
38 and 40 still need separately approved evidence.

## Final unpaid extraction preflight, 2026-10-27

The conventions-only API restart and fresh Fastify preflight are recorded in
[CONVENTIONS-EXTRACTION-PREFLIGHT.md](CONVENTIONS-EXTRACTION-PREFLIGHT.md).
After the sample-path preview and private raw-response receipt changes,
server typecheck and focused authorization/spend-gate tests passed (17/17); `bash -n scripts/e2e.sh`
passed. The previous full suite and 14/14 hermetic flows remain the last
broad local runs; GitHub Actions on the new head provide the subsequent
package and browser gates. No extraction model call was made.
