# Review of `breaking-change` Skill v2 proposal (#18), Agent B

Reviewer: Agent B (#18 API Contract Skill Specialist), 2026-11-03. Read-only.
Repository: `~/projects/aaen-dev-digest-l02-extraction` at `7b066cb`.
Proposal reviewed: `docs/homework/L02/prereg/proposal-breaking-change-skill-v2.md`.
No model calls, no network writes, no secrets were opened, nothing in the repository was modified.

## Verdict

**The direction is right and the change is generic. The text as proposed is not ready for approval.**
It removes v1's demonstrated false positive (a path-placeholder rename treated as CRITICAL), and it adds the missing category (a lookup key or interpretation that changes in place).
It does not mention payments, references or `pay_`.
It has four defects that should be fixed before the owner reviews the exact text:

1. **F1 (HIGH).** The `Description:` line is unchanged. It still says "a removed or renamed route, **parameter** or field". That line is part of the body sent to the model, and it is also the seeded `description` field. The Skill would still advertise the excluded claim in its first sentence.
2. **F2 (MEDIUM).** The new item mixes "accepted values" with "lookup key". The CRITICAL line covers "lookup key or meaning", while WARNING covers "narrowed validation". A narrowed set of accepted values therefore falls under two severities.
3. **F3 (MEDIUM).** The generated-SDK nuance is missing. "Not a finding by itself" is right on the wire, but a published OpenAPI document or SDK exposes the parameter name. There it can be source-breaking, so it should be a SUGGESTION, not silence.
4. **F4 (MEDIUM).** The proposal touches only `seed-skills.ts` and the allowlist. The body is a verbatim copy of `docs/skills/api-contract/breaking-change.md`, and `server/test/seed-content.test.ts` enforces that. The seeded `description` must also equal the new `Description:` line.

A corrected v2 is in [18-skill-v2-final-proposal.md](18-skill-v2-final-proposal.md); its exact body is [18-breaking-change-v2-body.md](18-breaking-change-v2-body.md).

## Evidence base

- **Skill v1 body.** `docs/skills/api-contract/breaking-change.md` is equal to `API_CONTRACT_SEED_SKILLS[0].body` in `server/src/db/seed-skills.ts`. Its sha256 over the trimmed body is `0d3d2e49739250a4c085e9287f9d0c76e48d2158d8bbf0d08c17369a155c6770`, which equals `REVIEWED_SEED_SKILL_DIGESTS['breaking-change']` in `server/src/db/reviewed-seed-skills.ts`. I recomputed it.
- **Fixture #502** (`server/src/db/seed-fixtures.ts:94-138`):
  - `app.get('/v1/payments/:id')` with `findPayment(request.params.id)` becomes `app.get('/v1/payments/:reference')` with `findPaymentByReference(...)`;
  - the 404 path is unchanged;
  - a `reference` response field is added;
  - `store.ts` adds a `pay_...` reference lookup.
- **Frozen rule** `TECHNICAL_RULES['18']` (`adjudication.ts:183-186`). A finding counts only if it identifies that existing v1 requests that use a payment ID now get a 404 because the lookup changed. "Naming only the :id to :reference placeholder rename, or a generic breaking-change claim, does not count."
- **Observations.** All three completed #18 runs framed the change as a rename, and none mentioned the 404:
  - **Phase 1** (`EXPERIMENTS.md:241-266`). The *with* arm gave a CRITICAL "Renamed path parameter...", and the *without* arm gave a WARNING "Route parameter renamed...".
  - **v3, *with* arm.** The confirmatory slot `c-18-with-5` (packet case `case-6f8d3ce292a9`) was titled "Path parameter renamed on existing v1 route breaks clients that rely on the parameter name". Its rationale says "the route pattern itself is the same", cites "OpenAPI-generated clients" and `request.params.id`, and ends "CRITICAL ... per the breaking-change skill: a removal/rename".
  - **v3, *without* arm.** The *without* slot had no findings.
- **The *with* arm got only this Skill.** In the private forensics trace for run `0dc25e31` (`~/.devdigest/hw2-experiments/itemb-v3-20261031/forensics/run_traces.json`), the only Skill heading in the system prompt is `# breaking-change`, and it carries the v1 text verbatim. The v3 *with* arm received only this Skill, so its wording is the whole treatment.
- **The model's reasoning is partly wrong.** `request.params.id` is server code, not a client contract. The OpenAPI point is a real but minor nuance (see F3).

## Findings

### F1 (HIGH): the Description line still promotes the excluded claim
- **v1 line:** `Description: Flag any change ... — a removed or renamed route, parameter or field, ...`.
- **Effect:** the proposal leaves it unchanged. After v2, the body's first directive line still says that renaming a "parameter" is breaking, and the "What to flag" list says a placeholder rename is not a finding. That is an internal contradiction in the exact text the model reads. The v3 finding shows that the model anchors on short rule phrases ("a removal/rename").
- **Where the line lives:** in the body, in the seeded `description` (`seed-skills.ts`), and in `docs/skills/api-contract/breaking-change.md`. The seed-content test checks that the `description` equals the `Description:` line, so all three must change together.
- **Fix:** rewrite it to name "query parameter, header or field" and "a parameter whose lookup key or interpretation changes in place". It must still match `^Description: Flag .{40,}$`.

### F2 (MEDIUM): "accepted values" lands under two severities
- **The overlap:** the proposal's new item reads "accepted values **or** lookup key change in place". CRITICAL then adds "a parameter whose lookup key or meaning changes in place", while v1's WARNING keeps "narrowed validation".
- **Effect:** a query parameter that stops accepting `status=archived` fits both CRITICAL ("accepted values ... change in place") and WARNING ("narrowed validation").
- **Fix:** keep value-domain narrowing in the existing validation item (WARNING), and restrict the new CRITICAL item to a lookup key or interpretation that changes in place. That is when the same request silently resolves to a different resource, an empty result or a 404.
- **Why the split is defensible:** reinterpretation affects every existing request and can return the *wrong* resource, which is a data-exposure risk. Narrowing rejects a subset of requests with an explicit validation error.

### F3 (MEDIUM): the SDK and OpenAPI nuance for a placeholder rename
- **On the wire, the rename is neutral.** RFC 9110 §4.2.1/§4.3.1: the path identifies the resource "within that origin server's namespace", and "each origin ... controls how identifiers within that namespace are mapped to resources". The template variable name is never part of the request target.
- **In a published contract, the name is part of the description.** OpenAPI 3.1 Parameter Object: for `in: path`, "the name field MUST correspond to a template expression occurring within the path field". So the name is part of a *published* OpenAPI contract, and generators use it as the SDK argument name.
- **What breaks.** Regenerating an SDK after the rename is source-incompatible for callers that pass the argument by name (Python keyword arguments, Kotlin or C# named arguments, TypeScript options objects). Deployed clients keep working. Google AIP-180 separates "source compatibility" from "wire compatibility": both matter, and a rename is "remove and add".
- **The proposal's handling.** "Not a finding by itself" is correct for route code with no published document. When the diff also changes a published OpenAPI document or SDK, it should be a **SUGGESTION**. The reviewer has no INFO level: the prompt uses CRITICAL, WARNING and SUGGESTION, so "INFO" maps to SUGGESTION.
- **Effect on #18.** #502 contains no OpenAPI file, so the gate does not fire there, and a SUGGESTION would not hurt anyway: the rule only needs one qualifying finding.
- **One case where the name is on the wire:** hypermedia URI templates (RFC 6570) that clients expand by variable name (for example in `_links` or `Link` headers). Renaming such a *published template* variable breaks clients. The corrected v2 limits "not a finding" to a placeholder "in route code", and the case is listed as a known limitation.

### F4 (MEDIUM): implementation surface is incomplete in the proposal
- **What a body change touches:**
  - `docs/skills/api-contract/breaking-change.md`, the canonical file;
  - `seed-skills.ts` (body and `description`);
  - the `reviewed-seed-skills.ts` digest. For the corrected v2 that is `412b92e235fa0f9f451cb3721f5a99db633dea5c3d8503c5070042f76c21f68a`. The proposal's own text would be `4d0630c7...`.
- **Tests:**
  - `seed-content.test.ts` checks that the doc equals the body, that the description equals the doc's `Description:` line, the heading, and the presence of Good and Bad sections;
  - `reviewed-seed-skills.test.ts` checks the digest.
- **Seeding behaviour:** the skill row is select-then-insert if absent by name (`server/src/db/seed.ts`); only the `skill_versions` insert uses `onConflictDoNothing`. Existing workspaces keep the v1 body and their v1 approval, and only a freshly seeded stack gets v2. The study must use a fresh disposable stack and verify the stored body sha.

### F5 (LOW): `404` and "lookup key" in the Skill raise the chance of matching the rule's wording
- **Why it is acceptable:** both are the generic, canonical outcome of a not-found lookup, and the Skill does not mention payments, references, IDs-versus-references or `pay_`.
- **What to disclose:** the v2 report should still say that the Skill now contains the outcome word the rule scores. That is a known limit on how far the result says the Skill "taught" the model.
- **Post-review update (2026-11-03, methodology review D14):** the echo is broader than the word `404`, and it is now the **primary** limitation of the final proposal. See [Known limitations](18-skill-v2-final-proposal.md#known-limitations) and the [review record](17-18-21-review-record.md).

### F6 (LOW): ground-truth correction in the proposal invents an ID format
- **The text:** the proposal wants the adjudicator example to read "an ID such as `pmt_123`".
- **The problem:** the fixture never shows an ID format. Only references are documented, as `pay_...` (`store.ts` comment). `pmt_` is new information.
- **Fix:** write "an internal payment ID (a value that is not a `pay_...` reference)", or keep `pmt_123` but say it is illustrative. Either way, update `server/test/hw2-fixture-ground-truth.test.ts`, which uses `pay_123` as the ID and `ref_abc` as the reference. Make the change as a new frozen-text version, as the proposal says.

### F7 (INFO): severity consistency with the `semver-discipline` Skill
- `semver-discipline` makes "a breaking change (see `breaking-change`) ... under the same API version" CRITICAL. A placeholder-only rename is not breaking under v2, so it must not trigger semver CRITICAL. The corrected v2 says so through "Not a finding" and the SUGGESTION gate.
- **Pre-existing tension, not introduced by v2:** v1 rates narrowed validation, defaults, status codes and error shape as WARNING. The reviewer prompt says "CRITICAL only when the change can break existing clients on merge", and `semver-discipline` treats any breaking change as needing a major version. These are breaking changes rated WARNING.
- **Recommendation:** leave this out of v2 so the treatment delta stays small, and record it as a limitation.
- **Related:** `semver-discipline` uses `@acme/payments-client` as an example, and the fixture repo is `acme/payments-api`. It was not linked to the v3 #18 *with* arm, so it does not affect #18. Keep it unlinked, or note it, in any v2 study.

## Answers to the seven review questions

1. **HTTP accuracy.**
   - **Correct in the proposal:**
     - a placeholder rename is wire-neutral (RFC 9110 namespace semantics);
     - a lookup key or interpretation change in place is breaking even with an identical route pattern;
     - query parameter, request and response field renames and removals are breaking (AIP-180: rename = remove + add; removal is incompatible);
     - type narrowing and default changes are breaking (AIP-180: "Changing the default value is considered breaking");
     - status-code and error-shape changes that clients branch on are breaking;
     - additive optional changes are non-breaking (Zalando rules 107 and 108, tolerant reader).
   - **Missing:** headers and enum-value removal (both added in the corrected v2), and the SDK nuance (F3).
2. **Generic wording.**
   - **Generic:** the `:id`→`:orderId` example matches the Skill's existing `orders` examples.
   - **Fixture-specific terms:** none. A deterministic check over the corrected v2 for `payment`, `payments`, `reference`, `pmt_`, `pay_`, `ref_`, `findPayment`, `acme` and `public reference` returns no matches. The proposal's version also returns no matches.
   - **The Skill must not mention payments or references.** It never does.
3. **False positives and false negatives.**
   - **Removed:** the FP on a placeholder-only rename, demonstrated three times.
   - **Guarded:** the FN "a rename that also changes semantics". It is caught by the new lookup or interpretation item, plus the line "judge a path parameter by the value a client sends and how the handler uses it, not by its name".
   - **Residual FN:**
     - the semantic change happens outside the diff;
     - a published URI template variable is renamed (F3).
   - **Residual FP:** an internal re-implementation of a lookup with the same key could be over-read as an "interpretation change". This is mitigated by the outcome clause ("an existing request now resolves to a different resource, an empty result or a 404").
   - **Tolerant-reader changes stay non-findings:** new optional inputs, new response fields, new routes.
   - **Not covered:** a new value added to a *response* enum (Zalando rule 112 recommends open-ended enums). It is left as a limitation.
4. **Severity.**
   - CRITICAL for a lookup key or interpretation change in place is consistent with the reviewer prompt: it breaks clients on merge.
   - The CRITICAL/WARNING overlap is fixed in the corrected v2 (F2).
   - The SDK-only rename is a SUGGESTION.
   - The `semver-discipline` tension is pre-existing (F7).
5. **Coverage.**
   - **v1:** path (rename only), query, request and response body, defaults, status, error shape, validation.
   - **The proposal adds:** lookup and interpretation changes in place.
   - **The corrected v2 also adds:**
     - headers;
     - enum values in requests and responses;
     - a value-domain change on a *query* parameter, routed to the existing validation item (narrowing = WARNING);
     - lookup and interpretation changes for both path and query parameters.
6. **Approvals.**
   - The owner approves the exact final body (sha `412b92e2...`). A new allowlist entry replaces `breaking-change` in `REVIEWED_SEED_SKILL_DIGESTS`, with a dated review note.
   - The approval-gate decision on the study stack is recorded against the new `body_sha256`, and the run must fail closed if the stored body sha differs.
   - A new pre-registration freezes the new Skill fingerprint. The *with* fingerprint will differ from `18efa866…`. The non-Skill fingerprint and diff hash should be unchanged; verify that.
   - **Disclosure:** "Skill v2, revised after the v3 #18 result". Results are **never pooled** with the Phase 1 or v3 Skill v1 observations.
   - **Cost bound:** the body grows from 1,703 to 2,494 characters (281 to 421 words, about +170 tokens), so the per-slot input bound and reservation must be recomputed.
7. **Overfitting, and whether the rule is defensible.**
   - **The change corrects a general principle.** v1 conflated an identifier's *name* with the *contract*, and it had no category for "same request, different meaning". Both are textbook (RFC 9110 namespace ownership; AIP-180 "must not change visible behavior or semantics", "the set of valid resource names should not change").
   - **It was motivated by #502,** so the honest framing is "a defect found by #502, corrected generically". It cannot serve as independent evidence that v1's *concept* helps.
   - **Held-out fixtures** (in the proposal file) are required to show that v2 is not tuned to #502. In particular, the placeholder-only negative control must stay negative.
   - **The #18 rule is technically defensible.** A rename-only claim gives the wrong reason, because nothing on the wire changes. Crediting it would reward a false positive.
   - **Two caveats on the rule:**
     - It was tightened after Phase 1. Phase 1 used "a finding names the breaking change to `GET /v1/payments/:id`" (`EXPERIMENTS.md:14`), which both arms met. That is acceptable because Phase 1 was exploratory and the rule was frozen before v3, but it should stay disclosed.
     - Adjudicators should credit equivalent wording ("no longer found", "resolves to nothing", "existing IDs fail") and not demand the literal "404". The rule's parenthetical "(404)" already implies that; if the text is versioned, clarify it.

## Sources
- RFC 9110 §4.2.1, §4.3.1: https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1
- OpenAPI 3.1.0 Parameter Object and Path Templating: https://spec.openapis.org/oas/v3.1.0#parameter-object
- Google AIP-180, Backwards compatibility (source vs wire; rename = remove + add; defaults; enums; "must not change visible behavior or semantics"): https://google.aip.dev/180
- Zalando RESTful API Guidelines §16, rules 106–113 (I verified the rule titles only; the full rule text was beyond the fetched excerpt): https://opensource.zalando.com/restful-api-guidelines/#compatibility
