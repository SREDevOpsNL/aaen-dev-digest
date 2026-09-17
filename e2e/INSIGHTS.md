# Insights — e2e

Browser-suite dead ends. Read before writing or debugging a flow.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `specs/NN-name.flow.json`
```

Roughly 5 entries per section. Promote stable entries into
[`docs/`](docs/README.md) and delete them here. `scripts/e2e.sh` belongs to this
file — it is the hermetic runner for this suite. Findings about CI or the stack as
a whole go in [`../INSIGHTS.md`](../INSIGHTS.md).

---

## Decisions

## What Works

## What Doesn't Work

- **2026-09-17** — Plain `npm test` against a dev DB fails the flows that enter at
  `{BASE}/`: they follow the home redirect to the *first* repo and assume the
  seeded demo repo is the only one. Four of the seven flows do this. Use
  `npm run e2e:hermetic`, which seeds an isolated stack instead.
  `specs/01-app-boot.flow.json`, `specs/02-repo-pulls-detail.flow.json`,
  `specs/04-pr-findings.flow.json`, `specs/05-pr-diff.flow.json`

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Open Questions
