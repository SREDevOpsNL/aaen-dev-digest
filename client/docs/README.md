# client/docs

How the studio works today. Deep dives too long for
[`../README.md`](../README.md) and too stable for
[`../LEARNINGS.md`](../LEARNINGS.md).

Good candidates: the TanStack Query cache and invalidation strategy, the
app-shell and `g`-then-key shortcut map, the `next-intl` message workflow,
diff-rendering internals, loading and error conventions at RSC boundaries.

Not here: the UI route map (that is [`../README.md`](../README.md)), intent for
unbuilt screens ([`../specs/`](../specs/README.md)), rejected approaches
([`../LEARNINGS.md`](../LEARNINGS.md)).

## Cross-package context

- [Product identity](../../docs/ai-context/00_PRODUCT_IDENTITY.md)
- [Product boundary](../../docs/ai-context/01_PRODUCT_BOUNDARY.md)
- [Architecture overview](../../docs/architecture/00_ARCHITECTURE_OVERVIEW.md)

## Documents

- [`ui-architecture.md`](ui-architecture.md) — routing and URL state, the
  `_components/<Name>/` folder anatomy, the data layer (API client, hooks,
  query keys, polling, invalidation), next-intl copy, the app shell, and
  vendored code.
- [`pr-review-screens.md`](pr-review-screens.md) — what the PR list and PR
  detail show, which component owns each part, and where its data comes from.
- [`findings-preview.md`](findings-preview.md) — the shared severity-count
  popover: props and scopes, placement, the open/close rules, accessibility,
  and tests.
