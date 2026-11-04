| Experiment | With: regex hits / eligible | Without: regex hits / eligible | Fingerprints agree | Outcome |
| --- | --- | --- | --- | --- |
| 18 | 0 / 1 | 0 / 1 | yes | incomplete (Anchored regex screening is non-authoritative; sealed condition-blinded technical adjudication is required) |
| 17 | 1 / 1 | 1 / 2 | yes | invalid (1 slot(s) did not execute their preregistered slot, condition or Skills: c-17-with-2 (a "with" slot sent 0 skills instead of exactly the target skill)) |

| Slot | Exp. | Condition | State | Counted | Provenance | Fingerprint | Regex screen | Matched (anchor) | All finding titles | Cost (USD) | Not counted because |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c-18-with-5 | 18 | with | completed | yes | verified (router_metadata, generation) | frozen | no | — | Path parameter renamed on existing v1 route breaks clients that rely on the parameter name | 0.00020115 | — |
| c-18-without-5 | 18 | without | completed | yes | verified (router_metadata, generation) | frozen | no | — | — | 0.00009567 | — |
| c-17-with-1 | 17 | with | completed | yes | verified (router_metadata, generation) | frozen | yes | No test for unknown coupon code (src/billing/discount.test.ts:1-8); No test for expired coupon (src/billing/discount.test.ts:1-8); No test for boundary condition: exactly at expiration (src/billing/discount.test.ts:1-8) | No test for unknown coupon code; No test for expired coupon; No test for zero total; No test for 100% discount; No test for case-insensitive code matching; No test for rounding behavior; No test for boundary condition: exactly at expiration | 0.00041526 | — |
| c-17-without-1 | 17 | without | completed | yes | verified (router_metadata, generation) | frozen | no | — | Missing test for expired coupon; Missing test for unknown coupon code; Missing test for case-insensitive code matching; Missing test for discount cap at 100%; Missing test for zero total after discount; Missing test for rounding behavior; Missing test for the HALF coupon | 0.00045162 | — |
| c-17-without-2 | 17 | without | completed | yes | verified (router_metadata, generation) | frozen | yes | No test for unknown coupon code (error path) (src/billing/discount.test.ts:1-8); No test for expired coupon (error path) (src/billing/discount.test.ts:1-8) | No test for unknown coupon code (error path); No test for expired coupon (error path); No test for rounding behavior; No test for zero total or 100% off; No test for the second hardcoded coupon (HALF) | 0.00035514 | — |
| c-17-with-2 | 17 | with | failed | no | unverified (router_metadata) | frozen | no | — | — | 0.00082278 | a "with" slot sent 0 skills instead of exactly the target skill; dispatch_state failed; attempt outcome truncated; a single upstream attempt is not proven (router attempt/attempts or exactly one generation provider response) |
| c-17-with-5 | 17 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-17-without-5 | 17 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-without-1 | 18 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-with-1 | 18 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-without-3 | 18 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-with-3 | 18 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-17-without-4 | 17 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-17-with-4 | 17 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-17-with-3 | 17 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-17-without-3 | 17 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-with-2 | 18 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-without-2 | 18 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-with-4 | 18 | with | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
| c-18-without-4 | 18 | without | not dispatched | no | — | — | — | — | — | unknown | not dispatched |
