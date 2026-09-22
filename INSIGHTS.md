# Engineering Insights

This compatibility file exists for course material that still refers to
`INSIGHTS.md`. DevDigest now keeps its authoritative engineering-insights log
in [`LEARNINGS.md`](LEARNINGS.md) and the package-specific `LEARNINGS.md`
files linked from it.

## Session entries

- **2026-09-21 — L01 severity-filter homework.** Severity counters and filtering
  were implemented entirely in the client over findings already loaded for each
  review run, so verification required no model call. Final implementation and
  verification ran in the authoritative Ubuntu 24.04 WSL2 checkout: typechecks,
  54 unit tests, the production build, and all 7 hermetic browser flows passed.
  The hermetic run used persisted seed data without GitHub or OpenRouter
  credentials, providing direct evidence that the feature added no model call.
  The environment correction is recorded in [`LEARNINGS.md`](LEARNINGS.md) and
  [`server/LEARNINGS.md`](server/LEARNINGS.md#recurring-errors--fixes).

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

  Engineering Insights worked well as a durable correction and evidence loop:
  it turned the WSL2-only requirement into both operational instructions and a
  retained historical record, and captured the container-lifecycle and prompt-
  evaluation lessons. It does not validate model findings by itself; entries
  still require manual semantic review, deduplication, and evidence.
