# `breaking-change` Skill v2, final corrected proposal (#18)

**Status:** a proposal. Not approved, not seeded, not frozen. Prepared by Agent B on 2026-11-03, read-only. The review is in [18-skill-v2-review.md](18-skill-v2-review.md); the post-review corrections are listed in the [review record](17-18-21-review-record.md).

## Identity

| Item | Value |
| --- | --- |
| v1 body sha256 (trimmed, utf8) | `0d3d2e49739250a4c085e9287f9d0c76e48d2158d8bbf0d08c17369a155c6770`. Equals the current allowlist entry. |
| v1 size | 1,703 characters, 281 words |
| The proposal's own v2 text (not recommended) | sha `4d0630c76a064641dbf6926411ffbb1171ef7d6a70b2e3994f5947c00e558cb0`, 2,057 characters |
| **Final v2 body sha256** | **`412b92e235fa0f9f451cb3721f5a99db633dea5c3d8503c5070042f76c21f68a`** |
| Final v2 size | 2,494 characters, 421 words (about +170 tokens) |

Each sha256 is computed as `skillBodySha256` computes it: sha256 over the body string, which is the file content trimmed. Sources:

- v1: the repository file `docs/skills/api-contract/breaking-change.md` (equal to the seeded body), also reproduced below;
- final v2: [18-breaking-change-v2-body.md](18-breaking-change-v2-body.md), whose bytes are hashed, also reproduced below;
- the v1 → final v2 diff is inline below. The proposal's own v2 text and its diff are not kept as separate files; only its sha is recorded above.

The new seeded `description`, which must equal the body's `Description:` line:

```text
Flag any change to a published API route that can break an existing client — a removed or renamed route, query parameter, header or field, a changed field type or meaning, a parameter whose lookup key or interpretation changes in place, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.
```

## Exact v1 body

````markdown
# breaking-change

Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, parameter or field, a changed field type or meaning, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

## What to flag

- A route, path parameter, query parameter, request field or response field that is removed or renamed on an existing route.
- A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
- An input that becomes required, or validation that rejects values the route accepted before.
- A changed default, status code or error shape that clients branch on.

## Severity

- CRITICAL: a removal, rename or type change on an existing published route.
- WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
- SUGGESTION: an additive change that is safe but undocumented.

## Not a finding

- New optional request fields, new response fields and new routes.
- The same change shipped under a new version prefix while the old version keeps its contract.
- Internal handlers and modules that no client can call.

## Good

```ts
// The existing route keeps its contract; the new shape ships as v2.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customer_id: order.customerId }));
app.get('/v2/orders/:id', async (req) => ({ id: order.id, customer: { id: order.customerId } }));
```

## Bad

```ts
// Renames a field in place on v1: every client that reads customer_id breaks.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customerId: order.customerId }));
```
````

## Exact final v2 body

````markdown
# breaking-change

Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, query parameter, header or field, a changed field type or meaning, a parameter whose lookup key or interpretation changes in place, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

## What to flag

- A route, query parameter, header, request field or response field that is removed or renamed on an existing route.
- A path or query parameter whose lookup key or interpretation changes in place, so an existing request now resolves to a different resource, an empty result or a 404, even when the route pattern is unchanged.
- A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
- An enum value removed or renamed in a request or a response.
- An input that becomes required, or validation that rejects values the route accepted before.
- A changed default, status code or error shape that clients branch on.

Judge a path parameter by the value a client sends and how the handler uses it, not by its name: a client never sends the placeholder name.

## Severity

- CRITICAL: a removal, rename or type change on an existing published route, or a parameter whose lookup key or interpretation changes in place.
- WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
- SUGGESTION: an additive change that is safe but undocumented, or a renamed path placeholder that also renames the parameter in a published OpenAPI document or SDK.

## Not a finding

- New optional request fields, new response fields and new routes.
- Renaming only a path placeholder in route code (for example `:id` to `:orderId`) while the handler reads the same value the same way.
- The same change shipped under a new version prefix while the old version keeps its contract.
- Internal handlers and modules that no client can call.

## Good

```ts
// The existing route keeps its contract; the new shape ships as v2.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customer_id: order.customerId }));
app.get('/v2/orders/:id', async (req) => ({ id: order.id, customer: { id: order.customerId } }));
```

## Bad

```ts
// Renames a field in place on v1: every client that reads customer_id breaks.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customerId: order.customerId }));
```
````

## Unified diff (v1 → final v2)

````diff
--- breaking-change-v1.md	2026-11-03 20:39:51.058316113 +0100
+++ breaking-change-v2.md	2026-11-03 20:40:20.160764673 +0100
@@ -1,23 +1,28 @@
 # breaking-change

-Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, parameter or field, a changed field type or meaning, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.
+Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, query parameter, header or field, a changed field type or meaning, a parameter whose lookup key or interpretation changes in place, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

 ## What to flag

-- A route, path parameter, query parameter, request field or response field that is removed or renamed on an existing route.
+- A route, query parameter, header, request field or response field that is removed or renamed on an existing route.
+- A path or query parameter whose lookup key or interpretation changes in place, so an existing request now resolves to a different resource, an empty result or a 404, even when the route pattern is unchanged.
 - A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
+- An enum value removed or renamed in a request or a response.
 - An input that becomes required, or validation that rejects values the route accepted before.
 - A changed default, status code or error shape that clients branch on.

+Judge a path parameter by the value a client sends and how the handler uses it, not by its name: a client never sends the placeholder name.
+
 ## Severity

-- CRITICAL: a removal, rename or type change on an existing published route.
+- CRITICAL: a removal, rename or type change on an existing published route, or a parameter whose lookup key or interpretation changes in place.
 - WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
-- SUGGESTION: an additive change that is safe but undocumented.
+- SUGGESTION: an additive change that is safe but undocumented, or a renamed path placeholder that also renames the parameter in a published OpenAPI document or SDK.

 ## Not a finding

 - New optional request fields, new response fields and new routes.
+- Renaming only a path placeholder in route code (for example `:id` to `:orderId`) while the handler reads the same value the same way.
 - The same change shipped under a new version prefix while the old version keeps its contract.
 - Internal handlers and modules that no client can call.

````

## Rationale per change

1. **`Description:` line.**
   - Drops the bare word "parameter" from "removed or renamed route, parameter or field", and replaces it with "query parameter, header or field".
   - Adds "a parameter whose lookup key or interpretation changes in place".
   - Why: the first directive line no longer contradicts the body. The proposal missed this (review F1).
   - It still matches `^Description: Flag .{40,}$`.
2. **First "What to flag" item.**
   - "path parameter" is removed from the rename list, because a client never sends a placeholder name (RFC 9110 §4.3.1: the origin owns the namespace mapping).
   - "header" is added: removing or renaming a request header the server reads, or a response header clients read, is a removal or rename on the wire (AIP-180: rename = remove + add).
3. **New item: lookup key or interpretation changes in place.**
   - This is the missing general category: the same request now means something else.
   - It is limited to a lookup key or interpretation, and the narrowing of an accepted value set stays under validation (WARNING). That resolves the two-severity overlap (review F2).
   - It covers path *and* query parameters, and says explicitly "even when the route pattern is unchanged".
4. **New item: enum value removed or renamed** in a request or a response. AIP-180 treats the removal of any component as incompatible. In v1 this was only implied by "meaning".
5. **"Judge a path parameter by the value a client sends and how the handler uses it, not by its name."**
   - The general principle behind items 2–3. Without it, a v2 that only says "a rename is not a finding" invites a false negative when a rename *and* a semantic change happen together.
   - Placed as a paragraph inside `## What to flag`, so the heading structure is unchanged.
6. **CRITICAL line** adds a lookup key or interpretation change in place, which breaks every existing request on merge. That is consistent with the reviewer prompt's CRITICAL definition.
7. **SUGGESTION line** adds a renamed path placeholder that also renames the parameter in a published OpenAPI document or SDK.
   - That is a source-compatibility issue for generated clients that pass the argument by name, not a wire break (AIP-180 separates source from wire compatibility; OpenAPI 3.1 ties a path parameter's `name` to the template expression).
   - The reviewer has no INFO level, so SUGGESTION is the lowest available.
   - **Why SUGGESTION rather than WARNING.** The rename is wire-neutral: every deployed client keeps working. It is source-breaking only for SDK callers who pass that argument by name, and only when they regenerate the SDK, at which point the compiler or a test reports it. The reviewer prompt reserves CRITICAL for clients that break on merge, and v1 uses WARNING for runtime-visible changes (defaults, status codes, validation). A source-only break for a subset of SDK users fits below both.
   - **Owner choice.** A WARNING is also defensible for a published SDK with external consumers. The owner chooses SUGGESTION (recommended) or WARNING before the body is frozen; WARNING changes the body and its sha.
8. **"Not a finding": a placeholder renamed in route code while the handler reads the same value the same way.**
   - The generic `:id`→`:orderId` example matches the Skill's existing `orders` domain.
   - It is scoped to route code, so a published URI template (RFC 6570) is not exempted.
9. **Unchanged:** the heading, the section order, the Good and Bad examples, WARNING and the other "Not a finding" entries. That keeps the treatment delta small. No example of a lookup change was added, because one would come close to the shape of the hidden fixture.

## Known limitations

- **Primary limitation: the new text echoes the frozen #18 rule in both directions.**
  - The new positive item ("lookup key or interpretation changes in place, so an existing request now resolves to … a 404, even when the route pattern is unchanged") closely restates what the #18 rule and ground truth credit: existing requests now get a 404 because the lookup changed.
  - The new "Not a finding" bullet (renaming only a path placeholder) restates what the rule explicitly refuses to credit.
  - This limits any claim that the Skill "taught" detection rather than wording. A #502 result with v2 can show at most that the model reproduces the Skill's framing (review F5, methodology review D14).
  - **Alternative phrasing, offered and not applied.** The positive item could drop "404" and "existing request", for example: "A path or query parameter whose lookup key or interpretation changes in place, so the same request value now selects a different record or none, even when the route pattern is unchanged." This is not applied to [18-breaking-change-v2-body.md](18-breaking-change-v2-body.md): it would change the body sha, which would then have to be recomputed with `skillBodySha256` and re-reviewed.
  - **Recommendation for adjudication.** Adjudicators should credit the mechanism (an existing request value no longer resolves to the same resource because the lookup changed), not keywords. Put that in a new, versioned rule text with an explicit equivalent-wording clause; the v3 text stays unchanged.
- **Changes outside the diff.** If the semantic change is in code outside the diff (for example a store function whose behaviour changes under the same name), the Skill cannot help.
- **Published URI templates.** Hypermedia URI templates that clients expand by variable name (RFC 6570) are not addressed explicitly. A rename there *is* breaking.
- **Response enum additions.** Adding a value to a response enum is not covered. It can break exhaustive client switches (Zalando rule 112 recommends open-ended enums), and it stays under "new response fields" as not a finding.
- **Pre-existing severity tension** with the reviewer prompt and `semver-discipline`: narrowed validation, defaults, status codes and error shape are breaking changes that v1 rates WARNING. This was not changed, to keep the delta small.
- **Existing workspaces are not updated.** The skill row is select-then-insert if absent by name (`server/src/db/seed.ts`); only the `skill_versions` insert uses `onConflictDoNothing`. Existing workspaces keep v1 and their v1 approval, and only a freshly seeded stack carries v2.
- **Body size grows by about 46%.** The prompt-size and cost bounds must be recomputed.
- **This is a correction, not a v1 replication.** v2 was written after seeing #502's failure mode. A v2 study measures v2, and it says nothing about v1.

## Required approvals and changes (owner-gated, in order)

1. **Owner review of the exact body**, sha `412b92e2…68a`: injection review as in `reviewed-seed-skills.ts`, plus a technical review.
2. **One commit with all four parts:**
   - `docs/skills/api-contract/breaking-change.md` ← v2 body;
   - `server/src/db/seed-skills.ts`: the `breaking-change` body and `description` (the `Description:` line above);
   - `server/src/db/reviewed-seed-skills.ts`: replace the `breaking-change` digest with `412b92e235fa0f9f451cb3721f5a99db633dea5c3d8503c5070042f76c21f68a`, and add a dated "Reviewed" note;
   - the deterministic tests below.
   - `seed-content.test.ts` and `reviewed-seed-skills.test.ts` must pass.
3. **A new approval-gate decision** on the study stack for the new `body_sha256`. The seed bootstrap records it only on a fresh stack, from the owner-reviewed allowlist. The run fails closed if the stored sha differs.
4. **A new pre-registration** with the new *with*-arm Skill fingerprint (not `18efa866…`). The non-Skill fingerprint and the diff hash should be unchanged; verify that. It also needs a recomputed input-token bound and per-slot reservation.
5. **Disclosure in every report:** "Skill v2, revised after the v3 #18 result". Never pool it with the Phase 1 or v3 (v1) observations.
6. **The adjudicator ground truth**, as a new frozen-text version:
   - the ID example must not be a `pay_…` value;
   - `pmt_123` is invented, so mark it as illustrative or write "an internal payment ID";
   - update `hw2-fixture-ground-truth.test.ts` to match;
   - the v3 text stays unchanged.

## Regression tests

### (a) Deterministic, unpaid (unit tests in `server/test/`, no model, no DB)

| ID | Check | Expected |
| --- | --- | --- |
| D1 | The body contains none of the following, case-insensitively: `payment`, `payments`, `reference`, `pmt_`, `pay_`, `ref_`, `findPayment`, `public reference`, `acme` | none found (verified on the final v2 and on the proposal's text) |
| D2 | Level-1 and level-2 headings, in order | exactly `# breaking-change`, `## What to flag`, `## Severity`, `## Not a finding`, `## Good`, `## Bad` (same as v1; verified) |
| D3 | The `Description:` line | matches `^Description: Flag .{40,}$` and equals the seeded `description` (existing `seed-content.test.ts`) |
| D4 | Size bound | `body.length <= 2600` characters and `<= 1.6 × v1`. Final v2 is 2,494 |
| D5 | Digest | `skillBodySha256(body)` equals the allowlist value (existing `reviewed-seed-skills.test.ts`) |
| D6 | The rename list has no path parameter | the first bullet under `## What to flag` does not match `/path parameter/i` |
| D7 | The placeholder carve-out exists | `## Not a finding` contains a bullet that matches `/path placeholder/i` |
| D8 | No severity overlap | the CRITICAL line does not contain `accepted values`; the WARNING line contains `narrowed validation` |
| D9 | The doc file and the seed match | existing `seed-content.test.ts` (verbatim body) |
| D10 | Code fences | the Good and Bad sections each contain one fenced `ts` block (existing test) |

### (b) Held-out evaluation fixtures (paid; only under a new owner-authorized pre-registration)

- **Domains.** None of these may use payments, references, `pay_` or `pmt_`. Use unrelated domains (orders, invoices, users, shipments).
- **Purpose.** They test v2's general claims, not #502.
- **Arms.** Run each with v2 and without the Skill; v1 is optional, as a comparator, never pooled.
- **Scoring.** Each rule below is a frozen technical rule for its fixture, applied to title + rationale (see the shared template).
- **The table is illustrative; the independent author writes the sealed set from the construct specification.**

| ID | Fixture (diff summary) | Expected verdict with v2 |
| --- | --- | --- |
| H1 (negative control) | `GET /v1/invoices/:id` → `/v1/invoices/:invoiceId`; the handler reads `params.invoiceId` and calls the same `findInvoice(...)` by the same key; no OpenAPI file | **No breaking finding** at CRITICAL or WARNING. A SUGGESTION about naming is tolerated but not expected. A CRITICAL or WARNING "rename breaks clients" counts as a **false positive** |
| H1b (SDK nuance) | H1, plus `openapi.yaml` in the diff renaming the path parameter `name: id` → `name: invoiceId` | Expected: a **SUGGESTION** that cites the generated-SDK argument name. A **WARNING** is not a false positive; it is recorded as a severity disagreement. A **CRITICAL** is an FP |
| H2 (near transfer: same construct as #502) | `GET /v1/shipments/:id` keeps its pattern *and* its placeholder name, but the handler now resolves `params.id` as a carrier tracking number (`findByTrackingNumber`); the not-found branch is unchanged | **Detected, CRITICAL.** Counts only if the finding says that existing requests with a shipment ID no longer resolve (404 or not found) because the lookup key changed. "Route changed" or "rename" alone does not count |
| H2b (rename + semantics; near transfer: same construct as #502) | Like H2, but the placeholder is also renamed `:id` → `:trackingNumber` | **Detected, CRITICAL**, by the same rule as H2. A rename-only finding does not count. This guards against the v2 false negative |
| H3 | `GET /v1/orders?status=` previously accepted `open,closed,archived`; validation now rejects `archived` (400) | **Detected, WARNING** (CRITICAL accepted). The finding must name the rejected value or the narrowed domain for existing callers |
| H4 | The response `status` enum of `GET /v1/users/:id` drops `suspended`; those users now come back as `inactive` | **Detected**, WARNING or CRITICAL. The finding must say that clients branching on the removed value break, or that the value's meaning changed |
| H5 (negative control) | Adds an optional query parameter `include=items`, a new response field `updated_at` and a new route `GET /v1/orders/:id/items` | **No finding** above SUGGESTION. Any CRITICAL or WARNING is an FP |
| H6 | Removes the response header `ETag` from `GET /v1/orders/:id` | **Detected**, any severity. The finding must say that clients reading the removed header (for example for caching or conditional requests) break |
| H7 | `POST /v1/invoices`: the request field `currency`, previously optional with a default, becomes required (400 when absent) | **Detected, WARNING** (CRITICAL accepted). The finding must name the newly required field and say that existing requests omitting it now fail |

- **Mandatory positives:** H2, H2b, H3, H4, H6 and H7. **Negative controls:** H1, H1b, H5.
- **Transfer distance.** H2 and H2b test the same construct as #502 (a lookup key that changes in place), so they are near transfer, and they are analysed as **one stratum**. That gives five positive strata (H2+H2b, H3, H4, H6, H7). Generalization evidence comes from H3, H4, H6 and H7, and from the negative controls H1, H1b and H5.
- **Direction quorum.** The template's "non-negative in ≥ 80 % of positive strata" means ≥ 4 of the 5 strata here, of which at least 3 must be among the four strata outside #502's construct (H3, H4, H6, H7).
- **Evaluation design.** Use the shared [prospective evaluation template](17-heldout-fixtures.md#prospective-evaluation-template-shared-by-17-and-18):
  - one confirmatory test, v2 vs no Skill, stratified by stratum (H2 and H2b form one); v1 and per-fixture contrasts are exploratory (Holm);
  - false-positive guards on H1, H1b and H5 as defined in the table;
  - a pre-declared number of reviews per arm and fixture, taken from the template's sample-size table;
  - 429s handled as in the template: condition-independence is an assumption (v5 lost slots unevenly by schedule position), so pre-register bounded re-attempts, randomized interleaving within blocks, and per-arm 429 reporting.
- **Report** the per-fixture results, not only a pooled rate. #502 is a non-blind secondary result.
