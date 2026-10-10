# Learnings — client

UI-specific guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. Genuinely cross-package findings belong in
[`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-17** — The Settings field `polling_interval_min` does not control the
  PR-list refetch. It exists in the platform contract and the seed, but the hook
  hard-codes a 60-second interval, so changing the setting appears to do nothing.
  Wire the setting through before treating it as functional. Evidence:
  `client/src/lib/hooks/core.ts:109` (`usePulls`),
  `client/src/vendor/shared/contracts/platform.ts:88` (`SettingsKnown`),
  `server/src/db/seed.ts:61` (`seed`)

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes

- **2026-09-28** — L01 requires both clickable run-scoped severity count buttons
  and a separate Critical/Warning/Suggestion filter row. Disabling the count
  buttons in `546e76d` made Flow 04's `1 WARNING` click a no-op while the
  separate filter still worked. Keep both controls on the same severity state
  and toggle handler, and test their synchronized pressed states. Evidence:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:75`
  (`FindingsPanel`), `e2e/specs/04-pr-findings.flow.json:17`.

## Session Notes

## Open Questions
