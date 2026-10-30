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

- **2026-10-23** — `next dev -p <port>` without `-H` listens on every
  interface (`*:<port>` in `ss`, dual-stack). An HW2 `--serve` stack therefore
  exposed its UI even where the API was meant to be local, and the UI's
  server side calls the API. With `-H 127.0.0.1`, the whole `next dev` process
  tree held exactly one listener, `127.0.0.1:<port>`. A request to the host's
  non-loopback address was refused, and `localhost` still answered: here
  `/etc/hosts` maps `localhost` to 127.0.0.1 only.

  Check a bind by reading the kernel's sockets (`ss -Hltn`, `/proc/net/tcp*`),
  not by the URL a client uses. Evidence: `scripts/e2e.sh`
  (`WEB_HOST_ARGS`, `assert_loopback_listeners`),
  `server/test/experiment-loopback.test.ts`; a probe of `next dev -H 127.0.0.1`
  on port 3298 (2026-10-22).

## Decisions

## Recurring Errors & Fixes

- **2026-10-30** — Do not run `scripts/e2e.sh` (hermetic) and an
  `e2e.sh --serve` stack from the same worktree at the same time, even on
  different ports. Both start `next dev` in the same `client/` directory and
  share `client/.next`, so one UI was built against the other stack's
  `NEXT_PUBLIC_API_BASE` (port 3201 instead of 3251), and the hermetic run
  failed two flows on `wait --url tab=config`. The same suite passed 14/14
  when run alone. Run them one after the other, or from separate worktrees.
  Evidence: `scripts/e2e.sh` (`NEXT_PUBLIC_API_BASE`, `next dev` in
  `client/`), the 2026-10-30 runs in `docs/homework/L02/TEST-RESULTS.md`.

## Session Notes

## Open Questions
