# Lab 01 / Homework 01 workflow

## Initiation — completed

The Homework 01 acceptance table and the WSL-native delivery environment were
identified before implementation. The environment boundary is recorded in
[CLAUDE.md](../../CLAUDE.md#authoritative-development-environment), including
the requirement to deliver from a WSL worktree.

## Planning — completed

The implementation separated persisted run-cost handling, PR-list presentation,
run-scoped findings, Engineering Insights routing, and package documentation.
The resulting repository contract is documented in
[server/specs/01-pr-list-review-summary.md](../../server/specs/01-pr-list-review-summary.md)
and the client behavior in
[client/specs/01-severity-finding-filter.md](../../client/specs/01-severity-finding-filter.md).

## Implementation — completed

The implementation through the review-hardening pass is recorded in commits
546e76d, 1e58709, db29677, ffdcaad, 8b43084, and 1b5f0c5; the final hook
correction and evidence refresh are recorded in this document's commit. The
executable evidence is the PR-list route
[server/src/modules/pulls/routes.ts](../../server/src/modules/pulls/routes.ts),
the Review-runs controls
[client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx),
and the PR-list popup
[client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx](../../client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx).

## Validation — completed

The final WSL validation ran client lint, typecheck, and tests; server
typecheck plus unit and database-backed tests; reviewer-core typecheck and
tests; E2E typecheck; and canonical npm run e2e:hermetic. The browser suite
completed all seven flows, including unchanged
[e2e/specs/04-pr-findings.flow.json](../../e2e/specs/04-pr-findings.flow.json).

## Completion — completed

The final review included git diff --check, a clean worktree, and an
acceptance audit against the 24 mandatory Homework 01 criteria. That audit
covered ffdcaada348a92ba6b3ea3dfbcb46371d96393cb; subsequent review hardening
continued through 1b5f0c582a44245e81e23bcb343e5a61b781cfb9 and this document's
commit. Git history is authoritative for the current submitted head, avoiding a
self-referential SHA that becomes stale whenever this evidence is corrected.
