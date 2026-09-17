# e2e (`@devdigest/e2e`) — agent notes

Extends [`../CLAUDE.md`](../CLAUDE.md). Read that first; this file holds only
what is local to the browser suite.

## Scope

`e2e/` owns deterministic browser journeys over a seeded DevDigest stack, driven
by Vercel **agent-browser** (CDP, no LLM). No Playwright, no model key.

## Commands

**npm, not pnpm.** This package has its own `package-lock.json`.

```sh
npm i -g agent-browser && agent-browser install   # once — downloads Chrome for Testing
npm run e2e:hermetic    # RECOMMENDED: isolated seeded stack (:5433/:3101/:3100)
npm test                # runs flows against whatever is on E2E_BASE_URL
npm run typecheck
```

Hermetic ports are overridable: `E2E_PG_PORT`, `E2E_API_PORT`, `E2E_WEB_PORT`.

## Test rules

- A flow is `specs/NN-name.flow.json`: a JSON list of agent-browser commands run
  in order against one shared browser session by `run.ts`, which discovers files
  by the `.flow.json` suffix and runs them in filename order. **Preserve the
  numeric prefixes.**
- Flow files are **executable specifications** — the flow is both the intent and
  the test. The runner ignores everything that is not `*.flow.json`, so prose
  specs live in `specs/written/` beside them; see
  [`specs/README.md`](specs/README.md).
- `{BASE}` is substituted with `E2E_BASE_URL` (default `http://localhost:3000`).
- **`wait --text` / `wait --url` are the assertions** — they exit non-zero on
  timeout. Optional `"assert": { "stdoutIncludes": … }` adds a stdout check.
- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`.
  Never use the AI `chat` command — runs must stay stable and key-free.
- Flows target read-only seeded data (`acme/payments-api`, PR #482, the seeded
  agents) so nothing triggers a model call. Do not add a flow that writes, and
  never trigger a live review from a seeded flow.
- Keep each flow independent in intent, even though the runner shares one browser
  session.
- Do not commit screenshots, `test-results/`, traces, or other transient output.

## Gotchas

- **Flows assume a freshly-seeded DB with exactly one repo.** Four of the seven
  enter at `{BASE}/` and follow the home redirect to the *first* repo. Your dev DB
  usually has other imported repos, so plain `npm test` against it fails those
  flows. Use `npm run e2e:hermetic`.
- **Never `docker compose down -v` to fix that** — `-v` deletes the
  `devdigest_pgdata` volume and every real repo and review in it. The hermetic
  runner exists precisely so you never need to touch the dev DB. A full reset is a
  deliberate decision, not a test-debugging step.
- This is a CLI wrapper, not a test framework: a failing step fails the flow with
  the raw agent-browser exit, so read stderr rather than expecting a matcher diff.

## Read when

- Read [`INSIGHTS.md`](INSIGHTS.md) first for what was already tried here, and run
  the `engineering-insights` skill at the end of the task to add to it.
- Read [`README.md`](README.md) for the flow format and the full hermetic-runner
  walkthrough.
- Read [`docs/`](docs/README.md) for how the suite works today, and
  [`specs/`](specs/README.md) for the flows plus any prose spec under
  `specs/written/`.
- Read [`../client/README.md`](../client/README.md) when a flow breaks after a UI
  route change.
- Read [`../TESTING.md`](../TESTING.md) for where this suite sits in the overall
  strategy.
