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
