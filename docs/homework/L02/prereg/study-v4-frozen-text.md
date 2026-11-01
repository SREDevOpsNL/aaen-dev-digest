# Study v4 (`itemb-v4`): frozen text and rules

This file freezes the text and rules of the successor study for criterion 17
that differ from the closed v3 study. Nothing here is authorized: the owner
approves the v4 pre-registration and its spending separately. The v3 sections
of [PROSPECTIVE-STUDY.md](../PROSPECTIVE-STUDY.md) stay as they are, and v3's
manifest, slot IDs, report and adjudication behave exactly as before.

The #17 technical rule and ground truth are unchanged. Adjudicators receive
them as frozen in PROSPECTIVE-STUDY.md, "Frozen adjudication text". A version
4 packet carries only #17.

## Study block

A version 4 manifest carries this block, exactly
(`STUDY_V4` in `server/src/experiments/hw2/manifest.ts`):

```json
{"id":"itemb-v4","slot_tag":"v4","experiments":["17"],"per_condition":5,"truncation":"continue-impute","truncation_provenance":"single-router-attempt","adjudication_packet":2,"redaction":"r1"}
```

- **Slots.** 5 *with* and 5 *without*, 10 in all. Slot IDs are
  `c-v4-<experiment>-<condition>-<trial>`, for example `c-v4-17-with-1`. A
  v4 ID never equals a v3 ID: a v3 ID has a digit after `c-`.
- **Decision rule.** Unchanged: at least 4/5 *with* and at most 1/5 *without*.
- **Output cap.** A stack setting, `DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS`
  (8,000 for v4). The manifest freezes it as `stack.maxOutputTokens`, and the
  non-Skill fingerprint includes it.
- **Seed.** Derived, not chosen: the uint32 of the first 8 hex digits of
  `sha256("hw2-itemb-v4|" + F)`. `F` is the manifest fingerprint computed
  without its `schedule`. The manifest records the seed and `F`
  (`schedule.seed_derivation`). `readFrozen` refuses a version 4 file whose
  seed or schedule is not the derived one.

## Truncation rule

A slot whose single attempt ends with outcome `truncated`
(`finish_reason=length`) is terminal. It is not retried or replaced, and it
does not stop the schedule. It continues only when all of these hold:

- its cost is known;
- it reproduces the frozen fingerprints (non-Skill fingerprint and diff
  hash);
- its provenance meets one of two levels (`truncation_provenance:
  single-router-attempt`, `truncationCheck` in
  `server/src/experiments/hw2/eligibility.ts`):
  - `verified`: everything strict eligibility asks for, apart from the
    truncation itself;
  - `router_metadata_only`: the router metadata proves exactly one upstream
    attempt. That means `attempt` 1, `attempts` 1 or absent, and one
    selected endpoint equal to the frozen provider and served model. The
    generation lookup is `not_found`, or found with exactly one response
    from that provider and model.

The `router_metadata_only` level exists because OpenRouter's generation
lookup can return `not_found` for a truncated generation, as it did for v3
`c-17-with-2`. The imputation counts against the hypothesis, so accepting
the weaker level cannot help a pass. The level used is recorded on the
ledger record (`truncation_provenance`) and in the report row.

Every other stop condition still stops the schedule:

- a 429, a timeout or an ambiguous outcome;
- unknown cost;
- a fingerprint mismatch;
- any other provenance gap: no router metadata, another provider or model,
  a router record of more than one attempt, or a generation found with other
  or several responses.

In the report and the reveal, a truncated *with* slot counts as `no` and a
truncated *without* slot as `yes`. Both are labelled `imputed (truncated)`,
and neither goes to the adjudicators. A truncation can therefore never help
a pass.

## Redaction r1 (blind packet and mapping version 2)

The terms are the v3 leak terms plus every target Skill name, longest first.
Each is matched case-insensitively, as a whole word, with the plural and
possessive inflections:

```json
["edge cases and error paths","untrusted source","breaking-change","without-skill","with-skill","skill"]
```

The list's SHA-256 (of the JSON above) is
`4e07a112cf6092631d32fa12519720c62987df9a12a7e46998ce6edd162297bc`. The
packet records only this digest, not the list.

- **Replacement.** Every match in the title and rationale of every case, in
  both arms, becomes `[review-guidance]`.
- **Originals.** The unredacted text goes to `private/originals.json` (mode
  0600). Its digest is in the mapping, as is each case's redaction count and
  original-findings digest.
- **Residual compromise.** Recorded per case, never hidden:
  - `marker-present`: the token appears in the case;
  - `term-survived`: a condition-revealing term is still found after
    redaction;
  - `evidence-changed`: the anchored-regex screen of the frozen rules gives a
    different result on the original and the redacted text.
- **Reveal.** It reports a `blinding` summary, and `blinding_compromised` is
  true when any residual compromise was recorded.

Adjudicator instruction, carried in every version 2 packet
(`REDACTION_INSTRUCTION_R1` in `server/src/experiments/hw2/adjudication.ts`;
a test fails if the two differ):

```text
Wording that names review guidance supplied to the reviewer has been replaced by the neutral token [review-guidance], in the same way in every case. The token is not evidence of a condition and must not be used to infer one. Judge each case only on its finding text and anchors against the frozen rule and ground truth.
```
