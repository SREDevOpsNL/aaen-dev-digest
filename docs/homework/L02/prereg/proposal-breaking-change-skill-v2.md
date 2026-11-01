# Proposal: `breaking-change` Skill v2 (for a possible #18 study)

**Status: a proposal, not approved, not seeded, not frozen.** Changing a
seeded Skill body changes every workspace's seed, and the body must be
added to the reviewed-seed allowlist
(`server/src/db/reviewed-seed-skills.ts`). Both require the owner to review
and approve this exact text. Until then, #18 is reported under Skill v1 as
**unresolved/unsupported**: the Item B v3 result was 0/1 adjudicated with
the Skill against 0/1 without, and the study is incomplete.

## Why v1 cannot test the frozen #18 rule

The frozen #18 rule credits only a finding that existing v1 requests using
a payment ID now get a 404, because the lookup changed from ID to public
reference. It does not credit the `:id` → `:reference` placeholder rename
on its own.

Skill v1's first "What to flag" item is a path parameter "removed or
renamed", and its Severity section makes a rename CRITICAL. "Meaning"
changes are listed only for fields. So the treatment points the model at
exactly the claim the rule excludes. The v3 with-Skill finding followed it:
it noted that the route pattern was unchanged, yet still cited the rename
rule.

The analysis is in
[successor-study-analysis-20261101.md](../evidence/successor-study-analysis-20261101.md)
§3.3. This is a defect in how the Skill and the rule fit together. It is not
a reason to tailor the Skill to the fixture.

## Proposed change (generic; no payments or reference wording)

In `## What to flag`, replace the first item and add one:

```diff
-- A route, path parameter, query parameter, request field or response field that is removed or renamed on an existing route.
+- A route, query parameter, request field or response field that is removed or renamed on an existing route. Renaming only a path placeholder (for example `:id` to `:orderId`) does not change what a client sends and is not a finding by itself.
+- A path or query parameter whose accepted values or lookup key change in place, so an existing request now resolves to a different resource, or to a 404 or an empty result.
```

In `## Severity`:

```diff
-- CRITICAL: a removal, rename or type change on an existing published route.
+- CRITICAL: a removal, rename or type change on an existing published route, or a parameter whose lookup key or meaning changes in place.
```

## Conditions, if the owner approves it

- The new body gets a new sha and is approved through the Skill approval
  gate. The allowlist entry is reviewed by the owner.
- Any #18 study under v2 is a new pre-registration with new fingerprints.
  Its report states that the Skill was revised after the v3 result, so the
  result says nothing about v1.
- The adjudicator-facing #18 ground-truth example is corrected so that it
  matches the fixture (an ID such as `pmt_123`, a reference such as
  `pay_abc`), as a new frozen-text version. The v3 text stays unchanged.
- The Phase 1 and v3 #18 observations stay as they were reported and are
  never pooled.
