# Engineering Insights

## What Works

- **2026-09-28** — Run-scoped severity filters derive counts from already loaded findings and update only client state. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts:5`.

## What Doesn't Work

## Codebase Patterns & Tool / Library Notes

## Decisions

## Recurring Errors & Fixes
- **2026-09-28** — L01 requires both clickable run-scoped severity count buttons and a separate Critical/Warning/Suggestion filter row. Keep both controls on the same severity state and toggle handler. Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:75 (FindingsPanel), e2e/specs/04-pr-findings.flow.json:17.


## Session Notes

## Open Questions
