# Learnings — e2e

Browser-suite guidance maintained by
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md). Apply
it unless current source contradicts it; then trust the source and add a dated
correction. `scripts/e2e.sh` belongs here; CI and other
cross-package findings belong in [`../LEARNINGS.md`](../LEARNINGS.md).

---

## What Works

## What Doesn't Work

- **2026-09-17** — Plain `npm test` against a dev DB fails the flows that enter at
  `{BASE}/`: they follow the home redirect to the *first* repo and assume the
  seeded demo repo is the only one. Four of the seven flows do this. Use
  `npm run e2e:hermetic`, which seeds an isolated stack instead. Evidence:
  `e2e/specs/01-app-boot.flow.json`,
  `e2e/specs/02-repo-pulls-detail.flow.json`,
  `e2e/specs/04-pr-findings.flow.json`,
  `e2e/specs/05-pr-diff.flow.json`

## Codebase Patterns & Tool / Library Notes

- **2026-10-17** — `agent-browser drag <src> <tgt>` cannot exercise native
  HTML5 drag-and-drop in headless Chromium: it reported success, but no
  `dragover`/`drop` reached the page and no save request followed. It sends
  plain mouse events; Chromium starts an HTML5 drag only through the CDP drag
  API (`Input.dispatchDragEvent`), which this binary does not use. To check
  `draggable` handlers in a real browser, dispatch them with `eval`: a
  `dragstart` `DragEvent` carrying a real `new DataTransfer()` on the source,
  then `dragover` and `drop` on the target, and assert both were
  `defaultPrevented`. That proved the Agent Skills reorder (save request, order
  kept after reload). It is not a pointer drag, so keep an OS-level drag on the
  manual checklist. Evidence: PR #19 description (temporary flow on the
  hermetic stack, not committed);
  `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab.tsx`.

- **2026-10-17** — The seed creates no `agent_runs` and no `run_traces`: PR
  #482's seeded review and findings have no run behind them. Run-trace UI (the
  Prompt assembly blocks, Skills token count) therefore cannot be asserted from
  seeded data in a read-only flow. Cover it with component tests and a MockLLM
  server test, or seed a run deliberately, which also adds it to the PR
  timeline that flows 02 and 04 read. Evidence: `server/src/db/seed.ts`
  (PR #482 block: `reviews` and `findings` inserts only).

## Decisions

## Recurring Errors & Fixes

- **2026-10-14** — `agent-browser wait --text` matches the rendered text after
  CSS `text-transform`, case-sensitively: `wait --text "Author claims"` never
  matches a heading styled `uppercase` (only "AUTHOR CLAIMS" does).
  `SectionLabel` and `SeverityBadge` in `@devdigest/ui` uppercase their text. A
  substring wait can also pass on transient text — "PR intent" matched the
  card's loading line "Deriving PR intent…", not its uppercased label. Assert
  on unstyled content that only appears once data has loaded. Evidence: a local
  probe page (lowercase query: no match; uppercase: match), and
  `e2e/specs/10-pr-intent.flow.json`.

## Session Notes

## Open Questions
