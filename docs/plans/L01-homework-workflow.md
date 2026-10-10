# Lab 01 / Homework 01 workflow

## Initiation — completed

The Homework 01 acceptance table and the WSL-native delivery environment were
identified before implementation. The environment boundary is recorded in
[Agent environment](../ai-context/02_AGENT_ENVIRONMENT.md#canonical-execution-environment), including
the requirement to deliver from a WSL worktree.

## Planning — completed

The implementation separated persisted run-cost handling, PR-list presentation,
run-scoped findings, the Timeline findings preview, Engineering Insights
routing, and package documentation. The resulting repository contract is
documented in
[server/specs/01-pr-list-review-summary.md](../../server/specs/01-pr-list-review-summary.md),
the client behavior in
[client/specs/01-severity-finding-filter.md](../../client/specs/01-severity-finding-filter.md),
and the provider-cost contract in
[reviewer-core/specs/01-provider-cost.md](../../reviewer-core/specs/01-provider-cost.md).

## Implementation — completed

The branch was rebased onto `main` after the agent-instruction migration, so the
commit IDs below are the ones in the pull request's history.

| Commit | Scope |
| --- | --- |
| e20f471 | Severity counters and filter on each review run; E2E flow 04 extended to filter by Warning and clear the filter |
| 71887e9, 5f840d4, 307106f | WSL-native verification record and the reviewer prompt experiment |
| 20911de, a637350, bc02c3a | PR-list cost and findings indicators; module `INSIGHTS.md` files and Engineering Insights routing; clickable severity counters restored |
| 9b01797, cf18e8f, 5708bf3 | Acceptance gaps closed and evidence hardened: cost sums successful review runs, the PR-list popup is scoped to the newest completed review, client ESLint with the `pnpm lint` CI step, and the Claude Code `UserPromptSubmit` reminder hook |
| f94e24c | The reminder hook resolves its script through `${CLAUDE_PROJECT_DIR}` |
| ace2337 | Shared `FindingsPreview` on Timeline run tiles and PR-list rows; PR-list popup no longer clipped by the list container |
| 840a0ff, ed88f16, 55566bb, 69cf1d9 | Agent-neutral Engineering Insights wording, reconciled with the workflow on `main` |
| 839eb1d | Bound the PR-list findings query to the newest completed review for each PR |
| 0d16464 | Cover the no-successful-review PR-list response through the database-backed API test |

The executable evidence is the PR-list route
[server/src/modules/pulls/routes.ts](../../server/src/modules/pulls/routes.ts),
the Review-runs controls
[client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx),
the shared preview
[client/src/app/repos/[repoId]/pulls/_components/FindingsPreview/FindingsPreview.tsx](../../client/src/app/repos/[repoId]/pulls/_components/FindingsPreview/FindingsPreview.tsx),
the Timeline tiles
[client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx),
and the PR-list row
[client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx](../../client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx).

## Validation — completed

The final WSL validation ran client lint, typecheck, and tests; server
typecheck plus unit and database-backed tests; reviewer-core typecheck and
tests; E2E typecheck; and canonical `npm run e2e:hermetic`. The browser suite
completed all seven flows, including
[e2e/specs/04-pr-findings.flow.json](../../e2e/specs/04-pr-findings.flow.json),
which filters the seeded run by Warning, confirms the Critical finding is
hidden, and clears the filter. Current counts are reported in the pull request
description.

## Completion — completed

The final review included `git diff --check`, a clean worktree, and an
acceptance audit against the 24 mandatory Homework 01 criteria. That audit
covered the state at 9b01797. The Timeline half of the findings preview was a
gap found afterwards (see [client/INSIGHTS.md](../../client/INSIGHTS.md)) and
was closed in ace2337. Git history is authoritative for the current submitted
head, avoiding a self-referential SHA that becomes stale whenever this evidence
is corrected.
