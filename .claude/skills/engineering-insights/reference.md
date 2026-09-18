# Engineering Insights Reference

Read this reference only to calibrate an entry, resolve an ambiguous heading,
or perform a human-requested maintenance pass.

## Quality Calibration

Prefer a specific observation, consequence, action, and evidence over advice
that could apply to any repository. The useful examples below are hypothetical;
they demonstrate specificity and must not be copied as project facts.

- Vague: "Promises can be tricky."
- Useful: "The ingestion worker times out when `Promise.all()` receives more
  than 30 items; use `Promise.allSettled()` in batches of 10. Evidence:
  `packages/ingest/src/run.ts:84` (`runBatch`)."
- Vague: "Be careful with shared state."
- Useful: "Checkout state is shared by three components; update it only through
  the Zustand store so they cannot diverge. Evidence:
  `apps/store/src/cartStore.ts:42` (`useCartStore`)."

## Heading Guide

- `What Works`: a proven approach worth reusing.
- `What Doesn't Work`: a failed approach or antipattern and its consequence.
- `Codebase Patterns & Tool / Library Notes`: discovered conventions,
  architecture context, dependency behavior, and tool quirks.
- `Decisions`: a choice, its constraint or rationale, and the rejected option.
- `Recurring Errors & Fixes`: a repeatable symptom, cause, and resolution.
- `Session Notes`: durable context that fits no other heading; not a summary of
  entries already recorded elsewhere.
- `Open Questions`: unresolved facts or decisions for a future session.

## Human Maintenance

Normal capture remains additive. Schedule a human-reviewed maintenance pass
monthly and whenever a file approaches 200 entries or becomes hard to use:

1. Spot-check claims and evidence against current code before keeping them.
2. Merge duplicates, resolve conflicts, and remove stale or unsupported claims.
3. Promote stable reference material into `docs/` and required behavior into
   `specs/`, leaving links rather than copied guidance when useful.
4. Prune first. Split into human-chosen domain files only if the curated file is
   still too large, then update every routing instruction and link.
5. Review the maintenance diff and commit `LEARNINGS.md` with the repository.
