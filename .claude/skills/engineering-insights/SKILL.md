---
name: engineering-insights
description: >-
  Reads the relevant DevDigest LEARNINGS.md before work and conditionally
  appends non-obvious, evidence-backed findings after discoveries. Use at the
  start of module work, immediately after a user correction, failed approach,
  surprising behavior or error, architectural decision, or reusable fix, and
  for wrap-up requests such as "wrap up", "what did we learn", "lessons
  learned", or "retro".
---

# Engineering Insights

1. Resolve the relevant file by the task or finding's subject, not by every
   package the task touches:
   `client/**` -> `client/LEARNINGS.md`; `server/**`, including
   `server/src/modules/repo-intel/**` -> `server/LEARNINGS.md`;
   `reviewer-core/**` -> `reviewer-core/LEARNINGS.md`; `e2e/**` and
   `scripts/e2e.sh` -> `e2e/LEARNINGS.md`. Root `LEARNINGS.md` takes CI,
   repository tooling, `*/src/vendor/shared/**`, and findings that genuinely
   apply across packages. Split unrelated findings between their module files.
2. Before starting work, read the resolved module file in full; also read root
   `LEARNINGS.md` for cross-package work. Report `Read <file> - <up to 3
   relevant points>` or `Read <file> - nothing relevant` so the read is
   observable. Apply existing entries unless current source contradicts them.
3. Prioritize user corrections, but hold every entry to the same bar: record
   only a verified finding that a future session could not get directly from
   current code or curated docs. If it would be obvious to anyone reading them,
   skip it. Write at most three entries per task.
4. Before writing, read the target file in full again and search it for the key
   identifier. Skip duplicates and near-duplicates rather than rephrasing them.
   If current code contradicts an entry, trust the code and append a correction
   that identifies the prior entry. Automated capture follows this same
   read-first and duplicate-check workflow.
5. During ordinary or automated capture, append a dated bullet at the end of
   the matching heading; never overwrite, alter, delete, or reposition prior
   text. A correction or extension is a new dated bullet at the end of that
   heading that explicitly references the earlier entry.
6. Use only the file's seven fixed headings. `Decisions` must name the chosen
   option, rationale, and rejected alternative. Use `Session Notes` only for
   durable context that fits no other heading; never repeat another entry or
   create a session diary.
7. Make an entry actionable when read cold: state what is true, why it matters,
   and what to do. For code evidence, use this exact shape:

   ```markdown
   - **YYYY-MM-DD** — <finding>. Evidence: `path:line` (`symbol`).
   ```

   Use a command, exact error, test, or source URL when no code location applies.
8. End with one line: `<file> — added under <heading>: <gist>`, list skipped
   duplicates, or say `nothing worth recording`.

Read [reference.md](reference.md) when calibrating entry quality, choosing a
heading, or performing explicitly requested maintenance. Ordinary capture does
not prune, consolidate, promote, or split files.

During ordinary capture, this skill records learnings only. It does not change
specs or substitute for project documentation.
