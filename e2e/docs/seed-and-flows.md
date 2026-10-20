# Seed and flows

What the seeded database guarantees, and which flow depends on which part of
it. Read this before changing [`server/src/db/seed.ts`](../../server/src/db/seed.ts)
or adding a flow. The seed is described from the server side in
[server architecture](../../server/docs/architecture.md#data-migrations-and-seed).

## What the seed provides

Both the hermetic runner and CI seed with `DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1`,
into a disposable `devdigest_e2e` database.

| Row(s) | Values the flows rely on |
| --- | --- |
| Workspace, system user, settings | The default workspace, which every API call resolves to. |
| Repository | `acme/payments-api`, the **only** repository in a fresh database. |
| Pull request #482 | "Add rate limiting to public API endpoints", status `needs_review`, so it is visible under the PR list's default filter. |
| PR #482 files and commit | `src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`, `src/config.ts`, `src/api/users.ts`; commit `a1b2c3d…` "Add token-bucket rate limiter". |
| PR #482 review | Verdict `request_changes`, score 61. Two findings: CRITICAL "Hardcoded Stripe secret key in commit" and WARNING "N+1 query in user list endpoint". |
| PR #482 intent | A fresh cached intent ("Adds a token-bucket rate limiter…", medium confidence, derived with `seed`), so opening the PR derives nothing. |
| Fixture PRs | #501 "Add coupon discounts to checkout totals" and #502 "Return payment amounts as decimal strings". Each has files, a commit, and a fresh intent, and **no** reviews or runs. |
| Agents | General, Security, Performance, Test Quality, and API Contract Reviewer, all enabled, each with a version. |
| Skills | **Test Quality Reviewer** links four: Behavioral Coverage, Assertion Quality, Edge Cases and Error Paths, Test Isolation and Determinism. **API Contract Reviewer** links three: `breaking-change`, `response-schema`, `semver-discipline`. The import-only `deprecation-policy` is not seeded. |

**What the seed does *not* provide.** No review has a `run_id`, and there are
no `agent_runs` rows. As a result:

- **Agent runs tab:** Review runs shows the sample review, but the Timeline has
  no run tile.
- **PR list:** Score, Cost, and FINDINGS stay empty for every PR, because they
  read only successful runs.
- **Conventions:** none exist, so the Conventions page shows its empty state.
  Synthetic conventions are seeded only by `scripts/e2e.sh --serve`.

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
| `08-skills` | `{BASE}/skills` | The Test Quality skills and agent. |
| `09-conventions` | `{BASE}/` | The repository shell, and **no** conventions (empty state, Run Scan). |
| `10-pr-intent` | `{BASE}/` | PR #482's seeded fresh intent. |
| `11-skills-lab` | `{BASE}/skills` | The seeded skills. Delete confirmations open, but nothing is deleted. |
| `12-agent-skills` | `{BASE}/agents` | Test Quality Reviewer's four linked skills ("4 / 4 attached"). |
| `13-api-contract` | `{BASE}/agents` | API Contract Reviewer's three skills ("3 / 4 attached"), plus fixture PRs #501 and #502. |
| `14-agent-skill-count` | `{BASE}/agents` | The linked-skill counts ("3 skills", "4 skills"). |

**First-repository assumption.** Seven flows enter at `{BASE}/` and follow the
home redirect to the **first** repository: `01`, `02`, `04`, `05`, `07a`, `09`,
and `10`. A database with other imported repositories, such as a dev DB, sends
them to the wrong place. Use `npm run e2e:hermetic`, never
`docker compose down -v`.

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
  shows which flows assert seeded text, and counts such as "4 / 4 attached" are
  asserted too.
- **Prefer adding** rows (a new PR) **to changing** existing ones. A second
  repository would break the seven flows that rely on the first-repository
  redirect.
- **Seeding a completed run** would change the PR list, the Timeline, and
  which Review-runs accordion opens first for #482. Flow `04` asserts the
  newest accordion's verdict and counts; `07a` matches the Timeline counters by
  their aria-label. Recheck both.
