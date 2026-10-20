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

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
