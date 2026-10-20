# Seed and flows

What the seeded database guarantees, and which flow depends on which part of
it. Read this before changing [`server/src/db/seed.ts`](../../server/src/db/seed.ts)
or adding a flow. The seed is described from the server side in
[server architecture](../../server/docs/architecture.md#data-migrations-and-seed).

## What the seed provides

| Row(s) | Values the flows rely on |
| --- | --- |
| Workspace, system user, settings | The default workspace, which every API call resolves to. |
| Repository | `acme/payments-api`, the **only** repository in a fresh database. |
| Pull request | #482 "Add rate limiting to public API endpoints", status `needs_review`, so it is visible under the PR list's default filter. |
| PR files | `src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`, `src/config.ts`, `src/api/users.ts`. |
| PR commit | `a1b2c3d…` "Add token-bucket rate limiter". |
| Review | Verdict `request_changes`, score 61. Two findings: CRITICAL "Hardcoded Stripe secret key in commit" and WARNING "N+1 query in user list endpoint". |
| Agents | General Reviewer, Security Reviewer, and Performance Reviewer, all enabled. |

**What the seed does *not* provide.** The sample review has **no `run_id`**,
and there are no `agent_runs` rows. As a result:

- **Agent runs tab:** Review runs shows the review, but the Timeline has no run
  tile.
- **PR list:** Score, Cost, and FINDINGS stay empty, because they read only
  successful runs.

A flow that needs a run must supply one without writing to the database (see
`07a` below).

## Flow dependencies

| Flow | Enters at | Depends on |
| --- | --- | --- |
| `01-app-boot` | `{BASE}/` | The redirect to the **first** repository, and the "Pull Requests" heading. |
| `02-repo-pulls-detail` | `{BASE}/` | PR #482's title in the list, and its detail route. |
| `03-agents` | `{BASE}/agents` | The seeded "Security Reviewer" agent. |
| `04-pr-findings` | `{BASE}/` | The sample review: "request changes", "2 findings", the 1 CRITICAL and 1 WARNING counters, and both finding titles. |
| `05-pr-diff` | `{BASE}/` | PR #482's files, in particular `src/config.ts`. |
| `06-onboarding` | `{BASE}/onboarding` | None (the static form). |
| `07-settings` | `{BASE}/settings/api-keys` | None (the section titles). |
| `07a-findings-preview-scroll` | `{BASE}/` | PR #482, plus a **stubbed** run (below). |

**First-repository assumption.** Five flows enter at `{BASE}/` and follow the
home redirect to the **first** repository. A database with other imported
repositories, such as a dev DB, sends them to the wrong place. Use
`npm run e2e:hermetic`, never `docker compose down -v`.

## Stubbed data in `07a`

`07a` needs a finished run with more findings than the 300px preview list can
show. The seed has no run, and flows must not write, so the flow's first `eval`
replaces `window.fetch` in that page. It answers exactly two read-only GETs
with fixed JSON:

- `/pulls/:id/runs`: one finished Security Reviewer run.
- `/pulls/:id/reviews`: its review, with 3 Critical and 2 Warning findings.

Every other request goes through to the real API. The stub survives the
client-side navigation into the PR. It does not survive the next flow's
`open`, which starts a fresh document.

The stub's payload must match `RunSummary` and `ReviewRecord` in
`server/src/vendor/shared/contracts/`. If those contracts change, update the
stub.

agent-browser's own `network route --body` is not used, because it did not
intercept these calls; see [`../LEARNINGS.md`](../LEARNINGS.md).

## Changing the seed

- **Before changing a value**, search `e2e/specs/` for it: the table above
  shows which flows assert seeded text.
- **Prefer adding** rows (a new PR or repository) **to changing** existing ones.
  But a second repository would break the five flows that rely on the
  first-repository redirect.
- **Seeding a completed run** would change the PR list, the Timeline, and
  which Review-runs accordion opens first for #482. Flow `04` asserts the
  newest accordion's verdict and counts; `07a` matches the Timeline counters by
  their aria-label. Recheck both.
