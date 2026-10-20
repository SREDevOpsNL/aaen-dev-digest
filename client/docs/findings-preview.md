# Findings preview

`FindingsPreview`
([`src/app/repos/[repoId]/pulls/_components/FindingsPreview/`](../src/app/repos/[repoId]/pulls/_components/FindingsPreview/FindingsPreview.tsx))
renders per-severity counts and, on hover or keyboard focus, a read-only card
listing the findings behind them. The PR list and the PR Timeline both use it,
so any behaviour change lands in both places.

## Props

| Prop | Meaning |
| --- | --- |
| `counts` | Findings per severity. Zero and missing severities are hidden; with none at all the component renders nothing. |
| `items` | The findings behind the counts (`PreviewFinding`, `constants.ts`). With none, the counts render but nothing opens and the counts are not focusable. |
| `align` | Which edge of the counts the card aligns to: `left` in the Timeline, `right` in the PR list. |
| `scope` | `"run"` (default): "N FINDINGS IN THIS RUN". `"latestAgentRuns"`: "N FINDINGS IN LATEST AGENT RUNS", and each item names its agent (`agent_name`, or "Unknown agent" when null). |

## Who uses it

| Caller | `scope` | `items` come from |
| --- | --- | --- |
| `PRRow` (PR list, FINDINGS column) | `latestAgentRuns` | `finding_previews` in the list response: each agent's latest successful run, already bounded by the server ([server doc](../../server/docs/pr-list-summary.md)). |
| `RunHistory` (PR detail, Timeline run tile) | `run` | That run's findings from the reviews already loaded for Review runs (`FindingsTab`'s `findingsByRun`). No extra request. |

Neither caller triggers a request or a model call to open the card.

## Placement

The card is `position: fixed`, because the PR-list table clips absolutely
positioned children. `tooltipPosition` (`helpers.ts:17`) computes it from the
counts' bounding rectangle:

- **Vertical:** it opens below, unless there is less than `TOOLTIP_MAX_HEIGHT`
  (360px) of room below and more room above.
- **Horizontal:** it is 360px wide and clamped 8px inside the viewport.
- **Gap:** the 8px gap to the counts is the card frame's padding, so the
  pointer can cross it without leaving the card.
- **Overflow:** the findings list scrolls past 300px (`styles.ts:60`).

## When it opens and closes

The counts element (`role="group"`) and the card form **one interactive
region**:

| Event | Result |
| --- | --- |
| Pointer enters the counts | Opens (`onMouseEnter`). |
| Pointer moves from the counts into the card | Stays open: the card is a DOM child of the counts, so no `mouseleave` fires. |
| Pointer leaves both | Closes (`onMouseLeave`). |
| Keyboard focus on the counts | Opens (`onFocus`). |
| Tab from the counts into the findings list | Stays open. Browsers make a scroller with no focusable children a tab stop; `onBlur` closes only when `relatedTarget` is outside the region (`FindingsPreview.tsx:81`). |
| Focus leaves the region | Closes. |
| Wheel, scrollbar drag, or keyboard scroll **inside** the list | Stays open. |
| The page or any other container scrolls | Closes. A fixed card would otherwise detach from its counts. |
| A click inside the region | Never reaches the row behind it (`stopPropagation`), so the PR list does not navigate. |

**Scroll filter.** The scroll listener is registered in the **capture** phase
on `window`, so it hears scroll events from every element. That includes the
card's own list: `scroll` does not bubble, but capture still reaches `window`.
The listener therefore ignores events whose target is inside the card
(`FindingsPreview.tsx:52`). The studio scrolls inside `<main>`, not the window,
which is why the listener cannot be a plain window scroll listener.

## Accessibility

- **The counts** are a `role="group"` labelled with the summary, for example
  "Findings: 3 CRITICAL, 2 WARNING". They are focusable only when there is a
  card to show.
- **The card** is `role="tooltip"`, referenced by `aria-describedby` while
  open.
- **No controls:** the card has no buttons, and no `title` attributes that
  would expose the full rationale.
- **Descriptions** are whitespace-collapsed and cut to 180 characters
  (`shortFindingDescription`).

## Tests

- **Component tests** (`FindingsPreview.test.tsx`, plus `PRRow.test.tsx` and
  `RunHistory.test.tsx` for the two callers):
  - hover and focus;
  - the pointer and focus region;
  - in-list scroll versus page and `<main>` scroll;
  - scope headings and agent names.
- **Placement** (`helpers.test.ts`): `tooltipPosition`.
- **Browser** (`e2e/specs/07a-findings-preview-scroll.flow.json`): a real
  scrollbar drag, an in-place list scroll, and keyboard PageDown in the
  Timeline, plus pointer-leave, Tab-out, and page-scroll dismissal. jsdom cannot
  prove these.
