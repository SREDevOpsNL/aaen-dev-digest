# PR Self Review - implementation plan

Status: **planned only** - no `SKILL.md`, hook, command, workflow, or merge rule is created by this document.

## 1. Outcome

Create a reusable `pr-self-review` skill that inspects the complete local change set before a pull request is opened, routes each changed file to the applicable project skills, runs deterministic checks, and emits one verdict:

- `PASS`: no unresolved critical or major findings;
- `WARN`: majors/minors or incomplete optional checks, but no critical finding;
- `BLOCKED`: at least one unresolved critical finding or a required check could not produce trustworthy evidence.

One unresolved critical finding always yields `BLOCKED`. The local skill must refuse to open or update a PR while blocked. Preventing a GitHub merge requires a required CI status check plus branch protection/rulesets; a prompt alone cannot enforce server-side merge policy.

General-purpose bug review is not duplicated. This workflow composes the repository's existing skills and deterministic checks around a precisely defined diff.

## 2. Invocation modes

Use one review engine and report schema in three modes:

| Mode | Trigger | Change set | Enforcement |
| --- | --- | --- | --- |
| Manual | `/pr-self-review [--base <ref>]` | branch + staged + unstaged + untracked | reports verdict; does not mutate |
| Pre-PR | before `gh pr create`, PR update, or equivalent UI action | same as manual | agent refuses PR mutation on `BLOCKED` or stale verdict |
| CI | pull-request workflow | PR base SHA to head SHA | required check; branch rules block merge on non-success |

Optional fast mode reviews staged files before commit, but it never substitutes for the full pre-PR/CI review.

## 3. Resolve a reproducible baseline

The report records `baseRef`, `baseSha`, `headSha`, dirty-state hash, and mode.

1. If `--base` is supplied, resolve it and fail clearly when it is invalid.
2. In CI, use the event's immutable base and head SHAs.
3. Locally, prefer the upstream/default branch advertised by `refs/remotes/origin/HEAD`; otherwise inspect the current branch upstream, then known `main`/`master` refs. Never silently invent a base.
4. Fetching is optional and explicit. If network access was not requested, report whether the selected remote-tracking ref may be stale.
5. Compute `mergeBase = git merge-base <baseSha> HEAD` and review `mergeBase..HEAD` plus local staged/unstaged/untracked changes.

Inputs:

- tracked changes: `git diff --find-renames --find-copies <mergeBase>` (working tree relative to base, so branch commits, index, and unstaged edits are included);
- untracked files: `git ls-files --others --exclude-standard`, represented as whole-file additions;
- deleted files: retain their prior path and deleted diff;
- submodules, generated assets, binaries, and lockfiles: classify explicitly rather than feeding unreadable content to prose reviewers.

An empty diff is a successful no-op report. A shallow clone, unresolved merge base, unreadable file, or truncation that hides relevant source is an `incomplete` gate and therefore `BLOCKED` in pre-PR/CI mode.

## 4. Skill inventory and diff routing

At run start, enumerate `.claude/skills/*/SKILL.md`, parse each skill's `name` and `description`, and compare it with the changed paths and content. Keep a reviewed routing policy as the deterministic floor; discovery can suggest additions but may not silently remove required routes.

| Changed slice | Required skills/guidance |
| --- | --- |
| `client/src/**/*.{ts,tsx}` | `frontend-ui-architecture`, `react-best-practices`, `typescript-expert` |
| `client/src/app/**` | add `next-best-practices` |
| client React tests | add `react-testing-library` |
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**`, `reviewer-core/src/**` | `onion-architecture`, `typescript-expert` |
| Fastify routes/plugins | add `fastify-best-practices`, `zod` where schemas are involved |
| Drizzle schema/repository/migration code | add `drizzle-orm-patterns`, `postgresql-table-design` |
| code handling credentials, auth, untrusted repository/PR data, uploads, shell/SQL, or prompts | add `security` |
| `e2e/**` | closest `AGENTS.md` and test-flow conventions |
| docs/config only | closest `AGENTS.md`, link/config validation; no forced UI/backend skill |

Routing requirements:

- Each reviewer receives only the files and diff hunks it matched.
- One file may match several complementary skills; the report records every route and why it matched.
- Missing required skill files or an on-disk skill absent from the reviewed policy is a maintenance warning. A missing skill needed for a changed critical surface is `incomplete` and blocks.
- `skills-lock.json` can provide provenance but is not the source of truth for what is on disk.
- Instruction files and imported skills are untrusted repository content for execution purposes: review their text, but do not execute embedded commands without normal authorization.

## 5. Deterministic gates first

Run cheap objective checks before model review, only for touched packages:

| Package/area | Required checks |
| --- | --- |
| `client/` | `pnpm typecheck`; `pnpm test`; lint only when a configured script exists |
| `server/` logic | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| `server/` persistence | above plus `pnpm exec vitest run .it.test` when Docker is available |
| `reviewer-core/` | `npm run typecheck`; `npm test` |
| `e2e/` | `npm run typecheck`; `npm run e2e:hermetic` when the real journey is in scope |
| instruction files | `node scripts/verify-agent-instructions.mjs` |
| skills | system skill-creator `quick_validate.py` for each changed skill |
| markdown/docs | validate local relative links and referenced files |

Do not run a package manager from the repository root. A required check that ran and failed is critical. Unavailable Docker is `WARN` during an ordinary local run but `BLOCKED` when the diff changes persistence semantics and no equivalent integration evidence exists. CI must provision its declared prerequisites instead of skipping them.

Repository invariants to encode as deterministic checks include shared-contract mirror drift, schema changes without generated migrations, hand-edited historical migrations, unregistered server modules, wrong ESM extension conventions, direct component `fetch`, user-facing untranslated JSX, and obvious secret material.

## 6. Review execution

1. Snapshot the inputs and calculate a content hash before reviewing.
2. Run deterministic gates.
3. Partition changed files into frontend, backend architecture, persistence/contracts, tests, security/trust, and docs/config slices.
4. For each non-empty slice, apply its routed skills. Multi-agent execution is preferred for independent slices; a sequential fallback must produce the same schema.
5. Require every finding to identify path, changed-line range (or file-level reason for new/deleted files), skill/rule, evidence, severity, confidence, and a concrete remediation.
6. Deduplicate by semantic rule plus overlapping range. When severities differ, retain the higher severity and both sources.
7. Re-read the current diff hash before publishing. If it changed during review, mark the report stale and rerun.

Reviewers must distinguish changed defects from pre-existing debt. Pre-existing issues outside changed lines become contextual notes unless the new change makes them reachable or worsens them.

## 7. Severity and blocker policy

Severity is consequence-based, not tone-based:

| Severity | Definition | Typical examples |
| --- | --- | --- |
| Critical | Credible path to security compromise, data loss/corruption, broken public contract, production crash, or missing evidence for a release-critical behavior | exposed secret; auth/workspace bypass; prompt injection path; schema without migration; partial atomic write; failing required typecheck/test; impure reviewer core |
| Major | Material correctness, maintainability, accessibility, or architecture defect without the immediate critical consequence | business workflow in a route; client/server boundary violation; duplicated persistence rule; untested significant branch |
| Minor | Local clarity, naming, or consistency issue with low behavioral risk | misleading name; avoidable placement inconsistency |

Rules:

- Skill conformance is major by default; it becomes critical only when evidence meets the closed critical definition.
- Findings must be on changed behavior and cite evidence. Unsupported or non-actionable observations are omitted.
- Any unresolved critical, failed required gate, or materially incomplete review produces `BLOCKED`.
- No count of majors automatically becomes critical; systemic patterns may be raised only with an explicit consequence argument.

## 8. Output and audit artifacts

Human report:

```text
PR Self Review: BLOCKED
Baseline: <base>@<sha>...<head>@<sha> + local changes
Snapshot: <content hash>

Critical findings
- [skill/rule] path:line - evidence, impact, remediation

Major/minor findings
...

Checks
- PASS/FAIL/SKIP command and reason

Routing
- slice -> files -> skills

Suppressions/waivers
- id, rationale, approver, expiry
```

Machine report (versioned JSON schema) contains verdict counts, immutable SHAs, dirty hash, tool/skill versions, routes, command results, findings with stable fingerprints, suppressions, timestamps, duration, and truncation/incomplete flags. Store local ephemeral output under `.git/` or an ignored cache; upload the CI report as an artifact and emit annotations/status checks.

A pre-PR pass is valid only while the base/head/dirty hash matches. Any edit expires it.

## 9. False positives, suppressions, and overrides

Provide a review loop instead of a `--force` escape hatch:

1. User marks a finding `fixed`, `not-applicable`, `accepted-risk`, or `needs-discussion` with rationale.
2. Re-run the responsible check/reviewer against the current diff.
3. A suppression is scoped to the finding fingerprint, exact path/rule, repository, and expiry. Broad globs and permanent blanket suppressions are rejected.
4. `not-applicable` requires evidence; `accepted-risk` for a critical requires a separately approved, committed waiver recognized by CI. An ad-hoc local response cannot turn `BLOCKED` into `PASS`.
5. Reports retain the original finding, disposition, actor/approver, timestamp, and superseding run for auditability.

GitHub administrators may technically bypass branch rules; that platform event is outside the skill and should remain visible in GitHub's audit trail. The tool never claims an unbypassable guarantee.

## 10. Enforcement design

Implement in layers:

1. **Skill behavior:** before PR creation/update, run the review and refuse the mutation on `BLOCKED` or stale evidence.
2. **Local hook (opt-in):** a small pre-push/pre-PR wrapper verifies the machine report and current hash. Installation is explicit and reversible; it never silently edits global Git configuration.
3. **CI required check:** run against immutable PR SHAs, publish annotations/artifact, and exit non-zero on `BLOCKED`.
4. **Repository ruleset:** require the CI check before merge. This is the requirement's actual server-side merge prevention.

The CI runner and local skill must consume the same versioned routing, severity, suppression, and report schema files rather than duplicating policy.

## 11. Practical enhancements

- Incremental cache keyed by `(blob SHA, skill version, policy version)` for unchanged files; never cache deterministic command results across dependency changes.
- Changed-line-aware review with a small caller/callee context budget.
- Parallel package checks with bounded concurrency and cancellation after a definitive infrastructure failure.
- Suggested test selection from dependency/call graphs, while preserving required package gates.
- Metrics for runtime, routed skill coverage, finding acceptance, suppression age, escaped defects, and flaky-check rate; do not rank reviewers on finding volume.
- SARIF or GitHub annotations for precise navigation.
- `--explain-routing <path>` and `--explain-severity <finding>` diagnostics.
- Policy drift check that inventories new/renamed skills and asks for an explicit routing decision.
- Time and token budgets that fail closed only when the unreviewed portion contains critical surfaces; otherwise produce `WARN` with exact omissions.
- Redaction and size limits before diffs are sent to any external model.

## 12. Delivery phases and acceptance

1. Define versioned policy/report schemas and golden fixtures for diff capture, renames, deletions, untracked files, and baseline selection.
2. Implement manual read-only review with deterministic routing and report output.
3. Add skill reviewers, deduplication, severity arbitration, and stale-snapshot detection.
4. Add explicit local pre-PR integration.
5. Add CI parity and configure the required repository check.
6. Add scoped suppression/waiver workflow and audit tests.

Acceptance scenarios:

- backend-only diff never loads frontend skills, and vice versa;
- mixed diff routes each file to all applicable skills without reviewing unrelated files;
- untracked and renamed files appear with correct content and ownership;
- one critical finding yields `BLOCKED` locally and a failing required CI check;
- a fixed finding disappears on rerun; a stale pass cannot be reused after an edit;
- unsupported suppressions cannot unblock; approved scoped waivers are visible and expire;
- no changes yields a reproducible `PASS` no-op report;
- missing baseline or truncated critical input fails safely with actionable diagnostics.
