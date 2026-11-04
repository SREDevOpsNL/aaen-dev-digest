# Live conventions extraction evidence — 2026-10-27

This is one owner-authorized paid extraction on an isolated stack. The complete
raw model response and attempt receipt remain private under
`~/.devdigest/hw2-experiments/conventions-receipts/`. This public summary
contains no key, capability token, raw router payload or private prompt.

## Authorization and pre-dispatch checks

| Bound value | Verified value |
| --- | --- |
| Operation and slot | `conventions.extract`, `conv-fastify-20261027-4bff6e22` |
| Stack / database / cluster | `hw2f-0671292f` / `devdigest_hw2f_0671292f` / `7701259158859145256` |
| Public repository / commit | `fastify/fastify` / `5df959f3af698823dd582f1c3661f3e80df0b5da` |
| Model / sole upstream | `deepseek/deepseek-v4-flash` / `deepinfra/fp8` |
| Request SHA-256 | `38d6b12f9ffb083846d2fb99e5f43b34bd7afb8d434416e2e6391c79edb83459` |
| Implementation fingerprint | `5541ac58d3e064246409b0fee48d156179baa9a5b123d34c1ba1b5cb27288764` |
| Reservation / ceiling | $0.020 / $0.03116289 |
| Request policy | one generation, SDK and structured retries zero, fallback disabled, 4,000 output-token cap |

The first pre-dispatch check found the extraction API stopped while its
PostgreSQL container was healthy. No capability or request was issued. The API
was restored against the same labelled disposable database, with no migration
or reseed. The owner then **renewed** the exact one-use authorization.
A free preview after a controlled API-only restart returned `ok: true`,
`problems: []` and the same hashes and cluster ID. The 16 sampled paths,
298-file index, clean pinned checkout, key balance, prices, limits, locks
and ledger were checked before issuance. The provider endpoint listed
1,048,576 context tokens and 65,536 maximum completion tokens at
$0.00000009/input and $0.00000018/output token. The conservative
96,446-input + 4,000-output bound was $0.01410021 with 1.5× contingency;
the additional 20% margin required $0.016920252, below the $0.020 reservation.
The dedicated key had $1.99842923 remaining; the ledger had seven terminal
slots, no unresolved slot, and $0.01116289 conservative charge.

## Criterion 40: actual structured model response

Exactly one guarded POST reached the existing
`POST /repos/:id/conventions/extract` application endpoint. Its private,
append-only receipt has `claimed → dispatching → model_finished →
model_result → persisted`, one attempt, HTTP 200, finish reason `stop`,
and a nonempty 7,580-byte raw response (SHA-256
`1f1ce9962343cb19af121f0babe918e77e8573431fb2ea6311423f1645ee6e8c`).
The parsed response has **12 candidates**, each with category, rule, evidence
path and line, and confidence. The selected router metadata and the generation
record both name **DeepInfra** and served model
`deepseek/deepseek-v4-flash-20260423`; the generation record shows one
provider response. The response and generation record report different token
figures (25,408/2,041 versus 23,481/1,931 prompt/completion); both report
the same $0.00265410 cost. The response ID was
`gen-1793128782-aZEeeiMFIQTvBEEoVDn9`. The token discrepancy is retained
rather than silently normalised.

| # | Category | Model-produced rule | Claimed evidence | Confidence | Persisted |
| --- | --- | --- | --- | ---: | --- |
| 1 | structure | All source files must begin with 'use strict'. | `fastify.js:1` | 0.95 | Yes |
| 2 | errors | Error codes must be defined using @fastify/error's createError() and grouped by feature area with JSDoc block comments. | `lib/errors.js:3` | 0.95 | No |
| 3 | structure | Internal state keys must be defined as Symbols in lib/symbols.js and imported via destructuring. | `lib/symbols.js:3` | 0.95 | No |
| 4 | structure | Constructor functions must have a static 'props' array and a static 'instanceProperties' Set. | `lib/request.js:42` | 0.90 | No |
| 5 | api | Decorator functions must check for existing decorators, dependencies, and that the instance has not started, throwing the appropriate FST_ERR_DEC_* error. | `lib/decorate.js:19` | 0.90 | No |
| 6 | api | Hooks must be defined as arrays on the Hooks prototype and validated via Hooks.prototype.validate before adding. | `lib/hooks.js:3` | 0.90 | No |
| 7 | testing | Tests must use node:test (t.test) and node:assert, and use fetch for HTTP requests. | `test/helper.js:48` | 0.90 | No |
| 8 | general | Content-Type parsing must use the ContentType class from lib/content-type.js, which caches results in a FifoMap. | `lib/content-type.js:74` | 0.90 | No |
| 9 | imports | Imports must use the 'node:' prefix for Node.js built-in modules. | `fastify.js:6` | 0.90 | No |
| 10 | structure | ESLint configuration must extend neostandard with ts:true, and override comma-dangle to 'never' and max-len to 120. | `eslint.config.js:4` | 0.95 | No |
| 11 | structure | Editor configuration must enforce LF line endings, final newline, 2-space indentation, and single quotes. | `.editorconfig:3` | 0.95 | No |
| 12 | api | Logger validation must check for the methods ['info','error','debug','fatal','warn','trace','child'] and throw FST_ERR_LOG_INVALID_LOGGER if missing. | `lib/logger-factory.js:67` | 0.90 | No |

The table is a sanitized projection of the actual parsed model response, not
a set of manually seeded candidates. It does **not** assert that the 11
unpersisted claims are true. The pre-run conventions table was empty, all
12 rules are distinct, and the service grounds each candidate before
deduplication (`server/src/modules/conventions/service.ts:118-130`).
Only one passed grounding; 11 were rejected rather than inserted. The
complete raw and parsed response remain in the private receipt for audit.

## Criterion 38: real run, persistence and API-only restart

The guarded runner returned
`Extraction slot conv-fastify-20261027-4bff6e22: completed; cost 0.0026541;
candidates 1`. Its receipt records the persisted candidate ID
`8816bf0f-b309-43fc-85d9-19652f646cbf` and digest
`157d826ba6ae174555bd02e853c0eddcd18993537c4e22600e05dbd2b2fa6d40`.
Before restart, both `GET /repos/d30c77d4-9dcf-4ee6-94ad-fdb018a38ad6/conventions`
and read-only SQL returned the same pending row:

```text
id:            8816bf0f-b309-43fc-85d9-19652f646cbf
category:      structure
rule:          All source files must begin with 'use strict'.
evidence:      fastify.js:1
confidence:    0.95
status:        pending
```

The pinned, clean Fastify checkout has `'use strict'` at `fastify.js:1`.
After confirming the slot was terminal, no generation was in flight and the
runner lock was absent, only the API process was restarted (PID
`2232817 → 2238534`). The disposable PostgreSQL container stayed healthy;
both API and SQL still reported cluster `7701259158859145256`. API read-back
returned the same ID and all seven displayed fields, with the same SHA-256
projection `07b69c7f3141d0129b488c0e171b8b7e6e3c177d4d14733ff03ba6a75e77dae8`.
SQL returned the identical row after restart. The database and repository
were not recreated.

## Spending settlement and revocation

The slot is terminal `completed` in the authoritative global ledger with
actual cost **$0.00265410**. The dedicated key's cumulative usage was
$0.00422487. Relative to the original opening reading, it rose $0.00381699:
the historical confirmed $0.00116289 plus this $0.00265410 exactly.
The existing `settle` command returned **PASS**; conservative global ledger
charge is $0.01381699, retaining the historical 429 reservation. There are
no unresolved slots or global locks. The consumed capability and token were
revoked (two files removed). No additional generation is authorized.

The live extraction did not create or link a `repo-conventions` skill; that
separate user-facing workflow remains demonstrated with clearly labelled
synthetic candidates in the existing mentor walkthrough.
