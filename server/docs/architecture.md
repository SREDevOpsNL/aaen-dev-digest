# API architecture

How the Fastify API is put together today: the boot sequence, how a feature
module is laid out, the composition root, tenancy, errors, background work, and
the data workflow. The request/DI diagram, the route map, and the environment
table live in [`../README.md`](../README.md); this document does not repeat
them.

## Boot sequence

`buildApp()` in [`src/app.ts`](../src/app.ts) is the single entry point for the
server and for every `app.inject()` test. In order, it:

1. Loads `AppConfig` and opens a Drizzle handle unless a test passes one in
   (`src/app.ts:41`).
2. Creates Fastify with a 1 MB body limit (`src/app.ts:49`) and installs the
   `fastify-type-provider-zod` validator and serializer (`src/app.ts:64`).
3. Builds the DI `Container` and decorates the app with it (`src/app.ts:67`).
4. **Reaps orphaned runs before listening** (`src/app.ts:81`): any
   `agent_runs` row still `running` belongs to a dead process and becomes
   `failed`. This assumes one API instance per database.
5. Registers helmet, CORS (origin = `http://localhost:${WEB_PORT}`), the SSE
   plugin, and the global 120/min rate limit, which is skipped when
   `NODE_ENV=test` (`src/app.ts:89-96`).
6. Adds `/health` and `/health/ready` (`SELECT 1`, 503 when the DB is down;
   `src/app.ts:100-104`).
7. Installs the error handler before the modules, so every encapsulated module
   inherits it (`src/app.ts:116`).
8. Registers every feature module from the static registry
   (`src/app.ts:168`).

Migrations do **not** run on boot (see [Data](#data-migrations-and-seed)).

## Feature modules

[`src/modules/index.ts`](../src/modules/index.ts) registers each module
statically (no filesystem autoload, so tsx, the bundler, and vitest share one
code path). The starter set is `settings`, `repos`, `pulls`, `polling`,
`workspace`, `agents`, `reviews`, and `repoIntel`.

A module is a Fastify plugin in `modules/<name>/routes.ts`. Larger modules
split by role; `reviews` is the fullest example:

| File | Role |
| --- | --- |
| `routes.ts` | Transport only: Zod params/body, `getContext`, per-route rate limits, DTO out. |
| `service.ts` | Orchestration (`ReviewService`): resolve targets, create runs, cancel, reads. |
| `run-executor.ts` | Background work for one batch of agent runs (see [review runs](review-runs.md)). |
| `repository.ts`, `repository/*.repo.ts` | Drizzle queries, grouped by aggregate (pull, review, run). |
| `helpers.ts`, `findings.ts` | Row → DTO mapping and finding accept/dismiss. |

Small modules stay flat. `pulls` keeps its queries in `routes.ts` and its pure
derivations in `status.ts`, which `test/pulls-status.test.ts` covers without a
database (see [PR list summary](pr-list-summary.md)). Shared helpers live in
`modules/_shared/` (`context.ts`, `schemas.ts`).

## Composition root

[`src/platform/container.ts`](../src/platform/container.ts) is the only place
that constructs adapters:

- **Eager** (constructor, `container.ts:80`): `config`, `db`, `secrets`
  (`LocalSecretsProvider`), `auth` (`LocalNoAuthProvider`), `jobs`
  (`JobRunner`), and the process-wide `runBus`.
- **Lazy and cached:** `git`, `codeIndex`, `repoIntel`, `depgraph`,
  `tokenizer`, `priceBook`, and the shared `agentsRepo` and `reviewRepo`
  (`container.ts:89-140`).
- **Lazy and secret-backed:** `github()` (`container.ts:153`), `llm(id)`
  (`container.ts:163`), and `embedder()` (`container.ts:195`). Each one throws
  `ConfigError` when its key is missing; `embedder()` also throws when
  `EMBEDDINGS_ENABLED` is off, before any OpenAI client exists.
  `invalidateSecretCaches()` (`container.ts:214`) drops the cached clients after
  Settings saves a key.

Tests pass `ContainerOverrides` (mock LLM, git, GitHub, repo-intel, …) through
`buildApp({ overrides })`. Services depend on the port interfaces in
[`src/vendor/shared/adapters.ts`](../src/vendor/shared/adapters.ts), never on
the concrete classes in `src/adapters/`.

## Tenancy

Every handler starts with `getContext(container, req)`
([`modules/_shared/context.ts`](../src/modules/_shared/context.ts)), which asks
the `AuthProvider` for the current user and workspace. In the starter,
`LocalNoAuthProvider` always returns the seeded default workspace and system
user. Queries still filter by `workspaceId`, for example the repository lookup
at the top of `GET /repos/:id/pulls`. Keep that filter on every new query, so
real auth can drop in without a data leak.

## Errors

Throw an `AppError` subclass from
[`src/platform/errors.ts`](../src/platform/errors.ts). The handler turns it into
`{ error: { code, message, details } }` with the subclass's status:

| Class | `code` | Status |
| --- | --- | --- |
| `AppError` | caller-chosen | caller-chosen (default 400) |
| `NotFoundError` | `not_found` | 404 |
| `ValidationError` | `validation_error` | 422 |
| `ExternalServiceError` | `external_service_error` | 502 |
| `ConfigError` | `config_error` | 500 |

Zod request validation fails with 422 before the handler runs. A response that
fails its own serialization schema is logged and returned as a generic 500, so
the raw object never leaks.

## Configuration and secrets

`AppConfig` ([`src/platform/config.ts`](../src/platform/config.ts)) holds
non-secret settings only: the database URL, ports, the clone directory, the log
level, and the feature flags. A relative `DEVDIGEST_CLONE_DIR` resolves against
the process working directory; unset, clones go to `~/.devdigest/workspace`.

API keys and the GitHub token go through `SecretsProvider`
([`src/adapters/secrets/local.ts`](../src/adapters/secrets/local.ts)). It reads
`~/.devdigest/secrets.json` (mode 0600) first and falls back to `process.env`.
`GITHUB_TOKEN` is canonical, and `GITHUB_PAT` is still accepted. Secrets never
enter `AppConfig`, the database, or git.

## Background work

There are two mechanisms, and they are not interchangeable:

- **`JobRunner`** ([`src/platform/jobs.ts`](../src/platform/jobs.ts)): a
  concurrency-limited p-queue mirrored into the `jobs` table, with timeouts and
  retry/backoff. Handlers register by kind: repository clone
  (`modules/repos/service.ts:46`) and repo-intel index, refresh, and resync
  (`modules/repo-intel/service.ts:173-179`).
- **Review runs** do not use `JobRunner`. `ReviewService.runReview` creates the
  `agent_runs` rows, returns immediately, and executes the batch
  fire-and-forget in the same process. That is why a restart can orphan a
  `running` row, and why boot reaps them ([review runs](review-runs.md)).

## Data, migrations, and seed

- **Schema:** `src/db/schema/*.ts`, one file per domain, re-exported by the
  `src/db/schema.ts` barrel. It contains tables for later lessons that no
  starter code writes to; an empty table is expected.
- **Migrations:** change the schema, then run `pnpm db:generate` and
  `pnpm db:migrate`. Never hand-edit `src/db/migrations/`. Nothing migrates on
  boot, so `relation … does not exist` means `db:migrate` was skipped.
- **Seed** (`pnpm db:seed`, idempotent; [`src/db/seed.ts`](../src/db/seed.ts)):
  - The default workspace, system user, membership, and settings.
  - The repository `acme/payments-api`.
  - PR #482 with four files and one commit.
  - One sample review with two findings (Critical and Warning) and **no
    `run_id`**.
  - Three enabled agents: General, Security, and Performance Reviewer.

  Because the sample review has no successful run, the PR list and the Timeline
  show no severity counts for it; the browser suite stubs a run where it needs
  one (see [`../../e2e/docs/`](../../e2e/docs/README.md)).

## Cross-package context

- [Product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md): which of
  these modules are operational.
- [Architecture overview](../../docs/architecture/00_ARCHITECTURE_OVERVIEW.md):
  the whole-system view.
