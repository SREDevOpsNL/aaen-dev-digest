# Engineering Insights

This is the course-required Engineering Insights history for repository-level
and cross-package work. Qualifying package findings are appended to the matching
client/INSIGHTS.md, server/INSIGHTS.md, reviewer-core/INSIGHTS.md, or
e2e/INSIGHTS.md. Durable, reusable knowledge belongs in the matching
LEARNINGS.md; the engineering-insights workflow in
[`.claude/skills/engineering-insights/SKILL.md`](.claude/skills/engineering-insights/SKILL.md)
says which file a finding goes in.

## Session entries

- **2026-09-21 — L01 severity-filter homework.** Severity counters and filtering
  were implemented entirely in the client over findings already loaded for each
  review run, so verification required no model call. Final implementation and
  verification ran in the authoritative Ubuntu 24.04 WSL2 checkout: typechecks,
  54 unit tests, the production build, and all 7 hermetic browser flows passed.
  The hermetic run used persisted seed data without GitHub or OpenRouter
  credentials, providing direct evidence that the feature added no model call.
  The environment correction is recorded in [`LEARNINGS.md`](LEARNINGS.md) and
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes). Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts:5`.

- **2026-09-22 — L01 reviewer experiment.** The original DevDigest General
  Reviewer (`deepseek/deepseek-v4-flash`, prompt version 1) found 8 issues
  (3 Critical, 5 Warning) in demo PR #3 for $0.00105664. It had strong recall,
  including the hardcoded key, key exfiltration, callback SSRF, unencoded
  `customerId`, missing response checks, and unbounded input, but duplicated the
  callback-validation problem and invented an authentication requirement not
  shown in the diff. Claude Code with the same base rubric found 4 issues
  (2 Critical, 2 Warning): the two blocking security defects, sequential I/O,
  and missing upstream-status handling; it missed `customerId` encoding and
  suggested unbounded `Promise.all` as the concurrency fix.

  After saving precision rules as General Reviewer version 2, the rerun produced
  4 issues (2 Critical, 2 Warning) for $0.000659804. It removed the unsupported
  authentication and duplicate plaintext-HTTP findings and used 800 fewer output
  tokens, but missed URL encoding, response-status handling, and input/concurrency
  bounds; it also added an incorrect “missing await” finding even though returning
  a promise from an `async` function already propagates its result and rejection.
  The experiment improved concision and cost, not overall review quality.

  Version 2 also took 188.8 seconds versus 67.5 seconds for version 1—about
  2.8 times slower despite costing 37.6% less. This reinforces that latency,
  quality, and cost must be evaluated independently rather than treating any
  single metric as a proxy for prompt quality. Evidence: `reviewer-core/src/review/run.ts:188`.

  Engineering Insights worked well as a durable correction and evidence loop:
  it turned the WSL2-only requirement into both operational instructions and a
  retained historical record, and captured the container-lifecycle and prompt-
  evaluation lessons. It does not validate model findings by itself; entries
  still require manual semantic review, deduplication, and evidence.

- **2026-10-02 — Verify project hooks through the real launcher.** Claude Code
  treats a failing `UserPromptSubmit` hook as non-blocking, so a valid hook
  script does not prove that project settings can locate or execute it. Preserve
  `${CLAUDE_PROJECT_DIR}` literally in the configured argument and verify the
  result with a real `claude -p --include-hook-events` session; the successful
  event must include both an exit code of zero and the expected injected
  context. Evidence: `.claude/settings.json:9` (`args`),
  `.claude/hooks/engineering-insights-reminder.mjs:13` (`hook_event_name`).

- **2026-10-20 — L01 mentor follow-up.** The mentor raised two points: per-agent
  PR-list FINDINGS, and package docs that were one paragraph each.
  - **"Latest run" is a business rule.** The aggregation was simple; defining
    "latest" was not. It means the run that *started* last
    (`agent_runs.ran_at`), not the review written last, plus one agent identity
    (`coalesce` of the review's and the run's agent) used for both grouping and
    the shown name. Details:
    [`server/INSIGHTS.md`](server/INSIGHTS.md#what-works) (2026-10-20).
  - **Docs drift silently.** Expanding the docs showed that every package's
    `docs/README.md` "Documents" list still said "None yet", and both module
    `specs/README.md` indexes said "no specs yet", although files existed. The
    e2e prose spec also claimed trace-drawer coverage that flow `04` never had.
    No check catches this, so update the README index in the same commit as the
    document, and derive a spec's assertions from the flow or test that proves
    them.
  - **Evidence for the aggregation** came from a DB-backed matrix of 9 identity
    and ordering cases, and from a live hermetic demonstration: two seeded
    agents, an outdated Critical, and a newer failed run, with the PR-list
    popover showing exactly the two current findings by name.

  Evidence: `server/test/reviews.it.test.ts` (PR-list FINDINGS matrix),
  `server/src/modules/pulls/status.ts:81` (`compareReviewRuns`), and
  `e2e/specs/written/01-pr-findings-ui.md`.

- **2026-10-16** — Homework 2: the approved plan used one-line `@AGENTS.md`
  imports for the required `CLAUDE.md` files, and a sentinel probe below a
  package root showed that this would have stopped Claude Code loading project
  instructions in nested sessions (none at all from `client/src/app`). The
  repository uses symlinks instead, after approval. A probe started only at the
  root or a package root would have passed the broken setup. Details and
  evidence: the 2026-10-16 correction in `LEARNINGS.md`.

- **2026-10-22 — HW2 Gate 3 on stack X2.** Two separately authorized slots ran:
  - experiment 18 without Skill completed;
  - experiment 17 with Skill failed with a 429, attributed by PR #31's
    diagnostics to DeepInfra's shared pool.

  Two unpaid audits found problems that a paid run would only have revealed
  later:
  - **Offline settlement:** the guide's example merged duplicate slot ids
    across stacks and undercharged by up to $0.01, depending on the order of
    the ledgers.
  - **Gate 4 eligibility:** the rule cannot verify any slot under OpenRouter's
    observed metadata and the current 4 s generation-lookup window.

  Details: [`server/LEARNINGS.md`](server/LEARNINGS.md#codebase-patterns--tool--library-notes)
  (2026-10-22, both entries) and
  `docs/plans/HW2-gate3-plan.md` on `main`.

- **2026-10-23 — HW2 Gate 4 provenance blocker: two causes, one draft fix.**
  Applying the eligibility rule to the generation records that Gate 3 read
  29–38 s after each response showed that a longer lookup alone would not
  have been enough. The rule also compared the record's dated model with the
  requested slug, so even a found record failed. The draft fix bounds the
  lookup at about 65 s and freezes the served model. Details:
  [`server/LEARNINGS.md`](server/LEARNINGS.md#codebase-patterns--tool--library-notes)
  (2026-10-23, the extension of the eligibility entry) and
  [`reviewer-core/LEARNINGS.md`](reviewer-core/LEARNINGS.md#codebase-patterns--tool--library-notes)
  (what OpenRouter documents).

- **2026-10-30 — L02 criterion 14: Skills in the system-role message.** The
  mentor ruled that "system prompt" means the literal system message.
  Moving the fenced Skills section there was a small change. The real work
  was the trust step the mentor asked for: an owner approval bound to the
  exact body digest, failing closed before any model call. Findings worth
  keeping:
  - **Rendered-Markdown approval is not content review.** The first approval
    panel sat under the Markdown preview, which hides HTML comments, so an
    owner could approve text they never saw. Approval now happens from the
    raw body.
  - **Draft experiment rules drift from redesigned fixtures.** Both draft
    screening-rule files anchored experiment 18 at `payments.ts:18`, but the
    redesigned fixture's route and lookup are at lines 12–13. A new,
    re-anchored rules file was frozen; regex screening stays provisional.
  - Two environment traps (card overflow hiding a control from pointer
    clicks; concurrent `next dev` sharing `client/.next`) are in
    [`client/LEARNINGS.md`](client/LEARNINGS.md#recurring-errors--fixes) and
    [`e2e/LEARNINGS.md`](e2e/LEARNINGS.md#recurring-errors--fixes).
  Evidence: `reviewer-core/src/prompt.ts` (`assemblePrompt`),
  `server/src/modules/_shared/skill-approval.ts`,
  `docs/homework/L02/prereg/rules-20261030.json`.

- **2026-10-31 — HW2 item A: live system-role trace.** The live trace confirms the system-role
  placement end to end. One owner-approved trace-only slot (`x-18-with-3`,
  $0.00022779, settlement exact to the cent) produced a persisted trace,
  read back through the API, SQL and the drawer. It holds both Skills inside
  the system message in link order, ahead of the guard, and the switched-off
  Skill appears nowhere, so #14 moved to Verified. The same session found
  that a host restart silently invalidates a frozen HW2 manifest, because it
  names the disposable stack's database; that durable rule is in
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes).
  Evidence: `docs/homework/L02/evidence/criterion-14-system-role.md`
  ("Live system-role run trace").

- **2026-10-31 — HW2 item B: a freeze that could not run, found for free.**
  Verifying every binding before issuing a capability caught two defects that
  had existed since the first freeze, at $0. The committed `.json` freeze was
  unreadable by `--prereg`, and the manifest hash followed Postgres heap
  order, which item A's link edits had changed. The fix freezes content, not
  row order. It refuses duplicate names, and `authorize` now compares the
  freeze before it writes a capability. The study design and the prompt
  fingerprints are unchanged. Durable rules are in
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes); the
  audit record is `docs/homework/L02/evidence/item-b-predispatch-halt.md`.
- **2026-10-31 — HW2 item B v3: the output cap ended the confirmatory study.**
  Every binding held, but slot 6 of 20 (a *with* response) reached the
  4,000-token output cap, and the no-retry rule stopped the schedule. Both
  experiments are `incomplete`: #17 was adjudicated 1/5 versus 0/5, #18
  0/5 versus 0/5. The completed #17 *with* slot used 1,736 output tokens,
  and its twin reached 4,000: the length of a response with the Skill
  varies by more than 2×. A future
  pre-registration should size the cap from the longest response seen with
  the Skill, not from the pilot mean. The recording gap that mislabelled the
  failed slot is in
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes).
  Record: `docs/homework/L02/evidence/item-b-confirmatory/README.md`.
- **2026-11-01 — A failed run's record was only as good as its weakest
  write.** Item B v3's truncated slot was billed, and its row held the usage,
  but its trace held a fallback prompt. A report trusting the trace inferred
  "0 Skills". The repair records each stage's exact assembly before the
  provider call and writes the row and the trace in one transaction. It
  classifies legacy traces at read time instead of rewriting them. Two
  independent reviews then found 22 issues in the repair itself, mostly
  untrusted provider text reaching jsonb or logs (NUL bytes, ids, error
  bodies, configured keys). Each was fixed with a test and a mutation check.
  The successor study v4 changes only what the evidence supported:
  - the output cap goes to 8,000;
  - a truncation continues with conservative imputation;
  - adjudication uses a redacted packet;
  - #18 is set aside, because its Skill contradicts its own scoring rule.

  Records: `docs/homework/L02/evidence/item-b-confirmatory/`,
  `docs/homework/L02/PROSPECTIVE-STUDY.md` (v4),
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes).
- **2026-11-01 — Upstream rate limits, not model behaviour, now end the
  confirmatory runs.**
  - **What happened.** The authorized v4 study for #17 stopped at slot 2.
    DeepInfra's shared pool returned 429 (`limit_source
    upstream_provider_shared_pool`) about 300 ms after submission, a few
    seconds after slot 1 completed.
  - **The pattern.** The Phase 1 pilot's *without* slot hit the same 429. v3
    stopped on a truncation, which v4 had designed out. So two of the three
    paid #17 attempts ended on a provider-side 429 that a stop-on-429 rule
    turns into `incomplete`.
  - **Implication.** With a single pinned endpoint, no retries and
    stop-on-429, a 10-slot schedule completes only if the shared pool admits
    every request. Any successor design has to decide the 429 policy
    explicitly before the freeze, for example as a terminal, unbilled,
    non-retried exclusion with pacing between slots.
  - **The trace repair held on its first live failure.** The trace recorded
    the Skill-bearing request that was submitted, the attempt as `submitted`
    with no response ID, and usage `unknown`/`null` rather than 0. The key
    settlement confirmed the 429 was not billed.

  Record: `docs/homework/L02/evidence/item-b-v4-confirmatory/README.md`.
- **2026-11-02 — The #17 interruptions are a design-policy problem, not a
  #17 problem** (extends the 2026-11-01 entry above).
  - **Scale.** Across all 19 paid HW2 dispatches, 4 got HTTP 429: 2 on
    `main`'s Gate 3 (one of them experiment 18), plus Phase 1 and v4. That
    is 21 % (CP95 6–46 %).
  - **Source.** All came from DeepInfra's shared upstream pool (OpenRouter
    `limit_source`), with no rate-limit headers, and none was billed.
  - **No association** with the experiment (p = 0.30) or the Skill
    (p = 1.0). The Skill adds only about 100 prompt tokens.
  - **What fails is the policy.** Stop-on-429 combined with a pinned single
    provider. At the #17 rate, a 10-slot study completes 1.7 % of the time
    under stop-on-429. It completes 69 % of the time under a predeclared
    3-attempt pool that re-attempts only on a classified pre-generation 429.
  - **Reviewer catch.** The independent methodological review found that
    the first validator accepted traces that ended early. Protocol validators
    must check where a trace ends, not only each step.

  Records: `docs/homework/L02/proposals/`.
- **2026-11-02 — v5 settled #17's question as far as this fixture allows,
  and found a timing defect only because the report checked itself.**
  - **Outcome.** Under the authorized P3 attempt pool, the study ran 20
    attempts before the preregistered outage stop. 15 were unbilled upstream
    429s, mostly in *without* trials.
  - **Result.** The sealed blinded adjudication found *with* 0/4 against
    *without* 1/1. With the Skill, the reviewer always flagged the error
    branches and never the exact expiry boundary, as in every earlier
    attempt. The frozen rule fails even in the best case.
  - **The defect.** The report measures each pacing gap from wall-clock
    ledger timestamps, not from the runner's own timer. That exposed waits
    8–9 % short, because the host's monotonic clock runs fast (see
    `server/LEARNINGS.md`).
  - **Lesson.** A protocol property that matters, such as a minimum delay,
    should be verified against an independent clock after the fact.

  Record: `docs/homework/L02/evidence/item-b-v5-confirmatory/`.
- **2026-11-03 — #17's missing half is a reporting gap, not a blindness**
  (refines the 2026-11-02 entry).
  - **What the findings show.** In the archived v3–v5 findings, the exact
    on-point instant appears in a suggested test in 5/5 *with*-Skill reviews
    and 2/4 *without*. Yet only 2 of 9 reviews, one per arm, *name* the
    equality boundary in a title or rationale. That naming is all the frozen
    rule, and the blinded adjudicators, can credit.
  - **The difference is exploratory and not significant** (p = 0.167). The
    official verdicts stand.
  - **Lesson.** A Skill that measurably changes what a model writes can
    still show no effect when the scoring instrument reads only some fields.
    Before blaming the Skill, check which fields the rubric scores.
  - **Overfitting risk.** A Skill revision that tells the model to "report
    it as its own finding" targets the instrument, so it needs a held-out
    evaluation with co-primary explicit and implicit endpoints.

  Records: `docs/homework/L02/proposals/17-skill-effectiveness-analysis.md`,
  `17-18-21-review-record.md`.
- **2026-11-04 — L02 #21: the owner's `/pr-self-review` run, and a safeguard
  that was never in force.** The owner's typed run read both Skill sets in
  one invocation and reported PASS, so #21 moved to Verified. The run itself
  went as designed. The surprise was the environment:
  - **The deny step had nothing to deny.** The owner steps relied on approving
    the router and checks and denying any edit or push. Claude Code ran the
    session in `auto` mode by default, so it never asked for anything. No
    write was attempted, so the result holds, but no denial was tested. That
    is now a mentor question rather than a claim.
  - **The coordinator touched the evidence checkout.** A coordinator session
    whose folder was the scratch checkout scheduled a fallback wake-up.
    Claude Code then wrote `.claude/scheduled_tasks.lock` there, which broke
    the evidence's `diff -r` claim after it was written. Two independent
    reviewers caught it.

  Durable rules: [`LEARNINGS.md`](LEARNINGS.md#codebase-patterns--tool--library-notes)
  and [`LEARNINGS.md`](LEARNINGS.md#recurring-errors--fixes) (2026-11-04).
  Record: `docs/homework/L02/evidence/criterion-21-session.md`.
