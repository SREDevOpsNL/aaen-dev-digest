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
fingerprint. They are evidence for the tested design, not a future spending
approval.
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
