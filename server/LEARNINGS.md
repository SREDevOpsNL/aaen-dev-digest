# Learnings — server

API and persistence guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Repo-intel remains server-scoped;
`*/src/vendor/shared/**` belongs in [`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-17** — Persisted `jobs` rows do not make the queue recoverable. The
  table exists and rows are written, but execution is an in-process `p-queue`: a
  restart loses every queued job and leaves its row behind. Do not design on the
  assumption that a job survives a crash. Evidence:
  `server/src/db/schema/ops.ts:6` (`jobs`),
  `server/src/platform/jobs.ts:30` (`JobRunner`)

## Codebase Patterns & Tool / Library Notes

- **2026-09-17** — `run-executor` fills only three of `assemblePrompt`'s optional
  slots — `callers`, `repoMap` and `prDescription`. `skills`, `memory` and `specs`
  are always null and the corresponding prompt sections are never emitted, so the
  trace showing them empty is correct, not a rendering bug. Evidence:
  `server/src/modules/reviews/run-executor.ts:198-205`
  (`ReviewRunExecutor.runOneAgent`),
  `server/src/modules/reviews/run-executor.ts:425`
  (`ReviewRunExecutor.traceFromBuffer`)

- **2026-09-18** — Drizzle's migrator (`drizzle-orm` 0.38.4) runs a
  `meta/_journal.json` entry only if its `when` is newer than the latest
  `created_at` in `drizzle.__drizzle_migrations`. It never compares the stored
  `hash`, and never reads a `.sql` the journal does
  not list. So an edit to an applied migration reaches only DBs that have not
  run it yet, and an entry older than a DB's latest (restored or merged from
  another branch) is silently skipped there — apply its DDL by hand. Evidence:
  `server/src/db/migrate.ts:30` (`runMigrations`); `migrate()` in
  `drizzle-orm/pg-core/dialect.js`; commit `2006964`.

- **2026-09-23** — Correction to the 2026-09-17 prompt-slot entry: the studio
  executor now resolves an agent's enabled linked skills in link order and
  passes them to `reviewer-core`; only memory and project specs remain unused
  optional slots. Preserve the workspace/effective-enabled filter when changing
  prompt inputs. Evidence: `server/src/modules/reviews/run-executor.ts:190`
  (`ReviewRunExecutor.runOneAgent`),
  `server/src/modules/agents/repository.ts:208`
  (`AgentsRepository.enabledSkillsForPrompt`).

- **2026-10-13** — `RunBus.isCancelled()` is not a reliable cancellation signal
  after any await: `cancelRun` calls `runBus.complete()` right after
  signalling, and `complete()` clears the flag. Check the durable
  `agent_runs.status = 'cancelled'` instead, and keep terminal writes
  compare-and-set from `running`. The persisted trace is built from the bus
  buffer (`RunLogger.logFor`), so events published after `complete()` must
  still be buffered even though they are no longer emitted. Evidence:
  `server/src/platform/sse.ts` (`RunBus.complete`, `RunBus.publish`),
  `server/src/platform/run-logger.ts:94` (`RunLogger.logFor`),
  `server/test/run-lifecycle.it.test.ts`.

- **2026-10-19** — `new MockGitClient()` returns a canned one-file diff
  (`src/config.ts` with a fake `sk_live_` key) from `diff()`, so in a test
  `loadDiff` takes it and never reaches the `pr_files` fallback: a test that
  means to review a seeded PR's stored patches silently reviews that canned
  diff instead. Pass `new MockGitClient({ diff: '' })` (no files → fallback)
  when the stored patches are what is under test. Evidence:
  `server/src/adapters/mocks.ts:284` (`MockGitClient.diff`),
  `server/src/modules/reviews/diff-loader.ts` (`loadDiff`); every slot in
  `server/test/experiments.it.test.ts` was refused for a diff-hash mismatch
  until the test used the empty diff.

- **2026-10-19** — Intent derivation resolves its own provider: the
  `review_intent` feature model defaults to **openai**, while the seeded
  reviewers use openrouter. A test that injects only an openrouter provider
  and asserts "no provider call" around an intent path passes without the
  intent call ever reaching `container.llm` (it stops at `skipped_no_key`). In
  PR #22 the experiment-mode intent guard test was vacuous until it injected
  an openai provider; a mutation that disabled the guard proved it. Inject the
  provider the path actually resolves (`resolveFeatureModel`), and confirm a
  "nothing was called" test with a mutation. Evidence:
  `server/src/vendor/shared/contracts/platform.ts` (`FEATURE_MODELS`,
  `review_intent.defaultProvider`), `server/src/modules/intent/service.ts`
  (`runDerivation`), `server/test/experiments.it.test.ts` (intent refusal).

- **2026-10-19** — `LocalSecretsProvider` reads its key file once per process
  and keeps the result, including an empty result when the file is missing or
  is not valid JSON. A key written after the API started is therefore invisible
  until a restart: an experiment stack started before its
  `~/.devdigest/hw2-experiments/secrets.json` existed reports
  `openrouter_key_configured: false`. Deleting the file does not remove a key
  from a running server either. Create the key file before starting the server,
  and to revoke a key, restart the server or revoke the key at the provider.
  Nothing checks the file's mode. Evidence:
  `server/src/adapters/secrets/local.ts:25,33` (`LocalSecretsProvider.load`),
  `server/src/platform/container.ts:87` (one provider per container).

- **2026-10-20** — In a single-table Drizzle select, column references inside
  a `sql` template are rendered **unqualified** (`"id"`, `"workspace_id"`).
  Inside a correlated subquery they then bind to the subquery's own tables, not
  to the outer row. The first linked-skill count for `GET /agents` rendered
  `… on "id" = "skill_id" and "workspace_id" = "workspace_id" where "agent_id" =
  "id"`, typechecked, and returned 0 for every agent. Build the subquery with
  the query builder (a joined select qualifies its own columns) and qualify the
  outer columns explicitly with
  `` sql`${table}.${sql.identifier(column.name)}` ``. Print the SQL with
  `new QueryBuilder()…toSQL()` to check it. Evidence:
  `server/src/modules/agents/repository.ts` (`AgentsRepository.list`),
  `server/test/agent-skill-count.it.test.ts` (four count tests failed on the
  unqualified version).

- **2026-10-20** — Two facts about the HW2 experiment runner bind a
  confirmatory run to one disposable stack.
  - **The manifest freezes `stack.database`,** and `scripts/e2e.sh --serve`
    creates a new `devdigest_hw2f_<nonce>` on every start. A manifest
    generated before a restart, or on another stack, can never match the one
    `run` recomputes, so `run` refuses (zero cost). Generate the manifest,
    commit the preregistration and run, all on one stack that is never
    restarted. A preregistration-only commit is safe: the implementation
    fingerprint ignores it.
  - **Spend accounting is per stack.** The server's budget is recomputed from
    that stack's database, and the runner's ledger lives in a per-stack
    directory. A replacement stack therefore starts from zero recorded spend.
    After a crash, settle the old ledgers offline with `charge()` and keep any
    new `authorize --budget` within the remainder.

  Evidence: `server/src/experiments/hw2/cli.ts` (`currentManifest`: `stack:
  { database: identity.database, … }`, and the `run` comparison
  `manifestFingerprint(current) !== manifestFingerprint(frozen)`),
  `scripts/e2e.sh` (`NONCE` → `PG_DB`),
  `server/src/experiments/hw2/budget.ts` (`charge`, `spent`),
  `server/test/hw2-manifest-identity.test.ts`.

- **2026-10-20** — "One `kind = 'review'` row per agent run" is a convention of
  the code, not a guarantee in the schema. Today `ReviewRunExecutor.runOneAgent` inserts
  exactly one review per run, and `runReview` creates a fresh run per agent per
  request. But `reviews.run_id` has no unique constraint and no foreign key, so
  any per-run aggregate read through `reviews` (such as PR-list cost) must
  deduplicate by run id. Otherwise it is counted once per review row. Evidence:
  `server/src/db/schema/reviews.ts:19` (`runId`),
  `server/src/db/migrations/0008_striped_lady_deathstrike.sql:1`,
  `server/src/modules/reviews/run-executor.ts:219` (single `insertReview`),
  `server/src/modules/pulls/routes.ts:176` (distinct-run guard), and
  `server/test/reviews.it.test.ts` ("counts a run's cost once…"), which fails
  against the earlier per-row sum (0.09 instead of 0.05).

## Decisions

## Recurring Errors & Fixes

- **2026-09-21** — On Windows, `tsx src/db/migrate.ts` and
  `tsx src/db/seed.ts` can exit successfully without running because their CLI
  guards compare the canonical `import.meta.url` (`file:///D:/...`) with a
  non-canonical `file://${process.argv[1]}` value (`file://D:\\...`). Normalize
  `process.argv[1]` with `pathToFileURL(resolve(...)).href` before relying on
  these scripts on Windows; until then, invoke the exported functions
  explicitly. Evidence: `server/src/db/migrate.ts:37` and
  `server/src/db/seed.ts:227` (CLI entrypoint guards); the same path comparison
  evaluated to `false` on Windows while explicit imports applied migrations and
  seed data.

- **2026-09-21** — Scope correction to the preceding Windows CLI-entrypoint
  entry: Windows is not a supported project-development environment for this
  checkout. Run database scripts and all other project tooling in Ubuntu 24.04
  WSL2; do not install Node or related development tools on the Windows host.
  Evidence: `pnpm db:migrate` and `pnpm db:seed` both executed their CLI paths
  successfully during `npm run e2e:hermetic` in WSL, followed by 7/7 passing
  browser flows.

- **2026-09-25** — When Drizzle replaces a boolean scaffold column with several
  semantically related columns, its interactive rename inference can generate a
  syntactically valid migration that drops the old value after adding defaults.
  Choose “create column” for each new field, then add an explicit data-copy
  statement before the generated drop; for conventions this preserves
  `accepted = true` as `status = 'accepted'`. Evidence:
  `server/src/db/migrations/0011_add_convention_evidence.sql:7` (status backfill).

- **2026-10-14** — In tests, `waitForPrRuns` does not mean the executor has
  finished for a run cancelled through the API: `cancelRun` writes `cancelled`
  immediately, so the poll returns while the executor is still in its catch
  path. Assertions such as "no review persisted" can then pass vacuously, and
  trace assertions fail intermittently. Wait for the run's trace (the
  executor's last step) with `vi.waitFor` before asserting. Evidence:
  `server/test/run-lifecycle.it.test.ts` failed once (`expected undefined to
  be defined` on the trace), then passed in 5 of 5 runs after the fix.

- **2026-10-14** — Extension of the 2026-10-14 `waitForPrRuns` entry: the
  race is not limited to API-cancelled runs. A successful run's status also
  commits (in its finalize transaction) before its trace is saved, so any test
  that reads `/runs/:id/trace` right after `waitForPrRuns` can get a 404. Call
  `waitForRunTrace(db, runId)` first. Evidence: `server/test/helpers/runs.ts`
  (`waitForRunTrace`); `reviews.it.test.ts` "runs a review: map-reduce …"
  failed in CI with `Cannot read properties of undefined (reading 'model')`.

- **2026-10-14** — The git adapter finds a clone at
  `<cloneDir>/<owner>/<name>`, computed at runtime. It never reads the stored
  `repos.clone_path`, which is only a presence check. A relative
  `DEVDIGEST_CLONE_DIR` (the `.env.example` value is `./clones`) resolves
  against the API process's working directory, so clones belong to the
  worktree they were imported from. **Reproduction:** several worktrees share
  one dev database; a repo is imported while the API runs from worktree A;
  the API is later started from worktree B. B then looks under its own
  `server/clones/`, finds nothing, and:
  - Conventions extraction fails with `422 Nothing to sample — clone and index
    the repository before running the scan`, although `/index-state` reports
    `full`.
  - Review and intent diffs silently fall back to the stored `pr_files`
    patches (`loadDiff`).

  **Fix:** set `DEVDIGEST_CLONE_DIR` to the same absolute path in every
  worktree's `server/.env`. Recloning is not automatically required:
  - **Reuse existing clones:** point it at the directory that already holds
    `<owner>/<name>` (here the absolute path of the importing worktree's
    `server/clones`). That is how the smoke test below recovered. Such a root
    disappears if that worktree is removed.
  - **Root independent of any worktree**, for example
    `/home/<user>/.devdigest/workspace` (the default when the variable is
    unset): repos must then be cloned or moved there.

  Evidence:
  `server/src/platform/config.ts:66-68` (`cloneDir` resolved against
  `process.cwd()`), `server/src/adapters/git/simple-git.ts:37-38`
  (`clonePathFor`), `server/src/adapters/git/simple-git.ts:129-130`
  (`readFile`), `server/src/modules/repo-intel/service.ts:146`
  (`clonePath` as presence check), `server/src/modules/conventions/service.ts:63-66`,
  `server/src/modules/reviews/diff-loader.ts:19-29`. Observed on the dev
  database: the API from `main` returned the 422 for a repo cloned from the
  `l01-feature` worktree, and extracted 9 candidates once
  `DEVDIGEST_CLONE_DIR` pointed to that worktree's `server/clones`.

## Session Notes

## Open Questions
