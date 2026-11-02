# Study v5 (#17, P3 attempt pool): confirmatory run, outage stop after 20 attempts (2026-11-02)

The owner authorized study v5 for #17 exactly as frozen in the
[approval packet](../../PROSPECTIVE-STUDY.md#approval-packet-v5-not-authorized).
The schedule ended on the preregistered **outage stop**: 6 consecutive
classified upstream 429s, after 20 of 30 attempts.

**Adjudicated result:**
- with the Skill, **0 of 4** observed trials detected;
- without it, **1 of 1**.

Even the best case over the missing trials cannot meet the frozen rule,
which needs ≥ 4/5 detected with the Skill. The adjudicated claim is
`not_detected`.

**A protocol deviation was found.** The predeclared pacing waits were about
8–9 % short in real time, because this host's monotonic clock runs fast. The
runner report therefore marks the formal claim `incomplete`.

**#17 is not shown and stays Implemented.**

## Checks immediately before authorization (all matched)

- **Source.** Head `c229bf9` on `homework/l02-mentor-submission`; CI 7/7 at
  that exact head. The stack's detached checkout is at the same commit and
  clean.
- **Pre-registration.** `prereg/manifest-20261102-v5.json`, sha256
  `f120f08653b60745bba5d54d2aa6d069c87a286516b63fad7806d5331c4b25d9`; rules
  `bb8fb1d0…7a6a`.
  - `prereg-check --study v5`: manifest fingerprint
    `3832fa254ce83dec6fb5fcf7e44c7158853a77d02ab38489f7a513769fdeb533`,
    10 trials, seed 3545445316;
  - 30 predeclared attempt IDs; no attempt and no scheduled slot in the
    ledger;
  - the live target Skill (body, enabled flag, approval) equals the frozen
    entry.
- **Stack (`check`).** `hw2f-a88a535d` on `devdigest_hw2f_a88a535d`;
  isolation checks pass; implementation fingerprint
  `dcda964d694910ff298dfad85e5122765dff6f70252e911a14f98c4944174413`;
  fixture #501 diff `8e0ba133…d186`; 0 runs in the stack database.
- **Previews.** Both are byte-identical to the freeze previews:
  - non-Skill fingerprint `7aea9945…`;
  - Skill fingerprints `18efa866…` (with) and `4f53cda1…` (without);
  - input bounds 9,474 / 8,967, output cap 8,000.

  Phase 0 passes.
- **Endpoint.** Only `deepinfra/fp8` (DeepInfra, model
  `deepseek/deepseek-v4-flash`), at $0.00000009 input, $0.00000018 output
  and $0 per request, the frozen prices. One disclosed difference, not a
  binding: the endpoint now advertises `maxCompletionTokens` 393,216 (was
  65,536). The cap stays 8,000.
- **Ledger.** 48 records, $0.02174118 conservative, no open slot. No
  capability for this stack; the last authorization event was the v4 revoke.
  The two inert Gate 3 token files of removed 2026-10-21/22 stacks are
  unchanged.
- **Key.** $0.00714906 of $2.00 used.

The capability was issued at 16:03:54Z ([authorize.log](authorize-log.txt)):
- Gate 4, confirmatory;
- budget exactly $0.15 (30 × $0.005), ceiling $0.17174118;
- expiry 19:03:54Z.

## Execution ([run.log](run-log.txt), [clicks.log](clicks-log.txt))

The runner armed attempts in the frozen order. The browser driver clicked
**Run Review → Test Quality Reviewer** once per armed attempt, by exact button
name. A second attempt for a trial was armed only after a strictly
classified 429 on that trial's previous attempt.

| Pos. | Trial | Condition | Attempts | Label |
| --- | --- | --- | --- | --- |
| 1 | `c-v5-17-with-1` | with | a1 observed | observed |
| 2 | `c-v5-17-without-1` | without | a1 429, a2 observed | observed |
| 3 | `c-v5-17-without-5` | without | a1–a3 429 | bounded (pool exhausted) |
| 4 | `c-v5-17-with-5` | with | a1 observed | observed |
| 5 | `c-v5-17-without-3` | without | a1–a3 429 | bounded (pool exhausted) |
| 6 | `c-v5-17-with-3` | with | a1, a2 429, a3 observed | observed |
| 7 | `c-v5-17-with-4` | with | a1 observed | observed |
| 8 | `c-v5-17-without-4` | without | a1–a3 429 | bounded (pool exhausted) |
| 9 | `c-v5-17-without-2` | without | a1–a3 429 | bounded (pool exhausted); **outage stop** |
| 10 | `c-v5-17-with-2` | with | not dispatched | bounded (outage stop) |

Every 429 was classified from structured fields: HTTP 429, origin
`upstream_provider`, `limit_source upstream_provider_shared_pool`, provider
DeepInfra, no response ID, no usage, one dispatched attempt, the frozen
non-Skill fingerprint. Each failed 1–1.1 s after submission.

All five observations are provenance-verified (router metadata and the
generation record) and carry the frozen fingerprints. No truncation
occurred, so nothing was imputed. Nothing outside the attempt plan was
dispatched: no warm-up, retry, reprompt, SDK retry, fallback or replacement.

## Missingness

- **Classified 429s: 15 of 20 attempts.**
  - *without*: 12 of 13 attempts;
  - *with*: 2 of 6 attempts, both on trial 6 (`with-3` a1 and a2).
- **Trials missing:** 4 of 5 *without* (exhausted pools) and 1 of 5 *with*
  (never dispatched after the outage stop). Fisher two-sided p for missing
  trials is 0.206.
- **Exhausted pools:** `c-v5-17-without-5`, `-without-3`, `-without-4`,
  `-without-2`.
- **The 429s fell almost entirely on the *without* arm.** The two request
  shapes differ only by about 100 prompt tokens. The 429s also cluster in
  time: positions 3, 5, 8 and 9, each a full pool. That is more consistent
  with load bursts on DeepInfra's shared pool that happened to coincide with
  *without* trials than with a mechanism tied to the condition. This cannot
  be verified from the recorded fields.
- **What this means for the claim.** The imbalance is reported, not
  corrected. It cannot change it: the *with* arm is the binding one, and its
  observed 0/4 already fails the rule.

## Protocol deviation: pacing ([clock-check.txt](clock-check.txt))

The report measures each gap from the UTC ledger timestamps:

| Planned | Measured | Count |
| --- | --- | --- |
| 30 s | ≈27.4–27.6 s | 8 gaps |
| 60 s | ≈54.7–57.5 s | 6 gaps |
| 180 s | ≈164.5–167.2 s | 5 gaps |

The five 180 s gaps exceed the report's 10 s tolerance, so the report lists
them as inconsistencies and blocks the claim.

**Cause, verified after the run:**
- With free checks only, this WSL2 host's monotonic clock (`setTimeout`,
  `performance.now`) runs about 9 % fast:
  - 60.06 s of monotonic time took 54.86 s of wall time;
  - 120.06 s took 109.51 s of wall time and **110 s on an external clock**
    (www.google.com `Date` header).
- The wall clock agrees with the external clock, so the runner waited the
  full declared duration by its own timer, but the real waits were about
  8–9 % short.
- The deviation is uniform and outcome-independent. It affected both arms
  equally and cannot have changed allocation, order or which attempts were
  made.

**Effect on the outcome: none.** The deviation can only have made the pacing
less protective against 429s. It does not touch the content of the five
observed reviews, and the adjudicated *with* result (0/4) fails the rule
under any assignment of the missing trials. The formal claim is still
recorded as `incomplete` because of the deviation, and the adjudicated
evidence as `not_detected`; both are reported.

## Spending and settlement

- The capability was revoked at **16:34:48Z**, seconds after the runner
  stopped ([revoke.log](revoke-log.txt)). `reconcile` found nothing
  unresolved ([reconcile.log](reconcile-log.txt), empty).
- **Settlement PASS** ([settle.log](settle-log.txt)): key usage rose
  **$0.00236142** since the last settlement. That is exactly the five
  observed costs:

  | Attempt | Cost (USD) |
  | --- | --- |
  | `with-1-a1` | 0.00043290 |
  | `without-1-a2` | 0.00053442 |
  | `with-5-a1` | 0.00035748 |
  | `with-3-a3` | 0.00061578 |
  | `with-4-a1` | 0.00042084 |

  **None of the 15 429s was billed.**
- **Ledger:** 108 records. The 15 unbilled 429s each keep their $0.005
  reservation ($0.075), as the conservative policy requires. Conservative
  total $0.0991026, below the $0.17174118 ceiling. Confirmatory
  $0.08505782 of $1.00.
- **Key:** $0.00951048 of $2.00 used.
- **v5 actual spend: $0.00236142.** v5 conservative ledger growth:
  $0.07736142.

## Adjudication ([adjudication/](adjudication/report.md))

- **Packet:** v2 with redaction r1, 5 cases (one per observed trial),
  condition-blinded. Packet `2c5160c8…`, mapping `f352e04e…`. A leak check
  found no attempt ID, condition or Skill name in the cases.
- **Adjudicators:** two independent subagent sessions, Technical-Reviewer-A
  and Technical-Reviewer-B (both `claude-opus-5-5`). Each could read only its
  own copy of the packet.
- **Seals:** `5ddb5c3e…` and `c8d74637…`, registered before the reveal;
  `verify` reports the record intact; originals are kept byte for byte.
- **Agreement:** full, with no disputes.

| Slot | Condition | Verdict | Reason (both adjudicators) |
| --- | --- | --- | --- |
| `c-v5-17-with-1` | with | no | error branch named; exact `now == expiresAt` boundary missing |
| `c-v5-17-without-1` | without | **yes** | error branches plus an explicit "now exactly equals expiresAt" finding |
| `c-v5-17-with-5` | with | no | error branch only |
| `c-v5-17-with-3` | with | no | error branch only |
| `c-v5-17-with-4` | with | no | error branch only; a comparison-operator remark does not name the equality test |

**P4 over the adjudicated verdicts:**
- *with*: 0 detected of 4 observed, 1 bounded;
- *without*: 1 of 1 observed, 4 bounded.

| Measure | Value |
| --- | --- |
| Strict | `incomplete` (missing trials) |
| Worst case | negative |
| Best case | negative (*with* reaches at most 1/5) |
| Claim | **`not_detected`** |
| Imputed truncations | none |
| Blinding compromised | no |

The tool's redaction found nothing to redact.

The adjudication reveal applies P4 to the verdicts. It does **not** carry
the runner report's pacing blocker. That is a recorded gap in the tooling;
the deviation above is disclosed here instead.

## Observed versus bounded

- **Observed (5):** 4 *with*, all "no"; 1 *without*, "yes".
- **Imputed (0).**
- **Bounded (5):** 4 *without*, 1 *with*, all lost to classified 429s or
  the outage stop.
- **Incomplete trials (0).** The formal claim is `incomplete` only because
  of the pacing deviation.
- **not_detected:** the adjudicated claim.

No result here is a conditional worst-case bound. Nothing here is Verified
evidence for #17.

## What the evidence says

Across 4 observed *with* trials, the reviewer with the Edge Cases and Error
Paths Skill always flagged the untested error branches, part (a), and never
the exact expiry boundary, part (b). The same held in Phase 1 and in v3/v4.
The one detection came from the *without* condition.

This is negative evidence for the Skill as specified on this fixture. It is
not significant, and with n = 5 per arm and a 54 % power ceiling it says
little either way. It is reported as observed.

## Preserved evidence (private, outside Git)

These are kept in `~/.devdigest/hw2-experiments/itemb-v5-20261102/` (mode
0700/0600):
- a full `pg_dump` of `devdigest_hw2f_a88a535d` (42 tables);
- JSON exports of all 20 `agent_runs` and `run_traces`, the reviews, the 39
  findings of the observed runs, and agents, Skills, links, approvals and
  versions;
- the API slot views of all 20 attempts;
- the 60 v5 ledger events, the stack server log and the free previews;
- the runner, driver, authorization, revoke, settlement and reconcile logs;
- the clock check;
- the adjudication input and the full adjudication directory, including
  the sealed private judgments and the originals.

`SHA256SUMS` covers 65 files, including the global ledger, authorization and
key-usage logs at export. Its sha256 is
`46822a07c1dfb53afea0a597116364303feee813b9c51dceeba4e347b71e7c83`.
`sha256sum -c` passes.

The committed files here are byte-identical copies of their private
originals; logs are renamed `*-log.txt`. The dump, traces and raw responses
stay private.

## State afterwards

- No capability file; the last authorization event is this revoke.
- All ledger slots are terminal.
- The runner and driver processes have exited.
- Stack `hw2f-a88a535d` is still up (tmux `hw2-freeze-v5`) for read-only
  forensics. Its teardown is the owner's call.
- The 10 unused attempt IDs were not dispatched. Any further #17 study needs
  a new decision and a new pre-registration.
