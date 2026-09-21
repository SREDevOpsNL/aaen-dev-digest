# Engineering Insights

This compatibility file exists for course material that still refers to
`INSIGHTS.md`. DevDigest now keeps its authoritative engineering-insights log
in [`LEARNINGS.md`](LEARNINGS.md) and the package-specific `LEARNINGS.md`
files linked from it.

## Session entries

- **2026-09-21 — L01 severity-filter homework.** Severity counters and filtering
  were implemented entirely in the client over findings already loaded for each
  review run, so verification required no model call. Final implementation and
  verification ran in the authoritative Ubuntu 24.04 WSL2 checkout: typechecks,
  54 unit tests, the production build, and all 7 hermetic browser flows passed.
  The hermetic run used persisted seed data without GitHub or OpenRouter
  credentials, providing direct evidence that the feature added no model call.
  The environment correction is recorded in [`LEARNINGS.md`](LEARNINGS.md) and
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes).
