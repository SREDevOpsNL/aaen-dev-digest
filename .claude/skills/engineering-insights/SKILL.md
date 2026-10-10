---
name: engineering-insights
description: >-
  Reads the relevant DevDigest LEARNINGS.md and INSIGHTS.md before work and, at
  wrap-up of every task, evaluates whether the task produced a non-obvious,
  evidence-backed finding; qualifying findings are appended, deduplicated, to
  INSIGHTS.md (course-required session record) or LEARNINGS.md (durable,
  reusable knowledge). Use at the start and end of every task, immediately
  after a user correction, failed approach, surprising behavior or error,
  architectural decision, or reusable fix, and for wrap-up requests such as
  "wrap up", "what did we learn", "lessons learned", or "retro".
---

# Engineering Insights

Every coding agent runs this workflow at the start and wrap-up of every task,
without waiting for an explicit request: an agent with native skill support
invokes this skill, and any other agent reads this file and executes it
directly. In Claude Code, the project `UserPromptSubmit` hook in
`.claude/settings.json` injects a reminder into each submitted prompt; it is a
reminder, not proof that the evaluation ran or that an entry was written. A task
with nothing non-obvious ends with no write.

Each package and the repository root keep two files with different roles:

- `INSIGHTS.md` is the course-required record of significant, evidence-backed
  findings from a work session.
- `LEARNINGS.md` is durable engineering knowledge: reusable discoveries a future
  session should apply.

1. Resolve the relevant files by the task or finding's subject, not by every
   package the task touches:
   `client/**` -> `client/`; `server/**`, including
   `server/src/modules/repo-intel/**` -> `server/`; `reviewer-core/**` ->
   `reviewer-core/`; `e2e/**` and `scripts/e2e.sh` -> `e2e/`. The root files
   take CI, repository tooling, `*/src/vendor/shared/**`, and findings that
   genuinely apply across packages. Split unrelated findings between their
   module files.
2. Before starting work, read the resolved module `LEARNINGS.md` and
   `INSIGHTS.md` in full; also read the root ones for cross-package work. Report
   `Read <file> - <up to 3 relevant points>` or `Read <file> - nothing relevant`
   for each so the read is observable. Apply existing entries unless current
   source contradicts them.
3. Prioritize user corrections, but hold every entry to the same bar: record
   only a verified finding that a future session could not get directly from
   current code or curated docs. If it would be obvious to anyone reading them,
   skip it. Write at most three entries per task.
4. Choose the file by role. A significant finding from this session goes in
   `INSIGHTS.md`; reusable knowledge a future session should apply goes in
   `LEARNINGS.md`. When one finding serves both, write it in full once and give
   the other file a one-line dated entry that links to it instead of repeating
   it.
5. Before writing, read the target file in full again and search it for the key
   identifier. Skip duplicates and near-duplicates rather than rephrasing them.
   If current code contradicts an entry, trust the code and append a correction
   that identifies the prior entry. Automated capture follows this same
   read-first and duplicate-check workflow.
6. During ordinary or automated capture, append a dated bullet at the end of
   the matching heading; never overwrite, alter, delete, or reposition prior
   text. A correction or extension is a new dated bullet at the end of that
   heading that explicitly references the earlier entry.
7. Use only the file's fixed headings: the seven headings in every
   `LEARNINGS.md` and module `INSIGHTS.md`, and `Session entries` in root
   `INSIGHTS.md`. `Decisions` must name the chosen option, rationale, and
   rejected alternative. Use `Session Notes` only for durable context that fits
   no other heading; never repeat another entry or create a session diary.
8. Make an entry actionable when read cold: state what is true, why it matters,
   and what to do. For code evidence, use this exact shape:

   ```markdown
   - **YYYY-MM-DD** — <finding>. Evidence: `path:line` (`symbol`).
   ```

   Use a command, exact error, test, or source URL when no code location applies.
9. End with one line per file written: `<file> — added under <heading>: <gist>`,
   list skipped duplicates, or say `nothing worth recording`.

Read [reference.md](reference.md) when calibrating entry quality, choosing a
heading, or performing explicitly requested maintenance. Ordinary capture does
not prune, consolidate, promote, or split files.

During ordinary capture, this skill records insights and learnings only. It
does not change specs or substitute for project documentation.
