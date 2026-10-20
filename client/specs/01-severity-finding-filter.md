# Severity Finding Filter

**Status:** shipped

## Problem

Review runs can contain findings at several severities, but the PR detail page
does not summarize that distribution or let a reviewer focus on one severity.

## Route(s)

- `/repos/:repoId/pulls/:number?tab=findings`

## Data

Use the findings already returned by the PR reviews hook. The counters and
filter are client-side presentation behavior and must not add an API or model
call.

## States

- Render one counter for each severity with a non-zero count, ordered Critical,
  Warning, Suggestion.
- With no active severity, show findings from every severity.
- Selecting a severity shows only findings of that severity; selecting it again
  restores all severities.
- Severity and low-confidence filters combine when both are active.
- If the combined filters match nothing, show the existing no-match state.

## Timeline and PR-list preview

The L01 lab design (`prdetail_runs.jsx` `RunFindings` + `FindingsTooltip`, and
the same tooltip in `screen_dashboard.jsx`) also puts the counts on each
settled Timeline run tile and on each PR-list row:

- Show one severity-colored icon and count per non-zero severity in place of
  the "N finding(s)" total, followed by the blocker count.
- Hovering or focusing the counts opens a read-only preview: severity, title,
  category, `file:line`, confidence, and a short description. It has no
  Accept/Reject controls.
  - On a Timeline tile it reads "N FINDINGS IN THIS RUN".
  - On a PR-list row it reads "N FINDINGS IN LATEST AGENT RUNS" and names each
    finding's agent, or "Unknown agent".
- The preview stays open while its list scrolls by wheel, scrollbar, or keyboard,
  and while focus moves into the list. It closes when the pointer or focus
  leaves both the counts and the card, or when the page scrolls.
- The Timeline preview uses the findings of that run from the reviews already
  loaded for Review runs.
- The PR list uses the list response: since the 2026-10-20 mentor follow-up,
  that is each agent's latest successful run
  ([server spec](../../server/specs/01-pr-list-review-summary.md)), no longer
  only the newest review.
- Neither preview adds a request or a model call. Behaviour detail:
  [`../docs/findings-preview.md`](../docs/findings-preview.md).

## Copy

Add severity-filter labels under `messages/en/prReview.json`.

## Acceptance criteria

- Counters match the run's findings.
- Each counter is keyboard-accessible and exposes its selected state.
- Clicking a counter filters the visible finding cards without a network or
  model call.
- Timeline run tiles and PR-list rows show severity counts whose preview lists
  exactly the findings counted.
- Client type-checking, component tests, and the seeded browser journey pass.
