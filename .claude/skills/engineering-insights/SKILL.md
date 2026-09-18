---
name: engineering-insights
description: >-
  Appends non-obvious, evidence-backed learnings to the LEARNINGS.md where a
  DevDigest finding applies. Use immediately when a user correction, failed
  approach, surprising behavior or error, architectural decision, or reusable
  fix emerges, and for wrap-up requests such as "wrap up", "what did we learn",
  "lessons learned", or "retro".
---

# Engineering Insights

1. File each finding by its subject, not by every package the task touched:
   `client/**` -> `client/LEARNINGS.md`; `server/**`, including
   `server/src/modules/repo-intel/**` -> `server/LEARNINGS.md`;
   `reviewer-core/**` -> `reviewer-core/LEARNINGS.md`; `e2e/**` and
   `scripts/e2e.sh` -> `e2e/LEARNINGS.md`. Root `LEARNINGS.md` takes CI,
   repository tooling, `*/src/vendor/shared/**`, and findings that genuinely
   apply across packages. Split unrelated findings between their module files.
2. Prioritize user corrections, but hold every entry to the same bar: record
   only a verified finding that a future session could not get directly from
   current code or curated docs. If it would be obvious to anyone reading them,
   skip it. Write at most three entries per task.
3. Before writing, read the target file in full and search it for the key
   identifier. Skip duplicates and near-duplicates rather than rephrasing them.
   Apply existing entries as guidance; if current code contradicts one, trust
   the code and add a correction.
4. During normal capture, append a dated bullet at the end of the matching
   heading and never alter or delete prior text. To correct or extend an entry,
   insert a dated note directly beneath it so readers see both together.
5. Use only the file's seven fixed headings. `Decisions` must name the chosen
   option, rationale, and rejected alternative. Use `Session Notes` only for
   durable context that fits no other heading; never repeat another entry or
   create a session diary.
6. Make an entry actionable when read cold: state what is true, why it matters,
   and what to do. For code evidence, use this exact shape:

   ```markdown
   - **YYYY-MM-DD** — <finding>. Evidence: `path:line` (`symbol`).
   ```

   Use a command, exact error, test, or source URL when no code location applies.
7. End with one line: `<file> — added under <heading>: <gist>`, list skipped
   duplicates, or say `nothing worth recording`.

Read [reference.md](reference.md) when calibrating entry quality, choosing a
heading, or performing explicitly requested maintenance. Ordinary capture does
not prune, consolidate, promote, or split files.

During ordinary capture, this skill records learnings only. It does not change
specs or substitute for project documentation.
