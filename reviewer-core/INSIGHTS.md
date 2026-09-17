# Insights — reviewer-core

Engine dead ends. Read before changing prompt assembly, grounding, or the reduce
step.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into
[`docs/`](docs/README.md) and delete them here. Anything that also constrains
`server/` belongs in [`../INSIGHTS.md`](../INSIGHTS.md).

---

## Decisions

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-09-17** — A map-reduce run records one `PromptAssembly` — the whole-diff
  assembly — not the exact prompt of each per-file call. The trace is therefore
  representative, not a replayable log: do not debug a per-file prompt by reading
  the stored assembly. `src/review/run.ts:104-105,142`

## Tool & Library Notes

## Recurring Errors & Fixes

## Open Questions
