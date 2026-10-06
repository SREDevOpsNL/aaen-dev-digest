# server (`@devdigest/api`) — agent notes

Extends [`../AGENTS.md`](../AGENTS.md). Read that first; this file holds only
what is local to the API.

## Scope

`server/` owns the Fastify API, dependency composition, Postgres persistence, the
GitHub/git/LLM adapters, background jobs, run events, repository indexing
(`src/modules/repo-intel/`), and the canonical Zod contracts in
`src/vendor/shared/`.

## Commands

**pnpm, not npm.** This package has its own `pnpm-lock.yaml`.

```sh
pnpm dev                                           # tsx watch, :3001
pnpm typecheck                                     # tsc --noEmit
pnpm test                                          # everything, incl. DB-backed
pnpm exec vitest run --exclude '**/*.it.test.ts'   # hermetic units only
pnpm exec vitest run .it.test                      # DB-backed only (needs Docker)
pnpm db:generate && pnpm db:migrate                # schema change → migration → apply
pnpm db:seed                                       # idempotent demo data
```

Plain `pnpm test` runs the `*.it.test.ts` files too, which need Docker. For a
quick loop, use the hermetic subset.

## Architecture rules

- One feature = one `src/modules/<name>/` plugin, registered statically in
  `src/modules/index.ts` (one import + one `app.register`). A module that is not
  registered there is not part of the running API.
- Keep transport in `routes.ts`, behaviour in services, and SQL in repositories.
- Routes declare Zod `params`/`body`/response schemas from `@devdigest/shared` via
  `fastify-type-provider-zod`. Invalid input is rejected with `422` **before** the
  handler runs — never hand-roll `Schema.parse(req.body)`.
- Plugins (helmet, cors, rate-limit, SSE) register **before** modules, so the
  encapsulated module plugins inherit them and the shared error handler.
- External I/O goes through an adapter behind the DI container
  (`src/platform/container.ts`) so tests can swap in `src/adapters/mocks.ts`.
- Scope domain queries by workspace.
- Secrets are read only through `LocalSecretsProvider`
  (`src/adapters/secrets/local.ts`). `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is
  read as a back-compat fallback.
- In-process jobs (`src/platform/jobs.ts`) and SSE are **non-durable**
  coordination, not a work queue you can rely on across a restart.
- Preserve graceful degradation when GitHub or repo-intel is unavailable — the
  review path is expected to keep working with less context, not to fail.

## Database rules

- Schema lives in `src/db/schema/*.ts`, re-exported by `src/db/schema.ts` — which
  is the file `drizzle.config.ts` reads. Edit the module, then `pnpm db:generate`.
  **Never hand-write a migration file.**
- Change schema and migration together, in one commit.
- Classify any test that needs real Postgres as `*.it.test.ts`.
- Never silently modify or drop user data in a migration.
- pgvector is enabled by migration `0000`. Its availability does not mean
  embeddings or memory are active features.

## Gotchas

- Migrations are **not** applied on boot.
- `loadConfig` marks every secret optional — the server boots with no keys, so a
  missing key surfaces at call time, not at startup.
- The DB schema already contains every table, including ones no starter code
  writes to. An empty table is expected, not a bug.
- `repo-intel` clones into the clone directory (`server/clones/` under the
  `.env.example` value, else `~/.devdigest/workspace`). It is gitignored, it
  contains a copy of this repository, and it must be excluded from every search
  you run.
- The server reaps orphaned `running` runs on boot (`src/app.ts`).

## Skills

`fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
`typescript-expert`, `zod`, `security`.

## Read when

- Read [`LEARNINGS.md`](LEARNINGS.md) first for what was already tried here, and run
  the `engineering-insights` skill at the end of the task to add to it.
- Read [`README.md`](README.md) for the API map and the request/DI flow diagram.
- Read [`docs/`](docs/README.md) before changing the run lifecycle, the container,
  or the secrets path.
- Read [`specs/`](specs/README.md) for intent on endpoints that are not built yet.
- Read [`src/modules/repo-intel/README.md`](src/modules/repo-intel/README.md) when
  touching indexing or the repo map.
- Read [`../TESTING.md`](../TESTING.md) before adding a test or changing the
  unit/integration split.
