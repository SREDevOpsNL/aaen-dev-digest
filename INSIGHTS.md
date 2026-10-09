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
