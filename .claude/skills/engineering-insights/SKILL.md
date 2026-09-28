---
name: engineering-insights
description: >-
  Runs automatically for every DevDigest task. It reads the relevant
  LEARNINGS.md and INSIGHTS.md, evaluates whether the task produced a
  non-obvious, evidence-backed finding, and conditionally appends a
  deduplicated course-session entry to the relevant module INSIGHTS.md.
---

# Engineering Insights

Run this skill automatically at the start and wrap-up of every task, without an
explicit user request. Every invocation performs routing, reading, and
deduplication evaluation. A task with no significant non-obvious finding ends
with no write.

1. Resolve the relevant files by the task or finding subject, not by every
   package the task touches: client/** routes to client/INSIGHTS.md;
   server/** routes to server/INSIGHTS.md; reviewer-core/** routes to
   reviewer-core/INSIGHTS.md; and e2e/** routes to e2e/INSIGHTS.md. Root
   INSIGHTS.md takes CI, repository tooling, shared vendor contracts, and
   genuinely cross-package findings.
2. Before starting work, read the resolved module LEARNINGS.md and INSIGHTS.md
   in full. For cross-package work, also read root LEARNINGS.md and INSIGHTS.md.
   Report what was read and apply existing entries unless current source
   contradicts them.
3. Record only a verified finding that a future session could not get directly
   from current code or curated docs. Prioritize user corrections, skip obvious
   or duplicate entries, and write at most three entries per task.
4. Before writing, read the target file again and search for the key identifier.
   If current code contradicts an entry, append a dated correction that names
   the prior entry; never overwrite or reposition history.
5. Append a dated bullet under a fixed heading in the relevant module
   INSIGHTS.md. LEARNINGS.md may retain companion durable context but does not
   replace the required INSIGHTS.md entry.
6. Use only the seven fixed headings. Decisions must name the chosen option, rationale, and rejected alternative. Use Session Notes only for durable context that fits no other heading.
7. Make each entry actionable: state what is true, why it matters, what to do,
   and dated file:line evidence when code is relevant.
8. End by saying which insight file was updated, which duplicate was skipped,
   or that nothing was worth recording.

Read reference.md when calibrating entry quality or performing explicitly
requested maintenance. Ordinary capture does not change specs or substitute for
project documentation.
