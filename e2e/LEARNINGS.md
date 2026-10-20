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

- **2026-10-19** — In a fresh worktree, `npm run e2e:hermetic` boots the whole
  stack (Postgres, migrations, seed, API and web, about a minute) and only then
  fails with `sh: 1: tsx: not found`, exit 127, because `scripts/e2e.sh`
  installs dependencies only for `server` and `client`, never for `e2e/`. Run
  `npm ci` in `e2e/` first. Evidence: `scripts/e2e.sh:150-151`
  (`install_if_needed`); the run passed 13/13 after `npm ci`.

- **2026-10-20** — A `scripts/e2e.sh --serve` stack started as an agent's
  background task lives only as long as that agent session. When the session
  ended, the harness stopped the task, the script's exit trap removed the
  ephemeral Postgres container, and the walkthrough stack's database went with
  it (API unreachable, container gone, no change by the next session). Only
  `~/.devdigest/hw2-experiments/<stack-id>/` survives. Record evidence before a
  session ends. A stack whose data must outlive the session, such as the Gate 4
  stack whose trace row 19 reuses, should run in the operator's own terminal.
  Evidence: the session-end notice "Background shell command didn't finish
  before the previous session ended"; `docker ps` no longer listed
  `devdigest-hw2f-d5b65f48`; `scripts/e2e.sh` (`cleanup` trap,
  `docker rm -f`).

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

- **2026-10-19** — agent-browser 0.27.0 cannot express three things a pointer
  flow tends to need. `mouse wheel` always fires at (0,0), whatever `mouse move`
  set; a page log showed `wheel` on the sidebar `ASIDE` at `0,0`. `scroll
  --selector` calls `element.scrollBy`, which fires a real `scroll` event but no
  `wheel`. `network route --body` intercepted neither same-origin nor
  cross-origin `fetch`: `/health` still returned the real body. What works: an
  `eval` that replaces `window.fetch` after the first `open`. The app's soft
  navigation keeps it, and the next flow's `open` drops it. A real scrollbar
  drag needs static `mouse` coordinates, so pin the geometry first and add a
  `wait --fn` precondition that `elementFromPoint` hits the scroller's
  scrollbar. The studio scrolls `<main>`, not the window, and the PR header is
  sticky (432px tall at a 760px viewport), so it covers content scrolled to the
  top of `<main>`. Evidence: `e2e/specs/07a-findings-preview-scroll.flow.json:9`
  (fetch stub), `e2e/specs/07a-findings-preview-scroll.flow.json:28` (scrollbar
  drag).

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

- **2026-10-19** — agent-browser 0.27.0 can report success without doing
  anything:
  - `click @ref` on a button below the viewport printed `✓ Done` but fired no
    handler: a Save button at y = 799 in a 577 px viewport sent no request. It
    worked after `scrollIntoView`.
  - `fill <sel> ""` emptied the input without updating React state, so a list
    filter stayed applied. Clearing with key presses worked.

  Scroll the target into view before clicking, clear with keys, and check the
  effect (a request, a DB row or the rendered state), not the exit code.
  Evidence: `docs/plans/HW2-walkthrough-log.md` (Observations); a `fetch`
  wrapper recorded no request until the button was scrolled into view.

## Session Notes

## Open Questions
