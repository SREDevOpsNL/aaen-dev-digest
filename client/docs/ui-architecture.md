# UI architecture

How the studio is organised today: routing, component folders, the data layer,
copy, and the shared chrome. The route map, and which endpoints each page
calls, is in [`../README.md`](../README.md#ui-route-map). The product status of
each screen is in the
[product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md).

## Routing

Next.js 15 App Router under `src/app/`. Pages stay thin. Most are client
components that read route params and the query string; `agents/page.tsx` and
`settings/[section]/page.tsx` are server components that render client children.

- `/` redirects to the **first** repository's PR list, or offers onboarding
  when there is none.
- `/repos/[repoId]/pulls` is the PR list. `?status=` selects the filter tab and
  defaults to `needs_review`.
- `/repos/[repoId]/pulls/[number]` is the PR detail. The rest of its state also
  lives in the query string, so links and reloads keep it: `?tab=overview |
  findings | diff`, and `?trace=<runId>` opens the run-trace drawer.
- `/agents`, `/agents/[id]`, `/settings/[section]`, and `/onboarding`.

The active repository comes from `RepoProvider`
([`src/lib/repo-context.tsx`](../src/lib/repo-context.tsx)): the `repoId` in
the URL wins, then `localStorage`, then the first repository from the API.

## Component folders

Feature logic lives next to its route in `_components/<Name>/`, for example
[`pulls/_components/FindingsPreview/`](../src/app/repos/[repoId]/pulls/_components/FindingsPreview/):

| File | Holds |
| --- | --- |
| `<Name>.tsx` | The component. |
| `styles.ts` | Inline style objects (`s.<part>`), typed with `satisfies CSSProperties`. |
| `constants.ts` | Static maps and types (severity meta, thresholds). |
| `helpers.ts` | Pure logic, unit-tested on its own (`helpers.test.ts`). |
| `index.ts` | The public export. |
| `<Name>.test.tsx` | Vitest and Testing Library, next to the component. |

Nested parts get their own `_components/` (for example
`RunTraceDrawer/_components/TraceBody`). Code shared by several routes moves up
to the nearest common segment: `FindingsPreview` serves both the PR list and the
PR detail, so it sits in `pulls/_components/`. Cross-route chrome lives in
`src/components/`.

## Data layer

```text
component → hook (src/lib/hooks/*) → api.get/post (src/lib/api.ts) → fetch(API_BASE + path)
```

- **`apiFetch`** ([`src/lib/api.ts`](../src/lib/api.ts)) is the only `fetch` call.
  - It sends a JSON content type only when there is a body.
  - It turns failures into `ApiError(status, code, details)`: status 0 for "API
    unreachable", otherwise the server's error envelope.
  - `NEXT_PUBLIC_API_BASE` is read at build time, so changing it needs a dev
    server restart.
- **Hooks** are grouped by domain: `core.ts` (settings, repos, pulls),
  `reviews.ts`, `trace.ts`, `agents.ts`, and `repo-intel.ts`. Server state stays
  in TanStack Query and is never copied into `useState`.
- **Defaults** ([`src/lib/providers.tsx`](../src/lib/providers.tsx)):
  `retry: 1`, `staleTime: 30s`, and no refetch on window focus.
  - Query errors toast only for network or 5xx failures; an expected 404 stays
    an inline empty state.
  - Every mutation error toasts.
- **Polling** is per hook, and only where state changes without the user:

  | Hook | Query key | Interval |
  | --- | --- | --- |
  | `usePulls` | `["pulls", repoId]` | 60s, hard-coded; the `polling_interval_min` setting is not wired. |
  | `usePrActiveRuns` | `["pr-active-runs", prId]` | 4s while any run is `running`, else off. |
  | `usePrRuns` | `["pr-runs", prId]` | 4s while any run is `running`, else off. |
  | `useRepoIntelStatus` | `["repo-intel-state", repoId]` | 1.5s while indexing, when the caller passes `poll`. |

- **Invalidation** happens where the mutation is defined:
  - `useRunReview`, `useFindingAction`, and `useDeleteReview` refresh
    `["reviews", prId]`.
  - `useDeleteRun` refreshes both `pr-runs` and `reviews`.
  - When a live run settles, the PR page also invalidates `pr-active-runs` and
    `pr-runs`, and refetches reviews (`pulls/[number]/page.tsx`).
- **Types** come from `@devdigest/shared`, the hand-maintained mirror in
  `src/vendor/shared/`. Contract changes land in `server/src/vendor/shared/`
  first, then here.

## Copy (next-intl)

- **Setup:** one locale (`en`) and no locale routing.
  [`src/i18n/request.ts`](../src/i18n/request.ts) merges every
  `messages/en/<namespace>.json` file into one object, and the root layout
  passes it to `NextIntlClientProvider`.
- **Usage:** components call `useTranslations("<namespace>")`. User-facing
  strings never appear as JSX literals.
- **Adding copy:** add the key to the matching namespace file, for example
  `prReview.list.findingsInLatestAgentRuns`. Component tests render with the
  real JSON file, so an assertion on the copy catches a missing key.
- **Scaffolding:** many namespaces (`skills`, `eval`, `memory`, …) belong to
  later lessons. A namespace is not evidence that a screen exists.

## Shell and vendored code

- **App shell** ([`src/components/app-shell/`](../src/components/app-shell/)):
  - The sidebar, breadcrumbs, and the Cmd/Ctrl+K command palette.
  - `?` opens shortcuts help.
  - `g` followed by a key navigates. The keys come from each nav item's `gKey`
    in the vendored `NAV` (`useGlobalShortcuts`).
- **`@devdigest/ui`** (`src/vendor/ui/`): vendored primitives such as `Badge`,
  `Button`, `Icon`, and `Toggle`. Do not edit them. The one exception is the
  navigation data in `nav.ts`.
- **Aliases:** `@/*` points at `src/`. `@devdigest/shared` and `@devdigest/ui`
  point at the vendored folders. Do not add new aliases.

## Tests

- **Component and hook tests:** `pnpm test`, using Vitest, jsdom, and a mocked
  `fetch`. They prove behaviour, not the real API shape.
- **API shape:** enforced by the shared contracts.
- **Real browser journeys:** [`../../e2e`](../../e2e/README.md).
