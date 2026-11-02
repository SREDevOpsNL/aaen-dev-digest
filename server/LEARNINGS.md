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

- **2026-10-24** — The API's global rate limit (120 requests per minute per
  client) is off whenever `nodeEnv` is `test`, so no unit or DB-backed test
  can show a client tripping it. A real experiment stack runs in development
  mode. There, the X3 checks (about 17 calls each), the previews and the
  runner's 1/s polls reached 166 calls in 60 s:
  - 46 runner polls got 429;
  - in one run the pre-dispatch check got 429 and the lifecycle aborted.

  Every 429 failed closed. Exercise a client of this API end to end against a
  stack in development mode, not only through `inject()` under test. On an
  experiment stack, loopback is now exempt. Evidence: `server/src/app.ts`
  (`rateLimit` registration), `server/test/experiment-rate-limit.test.ts`, and
  the simulation logs in `~/.devdigest/hw2-experiments/integration-20261024b/sim/`.

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

- **2026-10-24** — A substring check on `prompt_assembly.user` can pass for
  the wrong reason. On `main`, `seed.it.test.ts` asserted that a fixture PR
  was "reviewed from the stored patch" because the prompt contained
  `src/api/payments.ts`, but the test's `MockGitClient()` returned its default
  `src/config.ts` diff, so the loader never fell back to `pr_files`; the path
  appeared only in the L03 intent block. On the L02 branch, which has no intent
  layer, the same assertion failed. Make the mock behave like the real case
  (`MockGitClient({ diff: '' })`: an uncloned repository yields no files) and
  assert on content that only the intended source can supply, plus the absence
  of the decoy. Evidence: `server/src/modules/reviews/diff-loader.ts`
  (`loadDiff` falls back only when `diff.files.length === 0`),
  `server/src/adapters/mocks.ts` (`MockGitClient.diff` default),
  `server/test/seed.it.test.ts` (fixture review case).

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

- **2026-10-21** — A fake API that makes up its own hash can only show that
  a value exists, not that it is right. The HW2 runner's `FakePreviewApi`
  returned `sha256(canonicalJson(skill ids))` as the Skill fingerprint, while
  the server hashes the skills' prompt blocks (`toSkillPromptBlock`). So
  `conditionPreview` could only check "non-empty for `with`, empty for
  `without`", and a preview carrying the wrong skill would have passed Phase 0.
  Have the fake use the production formula. Recompute the expected value in
  the code under test from the real input (here the target skill's current
  body). Add one DB-backed assertion that the real server produces exactly
  that value, so fake and server cannot drift apart. Evidence:
  `server/src/experiments/hw2/cli.ts` (`expectedSkillFingerprint`,
  `phase0Problems`), `server/test/hw2-runner.test.ts` (the "wrong-skill" mode;
  disabling the check fails 5 tests), and `server/test/experiments.it.test.ts`
  ("a preview reflects the linked skills").

- **2026-10-22** — Extension of the 2026-10-20 "Spend accounting is per stack"
  entry above: when several stacks' ledgers are settled together, key each slot
  by `(stack_id, slot_id)`, never by `slot_id` alone. Slot ids are local to a
  stack: X and X2 both had an `x-18-without-1`. Under a fold keyed by slot id,
  "first terminal state wins" makes one stack's slot hide the other's, so the
  total silently depends on the order of the ledgers. The operator guide's
  offline settlement example did this. On the real X and X2 ledgers it charged
  $0.020229 or $0.010408, depending on the order, instead of $0.02040788. Both
  results are too low, which overstates the remaining budget.
  - Fix: take the stack id from the ledger's directory name.
  - Check the corrected block against the runner's own fold as an oracle: one
    `Ledger(dir).slots()` per stack, then `spent()`.

  Evidence: `docs/plans/HW2-experiment-operator-guide.md` on `main` ("If stack E stops
  unexpectedly", step 3), `server/src/experiments/hw2/ledger.ts`
  (`Ledger.slots`), and a hermetic check of 23 assertions over every ledger
  order. It ran on synthetic ledgers and on read-only copies of the real ones,
  outside the repository, in
  `~/.devdigest/hw2-experiments/settlement-audit-20261022T2215Z/`.

- **2026-10-22** — With OpenRouter as it behaved in HW2 Gate 3, the experiment
  eligibility rule cannot prove a single upstream attempt. `evaluateSlot`
  accepts one of two proofs:
  - router metadata with both `attempt` and `attemptsCount` equal to 1. But
    `attemptsCount` is `raw.attempts.length`, and OpenRouter's
    `openrouter_metadata` had `attempt: 1` and no `attempts` array in both
    completed slots;
  - a found generation record with one provider response. But the in-run
    lookup is fixed at 5 tries 1 s apart, about a 4 s window, while the record
    appeared 29–38 s after completion (see the 2026-10-21 lag entry in
    `reviewer-core/LEARNINGS.md`).

  So both completed Gate 3 slots evaluate as `unverified`, not counted, and a
  Gate 4 run under these conditions would be `incomplete` whatever it
  detects. The report reads the stored experiment block and does not look the
  generation up again.

  Before relying on a provenance rule, run it on a real completed slot. A
  passing fixture only shows that the rule accepts the fields it expects, not
  that the provider sends them.

  Evidence: `server/src/experiments/hw2/eligibility.ts` (`singleAttemptProven`),
  `reviewer-core/src/llm/openrouter-metadata.ts:39` (`attemptsCount`),
  `server/src/platform/config.ts:140` (`generationLookup`), and the
  `routerMetadataRaw` of the exported Gate 3 traces.

- **2026-10-23** — Extension of the eligibility entry above: the blocker had a
  second cause, which showed only when the rule ran on the generation records
  that Gate 3 read 29–38 s after each response. Even a found record was
  rejected. Eligibility compared the record's `model` with the *requested*
  slug, but OpenRouter's records name the dated served version:
  - the generation `model`, the router's selected model, and each provider
    response's `model_permaslug` were all `deepseek/deepseek-v4-flash-20260423`;
  - the chat response's `model` echoes `deepseek/deepseek-v4-flash`.

  That mismatch also blocked the single-attempt proof, so lengthening the
  lookup alone would not have unblocked Gate 4.

  The unit fixtures had hidden both causes. They were invented, not observed:
  - router metadata with `attempts: [{}]`;
  - a generation `model` equal to the requested slug.

  Build provenance fixtures from a real record's shape, and apply a new
  eligibility rule to preserved real records before trusting it.

  Evidence: `server/test/hw2-generation-lookup.test.ts` (Gate 3 shapes),
  `server/test/hw2-runner.test.ts` (fixtures corrected),
  `server/src/experiments/hw2/eligibility.ts` (`servedModel`), and the sealed
  records in `~/.devdigest/hw2-experiments/hw2f-f53ed971/gate3-slot1/` and
  `hw2f-39febf41/gate3-x-18-without-1/`.

- **2026-10-23** — Node's built-in `fetch` without a `signal` is not
  unbounded, but its only limit is undici's 300 s headers timeout. The HW2
  runner's stack client passed no signal. Against a loopback server that
  accepts and never answers, it gave up after 300.9 s (`TypeError: fetch
  failed`, cause `UND_ERR_HEADERS_TIMEOUT`).

  A deadline checked only between requests, as in `runSlot`'s poll loop,
  therefore holds only if every request is bounded below the deadline's
  margin. Give each request its own `AbortSignal.timeout`; it covers the body
  too. Evidence: `server/src/experiments/hw2/api.ts`
  (`API_REQUEST_TIMEOUT_MS`), `server/test/hw2-api-timeout.test.ts`, which
  fails when the signal is removed.

- **2026-10-30** — A Fastify route whose Zod `body` schema is
  `.optional()` still answers `422` when the request has no body;
  `.nullish()` accepts it. `DELETE /skills/:id/approval`
  (reason optional) failed for a body-less `inject` until the schema
  became `.nullish()`. Use `.nullish()`
  for an optional body and test the body-less request. Evidence:
  `server/src/modules/skills/routes.ts` (`SkillRevokeRequest.nullish()`),
  `server/test/skill-approval.it.test.ts` (revoke without a reason).

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

- **2026-10-23** — The server's "hermetic" unit tests could write to the
  development database.
  - **Mechanism:** `buildApp` without an injected `db` connects to
    `config.databaseUrl` and runs the stale-run reaper before listening
    (`UPDATE agent_runs SET status = 'failed' WHERE status = 'running'`).
    `routes-smoke.test.ts` booted the app five times with
    `loadConfig(process.env)`. `import 'dotenv/config'` filled `DATABASE_URL`
    from `server/.env` (the dev database, `localhost:5432`). A worktree without
    `.env` falls back to the default URL, which is that same database. CI sets
    no `DATABASE_URL`, so it never showed there.
  - **Proof:** a decoy listener named as the dev database got a connection from
    the unit suite on `main` (`d4c1be5`), and none with the fix.
  - **Fix:** `test/setup/isolate-database.ts` (vitest `setupFiles`) points
    dotenv at `/dev/null` and `DATABASE_URL` at a closed, disposable endpoint.
    `buildApp` calls `assertTestDatabaseIsolated`: in a test run (`NODE_ENV=test`,
    or `VITEST` set), without an injected `db`, it refuses any non-disposable
    database name before connecting.
  - **Testing a guard like this:** check its refusal with a pure call, or
    against a decoy that stops listening after the first connection. Never use
    the real default URL, which a regressed guard would connect to. A decoy
    that only drops connections made the postgres client retry until the test
    timed out.

  Evidence: `server/src/db/disposable.ts` (`assertTestDatabaseIsolated`),
  `server/src/app.ts`, `server/test/test-database-isolation.test.ts`.

- **2026-10-23** — Extension of the entry above: a disposable *name* is not
  provenance. The first guard accepted any URL whose database was called
  `devdigest_test`, so a test naming that database on the developer's server
  would still have reached it. It accepted an injected `db` unchecked, too.
  Now:
  - without an injected `db`, only the exact closed test URL;
  - with one, a read-only check that `current_database()` is disposable and
    has a marker table, which only the testcontainers helper creates, before
    anything writes;
  - an unmarked `devdigest_e2e` on the same throwaway server is refused, and
    its `running` row is left alone.

  The same tests also loaded the real HW2 experiment key into memory.
  `/experiments/identity` reads the dedicated key file, and other paths read
  `~/.devdigest/secrets.json` plus shell variables. In a test run, secrets now
  come from an empty test-owned file and key variables are removed. Six
  mutations each fail a test.

  Evidence: `server/src/db/disposable.ts` (`assertInjectedTestDatabase`,
  `DISPOSABLE_MARKER_TABLE`), `server/test/test-database-provenance.it.test.ts`,
  and a whole-suite run with a `.env` naming a decoy `devdigest_test` server
  plus fake keys (0 connections).

- **2026-10-20** — On this WSL2 host, `git status` and `git add` can miss a
  rewrite that keeps the file's size. Two facts combine:
  - **The stat cache counts whole seconds.** The installed git 2.55 compares
    mtime and ctime only to the second, and trusts an entry's cached stat
    once the index is newer than the file.
  - **The wall clock is not monotonic.** About every 5.5 s it jumps ahead
    ~5.9 s, then back ~6.4 s some 12–16 ms later. dmesg shows thousands of
    journald `Time jumped backwards` lines.

  So an index written inside that window looks newer than a same-size
  rewrite made in the same second after the jump back. The rewrite then looks
  clean. This was the flake in `hw2-source.test.ts` ("a committed
  implementation change…"): its helper's `git add -A` staged nothing, and
  `git commit` threw `nothing to commit`. A replay of that sequence failed in
  23–32 of 18,000 iterations. It also let the experiment guards accept
  uncommitted same-size edits. Do not trust `git status` alone where a
  guarantee is needed: re-hash the committed files against HEAD
  (`ls-tree -z` + `hash-object --stdin-paths`). In a test, stage by content
  with `git read-tree --empty` before `git add -A`. Do not use sleeps or
  retries. Evidence: `server/src/experiments/hw2/source.ts:37`
  (`uncommittedChanges`), `server/test/hw2-source.test.ts:20` (`commit`), and
  `server/test/hw2-source.test.ts:75`, which fails on the status-only guard.
  After the fix, the replay showed 0 commit failures and 0 guard misses in
  18,000 iterations. A shim that dates every index write into the window
  failed the old test file in 24 of 30 runs and the fixed one in 0 of 30.

- **2026-10-27** — Paid authorization and confirmatory resume must make
  safety decisions durable across process death; see the two dated
  [Engineering Insights](INSIGHTS.md#recurring-errors--fixes). Evidence:
  `server/src/experiments/hw2/conventions-runner.ts:222`
  (`authorizeExtraction`).

- **2026-10-30** — A test on exactly five scheduled slots per condition cannot
  catch a broken "no replacement" guard in an HW2 outcome function:
  `experimentOutcome` in `rules.ts` already returns `incomplete` below five
  counted trials, so a missing slot looks handled even when the gap check is
  gone. Mutating the adjudication reveal's gap check to `false` left all eight
  original tests green. Test the gap with more than five scheduled slots and
  exactly five survivors. Evidence: `server/src/experiments/hw2/rules.ts`
  (`experimentOutcome`), `server/test/hw2-adjudication.test.ts` ("five
  surviving slots do not stand in for a larger schedule with a gap").

- **2026-10-31** — An HW2 pre-registration does not outlive its stack. The
  frozen manifest includes `stack.database`
  (`server/src/experiments/hw2/manifest.ts:22`), and `run --phase
  confirmatory` compares the whole manifest fingerprint. The
  `scripts/e2e.sh --serve` stack is disposable: an `--rm` container started
  from tmux. A host restart therefore removes the database the freeze names,
  and confirmatory runs refuse on every rebuilt stack. That is what happened
  on 2026-10-31: `hw2f-1fe1aeec` was gone after an 11:03 restart. A rebuild
  from the same commit gave a manifest that differed only in
  `stack.database`. Before a paid confirmatory session, check `uptime -s`
  and that the named database exists. A rebuilt stack needs a re-freeze and a
  fresh approval; never edit the frozen manifest. Evidence:
  `docs/homework/L02/prereg/manifest-20261030.json` versus
  `manifest-20261031.json`.

- **2026-10-31** — Two HW2 freeze defects surfaced only in a pre-dispatch
  binding check. Neither shows up in tests:
  (1) `run --phase confirmatory --prereg` reads only a committed file with a
  ```json manifest` block (`preregisteredManifest`,
  `server/src/experiments/hw2/source.ts:71`), but `cli.ts manifest --out`
  writes bare JSON. The committed `prereg/manifest-2026103{0,1}.json` files
  are therefore refused outright.
  (2) `buildManifest` keeps the `/agents` order, and `AgentsRepository.list`
  has no `ORDER BY` (`server/src/modules/agents/repository.ts:102`). Any
  agent update (here the item A link edits) moves the row in heap order and
  changes the manifest fingerprint without changing any content
  (`286d9db4…` became `53fe5f20…`, differing only in the order of the two
  reviewers). Before a freeze, generate it with the command the runner will
  read back, and sort every manifest array by a stable key.

- **2026-10-31** — Sorting a frozen set is not enough when the runner looks
  records up by name. After the HW2 manifest began sorting agents and Skills,
  an independent review found that duplicate names had become invisible to
  the fingerprint. The manifest froze both rows, sorted, while
  `slotRuns`/`find()` used whichever row came first in heap order. A
  canonicalized freeze needs both halves: sort for the hash, and refuse a
  lookup key that does not match exactly one row (`exactlyOne`,
  `server/src/experiments/hw2/manifest.ts`). Also freeze every field that
  gates execution, not only content: a Skill's global `enabled` flag, which
  `enabledSkillsForPrompt` reads, was missing. Evidence:
  `server/test/hw2-manifest.test.ts`,
  `docs/homework/L02/evidence/item-b-predispatch-halt.md`.

- **2026-10-31** — A failed review run's trace does not record the prompt
  that was sent. The failure path in `run-executor.ts` (line 622) stores
  `{ system: agent.systemPrompt, skills: null, user: '' }`, so any check
  that reads `prompt_assembly.skills` from a failed run will show 0 Skills.
  The HW2 report did this and labelled experiment 17 `invalid`, although the
  run's experiment metadata held the frozen *with* Skill fingerprint and the
  same input token count as a completed *with* slot (1,142, against 1,034
  without). For a failed run, take the request's provenance from the
  experiment fingerprints and the attempt's token counts, not from the trace's
  prompt assembly. Better, record the assembled prompt before dispatch.
  Evidence: `docs/homework/L02/evidence/item-b-confirmatory/README.md`.

- **2026-11-01** — A SIGKILL sent to a child started as `node_modules/.bin/tsx
  -e <script>` kills only the tsx CLI. The CLI runs the script in an inner
  `node` and relays only SIGINT and SIGTERM to it; SIGKILL cannot be relayed,
  so the worker lives on, reparented to init. In
  `hw2-crash-recovery.test.ts` this meant:
  - the "dead" lock holder was still alive (`setInterval`), so the test never
    exercised a dead holder;
  - the "crashed" dispatch runner kept polling for up to 600 s, holding its
    in-memory ledger lock, while the test reconciled the same ledger;
  - the reservation-stage runner kept the fake stack's held request open, so
    `server.close()` waited for the 60 s request timeout (64.9 s per file).

  A run on `0c41f33` passed 4/4 and left two inner `node` workers alive, found
  by an environment marker. A self-SIGKILL also showed up as `code 137` from
  the wrapper rather than `signal SIGKILL`. Spawn the worker as one process,
  `process.execPath ['--import', 'tsx', '-e', script]`, and assert after each
  test that no process carrying the test's marker survives. Evidence:
  `server/test/helpers/owned-process.ts` (`ProcessOwner`, `leftovers`),
  `server/test/hw2-crash-recovery.test.ts` (4.5 s per file after the fix;
  pointing `spawnTsx` back at the CLI fails all 4 tests),
  `server/test/owned-process.test.ts`.

- **2026-11-01** — Correction to the 2026-10-31 entry above: a failed run's
  trace now records what was sent. The engine reports each stage's exact
  assembly before the provider call, and the failure path stores the failing
  stage's assembly (`prompt_assembly_source: 'dispatched_request'`), the
  ordered `stages[]` with their attempts and usage, and any bounded partial
  output. The terminal row update and the trace upsert share one transaction.
  Traces written before this have no `prompt_assembly_source`; the slot view
  classifies them at read time, and a legacy failure trace yields "prompt not
  recorded (legacy failure trace)" instead of "sent 0 skills". Two
  non-obvious consequences:
  - Moving the trace into the success transaction changes the observable
    order: `saveRunTrace` is no longer called on success, and the trace now
    commits *with* the `done` row. The run-lifecycle order test had to spy on
    the new `saveRunTraceIn` seam. A cancel through the API still writes
    `cancelled` before the executor's trace, so the 2026-10-14 "wait for the
    trace" rule still holds for cancelled runs.
  - For an API-cancelled run, the CAS-protected row keeps whatever the cancel
    wrote (status only, null usage), while the trace records the measured
    usage of a request that did go out. The row and the trace stats agree
    for every executor-written terminal state, not for that one.

  Evidence: `server/src/modules/reviews/run-executor.ts` (`runOneAgent`
  catch), `server/src/modules/reviews/repository.ts` (`finalizeRunFailure`),
  `server/src/modules/_shared/trace-evidence.ts`,
  `server/test/run-failure-trace.it.test.ts`; removing the captured assembly,
  the usage mirroring, the refusal classification or the transaction each
  fails at least one of its tests.

- **2026-11-01** — Extension and correction of the entry above, after the
  security and architecture review:
  - **One bad character could roll back the whole terminal write.** Postgres
    `jsonb` rejects the `\u0000` escape and unpaired UTF-16 surrogates
    (which `JSON.stringify` emits as `\udXXX`), and `text` rejects U+0000.
    Model output, a diff or an error message can contain either. Once the
    row update and the trace upsert shared one transaction, such a character
    left a failed run `running`, and on the success path turned a billed
    review into a failure. Every trace, error and review text is now passed
    through `pgSafeDeep` / `pgSafeText` (U+FFFD) before the write; recorded
    hashes stay those of the original text.
  - **`running` until boot only if the retry fails too.** When the failure
    transaction throws, the executor retries once with a minimal trace
    (`persistence: 'fallback'`, prompt `unrecorded`). A live process leaves a
    run `running` for the boot reaper only when that retry also fails.
  - **Correction to the API-cancelled bullet above:** the row is no longer
    left with null usage. Inside the same transaction, a second update
    guarded on `status = 'cancelled' AND tokens_in IS NULL AND cost_usd IS
    NULL` fills it from the trace's totals and never touches the status. A
    CAS miss on any other terminal state now writes no trace at all, so a
    reaped trace is never overwritten. The HW2 budget still charges the
    reservation for a null cost and the known cost once it is known.
  - **Attempt records do not see SDK retries.** In OpenRouter's ordinary
    path the OpenAI SDK retries timeouts, 429 and 5xx inside one
    `create()`, so one attempt record can stand for several HTTP requests.
    The adapters' own `withRetry` retries (OpenAI, Anthropic) are recorded,
    as `transport_retry`. Experiment mode sets SDK retries to 0.

  Evidence: `server/src/db/pg-text.ts`,
  `server/src/modules/reviews/repository.ts` (`finalizeRunFailure`),
  `server/src/modules/reviews/repository/run.repo.ts`
  (`recordCancelledRunUsage`, `reapStaleRunningRuns`),
  `reviewer-core/src/llm/openrouter.ts` (`completeStructured` comment), and
  `server/test/run-failure-trace.it.test.ts` ("text Postgres rejects,
  retries and bounds", "terminal writes never overwrite another terminal
  trace"). Removing the sanitizer fails 3 of those tests; removing the
  retry, the cancelled-usage fill or the status guard fails 1 each.

- **2026-11-01** — The v4 "a truncation continues" rule only helps when a
  truncated generation's provenance is complete, and the one real truncation
  on record was not. The v4 runner and report treat a `truncated` slot as
  continuable only when everything strict eligibility asks for holds apart
  from the truncation itself (`truncationCheck`,
  `server/src/experiments/hw2/eligibility.ts`). That is the coordinator's
  rule that a provenance gap still stops the schedule. v3's `c-17-with-2`
  showed `unverified (router_metadata)` with "a single upstream attempt is
  not proven": the generation did not corroborate it, and the router metadata
  did not carry `attempt`/`attempts` = 1. Run under v4, that same slot would
  stop the schedule, not be imputed. Before a v4 run, check on a free or
  recorded truncation that the generation lookup shows exactly one provider
  response. Otherwise expect `incomplete` again. Evidence:
  `docs/homework/L02/evidence/item-b-confirmatory/runner-report.md` (row
  `c-17-with-2`), `server/test/hw2-study-v4.test.ts` ("a truncation with a
  provenance gap … still stops the schedule").

- **2026-11-01** — Correction to the entry above about the v4 truncation
  rule: v4 now also accepts a truncation at provenance level
  `router_metadata_only`. The study block's `truncation_provenance:
  single-router-attempt` sets this, and `truncationCheck` implements it. The
  conditions are: router `attempt` 1, `attempts` 1 or absent, one selected
  endpoint equal to the frozen provider and served model, and a generation
  that is `not_found` or found with exactly one matching response. Cost and
  fingerprints must be known and frozen. The private forensic slot view of
  `c-17-with-2` has exactly that shape (`attempt: 1`, `attemptsCount: null`,
  DeepInfra selected, generation `not_found`), so the same slot would now
  continue and be imputed. The level used is recorded on the ledger and in
  the report row. Evidence: `server/test/hw2-study-v4.test.ts` ("a
  truncation shaped like v3 c-17-with-2 … continues at
  router_metadata_only"), `docs/homework/L02/prereg/study-v4-frozen-text.md`.

- **2026-11-02** — In HW2, a 429 policy that re-attempts grows the
  conservative ledger mostly through reservations, not spend. `charge` in
  `budget.ts` keeps a terminal slot with unknown cost at its full
  reservation, and a pre-generation 429 has unknown cost even after a
  settlement proves it was not billed. The v4 429 still holds $0.005.
  - **Scale.** Under a K = 3 attempt pool at p = 0.2, the expected actual
    spend is $0.0035–0.0079. The expected conservative growth is
    $0.0159–0.0203, mostly 2.48 expected 429s × $0.005.
  - **The runner would stop anyway.** The default
    `maxConsecutiveUnknownCost: 2` in `runner.ts` would fire on two 429s in a
    row, and any confirmatory failure already stops the schedule. A non-stop
    429 policy therefore needs an explicit, classified exception, not just a
    new stop rule.
  - **A binding cap biases missingness.** A total-attempt cap below
    trials × K binds late in the order, so the condition of the later trials
    decides which arm loses them. Make the cap equal to the plan length.

  Evidence: `server/src/experiments/hw2/throttle-policy.ts`
  (`expectedSpend`, `exactMetrics`), `server/test/hw2-throttle-policy.test.ts`,
  `docs/homework/L02/proposals/429-policy-proposal.md` (sections 4 and 6).

- **2026-11-02** — Extension and correction of the entry above (the 429
  policy and held reservations), after an independent methodology review:
  - **A step-by-step protocol validator misses optional stopping.** The
    first `traceProblems` checked only the steps a trace contained. It
    accepted a trace that stopped after six observed trials, and a last trial
    abandoned after a 429 on a1. A validator for a predeclared protocol must
    also require that the trace ends where the protocol terminates. Dropping
    that check now fails 2 tests.
  - **Magnitude correction to "a binding cap biases missingness".** It does,
    but the effect is small. Across 200 seeds at p = 0.4, K = 3, M = 20, the
    with − without expected-missing difference is at most ±0.018. Stop on
    the first 429 (P1) reaches ±0.40 at p = 0.2. The larger positional risk
    is the provider pattern: all four observed 429s were a session's 2nd
    paid request.

  Evidence: `server/src/experiments/hw2/throttle-policy.ts`
  (`traceProblems`), `server/test/hw2-throttle-policy.test.ts` (mutation
  record, items 7 and 2), `docs/homework/L02/proposals/429-policy-proposal.md`
  (section 4).

## Session Notes

## Open Questions
