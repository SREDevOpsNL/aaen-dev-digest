# L02 conventions extraction: unpaid preflight and authorization design

**Status:** implementation under verification. This document authorizes no paid
request. Criteria 38 and 40 remain Implemented until a separately authorized
real extraction, candidate evidence, database read-back and restart are shown.

## Separate public-repository stack

`scripts/e2e.sh --serve --conventions` creates a new loopback-only,
labelled, disposable Postgres/API/UI stack and seeds only the local
workspace/user/settings. It does not add the demo repository, PR #3,
experiment PRs #501/#502 or synthetic candidates. Existing `--serve` and
hermetic browser behavior are unchanged.

The sole allowed source is `fastify/fastify` at
`5df959f3af698823dd582f1c3661f3e80df0b5da`. Import it via the existing
`POST /repos` path, wait for clone/index jobs, check out that exact commit in
the **new stack's** clone, then call
`POST /experiments/conventions/index` with its repository ID. This free
endpoint indexes the pinned local checkout without fetching moving upstream
HEAD. The experiment spend guard blocks ordinary model calls, and embeddings
must be disabled. A free `preview-conventions` then verifies the index,
sampled files, model selection, complete request fingerprint and worst-case
cost. Do not call the extraction endpoint before the owner approves spending.

The runner checks loopback ports, exact stack/database labels, Docker container
identity, the PostgreSQL cluster identifier reported by both the API
connection and the intended container, isolated clone path, sole repository,
absence of demo PR #3, frozen source revision, embeddings disabled and
dedicated key path. The server independently checks the database name and
cluster identifier against the capability before a model request.

## One-use authorization and receipt

A version-2 capability names `conventions.extract` and binds the stack,
database/cluster, workspace, repository, source commit, implementation and
sample/index fingerprints, exact OpenRouter request body and execution policy,
model, one upstream provider, budget reservation, ceiling and 15-minute expiry.
Version-1 review capabilities are rejected. The configured Conventions model
is resolved normally and must match the capability; the grant cannot override
Settings.

After separate approval, the CLI's `authorize-conventions` command uses the
same `authorize.lock`, global ledger, budget caps, key-usage reading and
authorization log as review experiments. The token is stored privately and
never printed. `run-conventions` re-previews all inputs, acquires the global
runner lock, reserves durably, then makes **one** synchronous extraction POST.
The existing OpenRouter experiment mode enforces zero SDK retries, zero schema
reprompts, one provider, fallbacks off and attempt telemetry. A durable receipt
is claimed exclusively and fsynced before dispatch, with later dispatch,
attempt, parsed model-result and persistence events. A 4xx after dispatch is never presumed free.

The runner classifies the receipt and reads back pending candidate IDs and a
digest through the API. Unknown cost, absent or conflicting provenance,
multiple attempts, incomplete persistence or a crash retains the full
reservation and is not accepted as verified extraction evidence. Reconciliation
never resends a request. Provider key usage must still be settled through the
existing `settle` command. Normal application extraction behavior outside
experiment mode is unchanged.

## Unpaid disposable-stack preflight (2026-10-27)

A separate stack `hw2f-0abf2c75` used loopback API/UI ports 3261/3260
and disposable Postgres port 5451. Identity-only seeding left the repository
and PR tables empty. The existing import path cloned only `fastify/fastify`
at the pinned commit; the index reported `full`, 298 files and the same
revision. The configured Conventions model was set through disposable
Settings, not overridden by the capability.

The actual frozen sample's conservative complete-request input bound was
**96,446 tokens**, with a 4,000-token output cap. Free endpoint metadata and
the frozen price ceiling yielded **$0.01410021 worst case** with the existing
1.5× contingency. A $0.005 extraction reservation failed preflight as it
should; **$0.020 passed** the additional 20% reservation-margin check.
The exact request hash was
`68d0ee227f6ec42bee14ee0df6d676cbf96ba9af8f2cc155d4d0b0c274a906e6`
and the implementation fingerprint was
`a52cafc5727ca6eb07b2de5d43b9bcfce1fedfc246a21eb21760bed53d4390ac`.
These hashes describe the initial free preview at local commit `6ffc7cd`;
the later removal of an unused receipt-read API changes the source
fingerprint. The committed implementation after that removal has fingerprint
`c3ae06435ae25cad8c2059e84ff1c296d2350d12273b58e1ef2ad7f246bd7ef1`.
These are evidence for the tested design, not a future spending approval.
The study proposal's $0.005 **review-trial** reservation is a different
request and is still provisional.

The complete `preview-conventions` CLI passed its container labels,
PostgreSQL cluster identity, repository/revision, model, endpoint, fingerprint
and budget checks with `problems: []`. Calling the extraction endpoint
without a capability returned HTTP 403 and created no extraction receipt.
No capability, ledger slot or provider generation was created. This stack was
then torn down; the earlier evidence container remained running. A future
approved run must repeat the preflight on its own fresh stack and cannot reuse
this short-lived preview or request hash without matching every bound input.

## Evidence procedure after a separately approved extraction

The paid operation is the existing `POST /repos/:id/conventions/extract`
endpoint, invoked once by `run-conventions` after its one-use reservation.
Its response contains `proposed`, `dropped_ungrounded`,
`dropped_duplicate`, model, cost and the current candidate DTOs. Keep the
private receipt's `model_result` event (the actual parsed structured model
output) distinct from the grounded candidate rows. Do not publish the full
private response or receipt without sanitizing it.

For **#38**, capture the terminal ledger/receipt state and the API candidate
list from `GET /repos/:id/conventions`. Read the same `id`, `category`,
`rule`, `evidence_path`, `evidence_line`, `confidence` and `status`
columns from the isolated database's `conventions` table, filtered by both
workspace and repository ID. Compare IDs and field values, not merely row
counts. After the extraction is terminal and the global runner lock and
in-flight gate are clear, send `SIGUSR1` to the **new conventions harness
process printed at startup**. Only `--serve --conventions` handles this
signal: it checks the ledger and gate, stops its API child, starts a new API
child on the same loopback port and retains the disposable PostgreSQL
container. Verify that the API process changed, the stack/database/cluster
identity did not, and the same candidate IDs and values remain in API and
SQL read-back. Do not restart during an unresolved or in-flight slot.

For **#40**, compare every raw `model_result.candidates[]` item against
the `ExtractionSchema` fields `category`, `rule`, `evidence_path`,
`evidence_line` and `confidence`. Then compare it with the persisted
grounded projection, including the source-snippet verification and any
corrected line number. Record the `proposed`, `dropped_ungrounded` and
`dropped_duplicate` counts. Empty output, invalid schema, absent provider
provenance, or only ungrounded candidates must be reported as such and cannot
automatically verify #38 or #40. A successful HTTP response by itself is
insufficient.

If the API response is lost after dispatch, consult the private receipt and
provider billing evidence. Reconciliation never replays the slot; unknown
cost retains the full reservation. Sanitize IDs, prompts and model text before
adding evidence to the public PR.

## Fresh final unpaid preflight (2026-10-27)

The current stack is `hw2f-0671292f` on loopback API/UI
`127.0.0.1:3261/3260` and disposable PostgreSQL `127.0.0.1:5451`.
Its database is `devdigest_hw2f_0671292f`; the API and intended labelled
container reported the same PostgreSQL system identifier
`7701259158859145256`. The only repository is `fastify/fastify`,
repository ID `d30c77d4-9dcf-4ee6-94ad-fdb018a38ad6`, in workspace
`c82995b6-f142-4452-9670-61c54b120d0c`. The clone is clean at
`5df959f3af698823dd582f1c3661f3e80df0b5da`; its full index has
298 files and exactly that last-indexed SHA. Embeddings are disabled and
demo PR #3 is absent.

The free preview disclosed 16 sampled paths: `package.json`,
`eslint.config.js`, `.editorconfig`, `CONTRIBUTING.md`, `fastify.js`,
`lib/symbols.js`, `lib/errors.js`, `lib/decorate.js`, `lib/hooks.js`,
`lib/request.js`, `test/helper.js`, `lib/reply.js`, `lib/schemas.js`,
`lib/content-type.js`, `lib/logger-factory.js` and
`lib/error-handler.js`. The ranked indexed-path hash is
`c4a111c8547467b770c987f6a3f5dec833f64607893fe73aebb37638074d2c10`;
the sampled contents hash is
`d8ecd16c8a7d1a15c527f6de7b13aae4f3f651a15b075623d04043f9531c6134`.

The configured Conventions choice is OpenRouter
`deepseek/deepseek-v4-flash`, routed only to `deepinfra/fp8`, expected
`DeepInfra` and served model
`deepseek/deepseek-v4-flash-20260423`. Live free endpoint metadata
reported 1,048,576 context tokens, 65,536 maximum completion tokens, and
$0.00000009/input token plus $0.00000018/output token with no request fee.
The request's conservative input bound is 96,446 tokens, output cap 4,000,
single attempt, no retries and no fallback. Its worst case is
`(96,446 × 0.00000009 + 4,000 × 0.00000018) × 1.5 = $0.01410021`;
the additional 20% reservation check gives $0.016920252. A **$0.020**
reservation passes with `problems: []`.

The unused slot proposed for approval is
`conv-fastify-20261027-4bff6e22`. The exact complete-request fingerprint
is `38d6b12f9ffb083846d2fb99e5f43b34bd7afb8d434416e2e6391c79edb83459`;
the current committed implementation fingerprint is
`bb86345330722b063e8590b1f85e7480a5888d26844f7af933eb36b798970016`.
These bindings must be rechecked immediately before any future dispatch.

The global ledger held seven terminal slots, no unresolved slot, and a
conservative charge of $0.01116289; neither global lock existed and no
active capability file existed. The dedicated key's free usage endpoint
reported usage $0.00157077 of a $2.00 hard limit, leaving $1.99842923.
A single $0.020 extraction reservation would bring the proposed cumulative
ceiling to **$0.03116289**, within the $0.50 exploration and $1.50 aggregate
caps. This is a proposal, not permission to issue a capability.

The conventions-only `SIGUSR1` restart path was tested without a model call:
API PID 1615779 was replaced by 1619344 while the PostgreSQL cluster ID,
one persisted repository, model setting and 298-file index remained unchanged.
There were zero convention rows, so this proves the restart mechanism only,
not criterion 38's candidate persistence. An extraction call without a
capability returned HTTP 403 and made no receipt. The fresh stack remains
running for the owner's decision; no capability or paid generation exists.

## Required approval and outstanding evidence

Before any paid run, the owner must approve the exact one-use operation,
repository, request fingerprint, model, upstream provider, reservation, USD
ceiling and expiry. Generate a fresh unused slot ID; never reuse an earlier
review slot or capability. Recheck live endpoint prices, key limit and global
ledger, then preserve the raw model response, attempt telemetry, sanitized
receipt, candidate rows and post-restart read-back. Missing or conflicting
provider metadata remains unverified.

The current work is confined to an isolated implementation checkout. No paid
call or new extraction result has been produced.
