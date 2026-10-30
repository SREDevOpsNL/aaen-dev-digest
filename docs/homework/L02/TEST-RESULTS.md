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

## Full unpaid verification at security checkpoint `17241a3` (2026-10-27)

All commands ran in a detached Ubuntu WSL worktree at
`/home/dmitri/projects/aaen-dev-digest-l02-verify-17241a3`. Its hermetic
browser build used ports 5440/3201/3200 and did not alter either live
evidence stack. No model-generation call was made.

| Check | Result |
| --- | --- |
| Focused extraction/experiment safety tests | 148 / 148 passed |
| reviewer-core typecheck and tests | passed; 102 / 102 |
| server typecheck and unit tests | passed; 367 / 367 |
| server DB-backed tests, including migration upgrade | passed; 140 / 140 |
| client lint, typecheck and tests | passed; 118 / 118 |
| e2e typecheck and hermetic browser flows | passed; 14 / 14, exit 0 |
| Agent-instructions checker and self-review router tests | passed; router 10 / 10 |
| Schema drift | `pnpm db:generate`: no schema changes |
| L03 changed-path audit against required L01 base | no added L03 paths |
| Added-line credential-pattern scan | two synthetic key-shaped test literals; neither equals the dedicated private key |
| `git diff --check` and worktree status | pass; clean at `17241a3` |

The new report labels regex matches as provisional screening. No
confirmatory outcome is claimed. The refreshed free extraction preview and
API-only restart are in
[CONVENTIONS-EXTRACTION-PREFLIGHT.md](CONVENTIONS-EXTRACTION-PREFLIGHT.md).

## Live extraction evidence checkpoint (2026-10-27)

At source `e2e5671`, all six GitHub Actions workflows passed. The previously
reported isolated local suites remain the last full local test run.
One separately authorized live conventions extraction then completed via
the guarded application endpoint. Its single attempt, actual provider,
parsed model response, grounded candidate, API/SQL read-back after API-only
restart, $0.00265410 ledger cost, successful key-usage settlement and
capability revocation are recorded in
[conventions-live-extraction.md](evidence/conventions-live-extraction.md).
This runtime evidence verifies criteria 38 and 40; it is not a new
test-suite run and did not alter experiments 17 or 18.

## Unpaid fixture/protocol checkpoint (2026-10-28)

Starting from source `e79ae2b`, the two seeded experiment fixtures
received executable ground-truth checks in `server/test/hw2-fixture-ground-truth.test.ts`: coupon
before/at/after expiry and unknown-code behavior; payment URL matching and
ID-to-reference lookup change. Focused tests passed **2 / 2**. Server typecheck passed; full server unit
tests passed **369 / 369** and DB-backed tests passed **140 / 140**.
Reviewer-core typecheck and tests passed **102 / 102**; client lint,
typecheck and tests passed **118 / 118**; E2E typecheck and hermetic
browser flows passed **14 / 14**, exit 0, from the separate extraction
checkout on ports 5440/3201/3200 with a disposable container. These are
fixture checks, not a model comparison. The prospective study now records a
condition-blinded adjudication and seal procedure and a provisional
post-extraction ledger ceiling of $0.11381699. No confirmatory capability
was issued and no model generation occurred.

## Unpaid adjudication checkpoint (2026-10-30)

From source `4d82c6f`, where all six GitHub Actions workflows had passed.
The sealed condition-blinded adjudication procedure in
[PROSPECTIVE-STUDY.md](PROSPECTIVE-STUDY.md#condition-blinded-technical-adjudication)
gained an implementation (`server/src/experiments/hw2/adjudication.ts`) and
a synthetic dry run (`server/test/hw2-adjudication.test.ts`, 9 / 9). Mutating
the seal check, the ambiguity rule or the scheduled-slot gap check makes a
test fail. Server typecheck passed; hermetic server unit tests passed
**378 / 378** (38 files) with an empty sandboxed `HOME` and an unreachable
`DATABASE_URL`. Only server code changed, so the DB-backed, client,
reviewer-core and browser suites were not rerun locally; GitHub Actions on
the new head provides those gates. No capability was issued and no model
generation occurred.

## Criterion 14 system-role placement and approval gate (2026-10-30)

From the implementation commit `23d0b48`, in the separate
`aaen-dev-digest-l02-extraction` checkout:

| Check | Result |
| --- | --- |
| reviewer-core typecheck and tests | pass; **117 / 117** |
| server typecheck | pass |
| server hermetic unit tests (empty `HOME`, unreachable `DATABASE_URL`) | **398 / 398**, 41 files |
| server DB-backed tests (Testcontainers) | **172 / 172**, 20 files, when run alone. One full run while a browser suite and a stack were also running failed two timing-sensitive cases in `experiments.it.test.ts`; that file then passed 32 / 32 twice on its own |
| Schema drift | `pnpm db:generate`: no schema changes after `0013_clammy_hellion` |
| client lint, typecheck, tests | pass; **129 / 129** |
| e2e typecheck and hermetic browser flows | **14 / 14**, exit 0 (run alone) |
| Agent-instruction checker; self-review router | pass; 10 / 10 |
| Fixture ground truth (#501, #502) | 2 / 2 |
| Adjudication module and CLI | 11 + 7 tests |

Mutation checks: moving Skills back to the user message fails 9 reviewer-core
and 8 server regression tests; removing the fail-closed gate fails 7; dropping
the digest comparison fails 2; removing the adjudication seal check, ambiguity
rule or scheduled-slot gap check each fails a test.

The browser suite first failed flow 11: a new approval badge widened every
Skills card past its grid column, so a pointer click on Delete hit the next
card. The footer now wraps. Running the hermetic suite and an `--serve` stack
from the same worktree at once also failed two flows, because both `next dev`
processes share `client/.next`; run them one after the other.
