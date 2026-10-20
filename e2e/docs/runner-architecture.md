# Runner architecture

How a flow file becomes a pass or a fail, and how the two stacks the flows run
against are brought up: the hermetic local stack and CI. The flow format and
the run commands are in [`../README.md`](../README.md); what the seed provides
is in [seed-and-flows.md](seed-and-flows.md).

## The runner

[`run.ts`](../run.ts), plus the helpers in [`lib/assert.ts`](../lib/assert.ts):

1. **Discover:** every `specs/*.flow.json` file, sorted lexically
   (`run.ts:56`). The order is the filename order: `07a-…` runs after
   `07-…` and before `08-…`. Markdown in `specs/` is ignored.
2. **Substitute:** each step's `cmd` is passed as argv to `agent-browser`,
   after `{BASE}` becomes `E2E_BASE_URL` with any trailing slash removed
   (`resolveArgs`). There is no shell, so arguments need no quoting beyond
   JSON.
3. **Judge each step:**
   - **Exit code:** a non-zero exit fails the step. That is how
     `wait --text`, `wait --url`, `wait <selector>`, and `wait --fn` assert:
     they time out and exit non-zero.
   - **Output:** an optional `assert.stdoutIncludes` adds a substring check,
     which is how `eval` assertions work.
   - **Timeout:** each command has `E2E_STEP_TIMEOUT` ms (default 60,000;
     `run.ts:41`).
4. **On failure:** the flow stops at the first failing step, saves a
   best-effort screenshot to `test-results/<flow>-fail.png` (`run.ts:86`), and
   the runner moves on to the next flow. One failing flow does not hide the
   others.
5. **Session and exit:**
   - All flows share **one** agent-browser session (the daemon keeps the page),
     which is closed at the end.
   - The process exits 1 if any flow failed, after a PASS/FAIL summary with
     each failing step.

**Shared session.** A flow inherits the previous flow's page, cookies, storage,
and viewport. Every flow therefore starts with `open`. A flow that changes
something lasting must keep it local: `07a`, for example, stubs `fetch` only
in the document it opened.

## Hermetic stack (`npm run e2e:hermetic`)

[`scripts/e2e.sh`](../../scripts/e2e.sh) mirrors CI on alternate ports, so it
can run beside a dev stack:

| Step | Detail |
| --- | --- |
| Ports | Postgres `:5433`, API `:3101`, web `:3100`; override with `E2E_PG_PORT`, `E2E_API_PORT`, `E2E_WEB_PORT`. |
| Postgres | `docker run --rm` of `pgvector/pgvector:pg16` with **no volume**, so it is empty on every run (`e2e.sh:124`); waits up to 60s for health. The database is `devdigest_e2e`, and the container is `devdigest-e2e-postgres` (override with `E2E_PG_CONTAINER`). Because that default name is fixed, never run two default suites at once. |
| Dependencies | `pnpm install` in `server/` and `client/` only if `node_modules` is missing; `npm ci` in `reviewer-core/`, whose source the API imports. |
| Data | `db:migrate` and `db:seed` with `DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1`, guarded to refuse any `DATABASE_URL` not on the isolated port (`e2e.sh:160`). See [seed and flows](seed-and-flows.md). |
| API | `pnpm exec tsx src/server.ts`: no watcher, so nothing restarts mid-suite. |
| Web | `pnpm exec next dev -p 3100`, with `NEXT_PUBLIC_API_BASE` pointing at `:3101`. |
| Run | `cd e2e && npm test` against `http://localhost:3100`. |
| Teardown | On exit, error, or Ctrl-C, `kill_tree` walks each server's process tree leaves-first (the real listener is a grandchild of `pnpm`), then reaps anything still listening on the alternate ports and removes the container. |

**`--serve` mode.** `scripts/e2e.sh --serve` starts a stack for the HW2
experiment runner instead of running the flows:

- a fresh stack id, with a database and container named after a random nonce;
- Docker labels, an empty per-stack clone directory, and synthetic
  conventions;
- the server in experiment mode.

It blocks until Ctrl-C. The operator guide is
`docs/plans/HW2-experiment-operator-guide.md`.

**Shared `.next/`.** The web server runs `next dev` inside the checkout's own
`client/`. If a dev server is already running from the **same** checkout, both
use one `client/.next`. To keep a running dev server undisturbed, run the
hermetic suite from a separate worktree.

## CI (`.github/workflows/e2e-web.yml`)

It runs on pushes to `main` and on PRs that touch `client/`, `server/`, `e2e/`,
or the workflow itself. Compared with the hermetic stack:

- **Database:** `docker compose up -d` on the default ports (5432, 3001,
  3000), then a separate `devdigest_e2e` database created inside it and seeded
  with `DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1`. The runner is fresh, so it
  starts empty.
- **Web:** a **production build** (`pnpm build`, then `pnpm start`), not
  `next dev`. A flow that passes locally can still fail on a production-only
  difference, and the reverse.
- **Browser:** `agent-browser install --with-deps`, then `npm ci && npm test`.
- **Artifacts:** on failure, `e2e/test-results/**` (the screenshots) is
  uploaded.

## Determinism rules

- **Locators:** `--url`, `--text`, `find role|text|label`, CSS selectors, and
  `eval` read-backs. Never the AI `chat` command.
- **Read-only:** flows never write to the database and never trigger a review,
  so no model key is needed.
- **Waits:** fixed `wait <ms>` steps appear only where the browser dispatches an
  event asynchronously, as in `07a`. Assert with a `wait --*` condition
  wherever one exists.
