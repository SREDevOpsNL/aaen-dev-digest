# client (`@devdigest/web`) — agent notes

Extends [`../AGENTS.md`](../AGENTS.md). Read that first; this file holds only
what is local to the studio.

## Scope

`client/` owns the Next.js studio: routing, React state, the typed API client and
its hooks, and the presentation of repositories, pull requests, agents, findings,
diffs and Settings. It is a presentation and interaction layer — nothing more.

## Commands

**pnpm, not npm.** This package has its own `pnpm-lock.yaml`.

```sh
pnpm dev          # next dev, :3000
pnpm build
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest + jsdom, fetch mocked — no API needed
```

## Boundaries

- **No direct access to Postgres, git, GitHub, or any LLM provider.** Every piece
  of server data arrives over the typed API client.
- App Router. Pages (`src/app/**/page.tsx`) stay thin; feature logic lives in
  colocated `_components/<Name>/` folders. Coverage is partial today — 9 of 30
  component folders have a colocated `*.test.tsx` — so treat this as the going
  rule for new work: a new non-trivial feature component gets its own
  `*.test.tsx` next to it. Do not infer from a missing test that the folder is
  untested by design.
- All data access goes through a hook in `src/lib/hooks/*`
  (`agents`, `core`, `repo-intel`, `reviews`, `trace`), which calls
  `src/lib/api.ts`. Components never call `fetch` directly.
- Server state is TanStack Query. Do not mirror it into `useState`.
- User-facing strings go through `next-intl` — add them to
  `messages/<locale>/*.json`, never inline literals in JSX.
- Types for API payloads come from `@devdigest/shared`. Do not redeclare them.
- Cross-cutting chrome (nav, breadcrumbs, `g`-then-key shortcuts) lives in
  `src/components/app-shell`.
- Loading, empty and error states are first-class behaviour, not an afterthought.
- Preserve the existing `@/*` alias; do not add new path aliases.

## Gotchas

- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`). It is
  read at build time — changing `.env` needs a dev-server restart.
- Tests mock `fetch`, so a passing test proves nothing about real API shape. The
  contract is enforced by `@devdigest/shared`; the real journey by [`../e2e`](../e2e/README.md).
- `messages/en/` carries namespaces for features this starter does not ship. An
  existing namespace is not evidence that a screen exists.

## Do not touch

- `src/vendor/ui` (`@devdigest/ui`) — vendored.
- `src/vendor/shared` — a hand-copy of `server/src/vendor/shared` with no sync
  script. Change it only as part of a deliberate contract change, **server side
  first**. See [`../LEARNINGS.md`](../LEARNINGS.md).

## Skills

`next-best-practices`, `react-best-practices`, `react-testing-library`,
`typescript-expert`, `zod`, and `security` when a screen renders untrusted PR
content.

## Read when

- Read [`LEARNINGS.md`](LEARNINGS.md) first for what was already tried here, and run
  the `engineering-insights` skill at the end of the task to add to it.
- Read [`README.md`](README.md) for the UI route map and which endpoints each page
  leans on.
- Read [`docs/`](docs/README.md) before restructuring state or the data layer.
- Read [`specs/`](specs/README.md) for intent on screens that are not built yet.
- Read [`../server/README.md`](../server/README.md) when you need the exact shape
  of an endpoint.
- Read [`../e2e/README.md`](../e2e/README.md) when a change affects a seeded
  browser flow.
