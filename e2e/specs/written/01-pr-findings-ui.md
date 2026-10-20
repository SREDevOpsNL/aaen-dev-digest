# PR findings journey

**Status:** shipped. The flow file is the living spec; this page explains what
it proves and what it assumes.

## Journey

1. Open the app root, follow the redirect to the first repository's PR list,
   and open PR #482.
2. Switch to the **Agent runs** tab (`?tab=findings`).
3. Read the newest review run, which is open by default: its verdict, finding
   count, and per-severity counters.
4. Click **1 WARNING**: only the Warning finding remains.
5. Click **1 WARNING** again: the filter clears and the Critical finding
   returns.

Every step uses data that is already loaded. Filtering is client-side, with no
request and no model call.

## Seed dependencies

All of these come from `server/src/db/seed.ts`; see
[seed and flows](../../docs/seed-and-flows.md):

- `acme/payments-api` is the only repository, so the home redirect lands on it.
- PR #482 "Add rate limiting to public API endpoints".
- Its sample review: `request_changes`, with two findings:
  - CRITICAL "Hardcoded Stripe secret key in commit";
  - WARNING "N+1 query in user list endpoint".

## Assertions

| Check | Command |
| --- | --- |
| Lands on the list | `wait --url /pulls` |
| Detail route and tab | `wait --url /pulls/482`, then `wait --url tab=findings` |
| Run header | `wait --text "request changes"`, `wait --text "2 findings"` |
| Counters | `wait --text "1 CRITICAL"`, `wait --text "1 WARNING"` |
| Filter on | Click `1 WARNING`, then `wait --text "N+1 query in user list endpoint"`. Then `eval` that the Critical title is absent (`stdoutIncludes: "false"`). |
| Filter off | Click `1 WARNING` again, then `wait --text "Hardcoded Stripe secret key in commit"`. |

## Not covered here

- **The run-trace drawer:** a seeded review has no run, so there is no trace to
  open.
- **The Timeline findings preview:** covered by `07a`, with a stubbed run.

## Flow file

[`../04-pr-findings.flow.json`](../04-pr-findings.flow.json)
