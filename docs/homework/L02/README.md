# Homework 02: Skills, Agents & Conventions

This directory is the L02 submission. It is built on the completed L01 homework
(`codex/l01-severity-filters` at `5a3b49643e9f`) and contains only L02 work,
with no L03 Intent Layer and no subagents.

| Document | What it holds |
| --- | --- |
| [ACCEPTANCE.md](ACCEPTANCE.md) | The 53 criteria, each with status, implementation, tests and runtime evidence |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How Skills, Agents, Conventions, the database, prompt assembly and review runs fit together |
| [MENTOR-WALKTHROUGH.md](MENTOR-WALKTHROUGH.md) | How to run the studio and check each area in the UI |
| [TEST-RESULTS.md](TEST-RESULTS.md) | Exact commands, results and environment |
| [EXPERIMENTS.md](EXPERIMENTS.md) | The controlled experiments (criteria 17–20): method, safety, procedure, results |
| [evidence/](evidence/) | Screenshots, API and SQL transcript, repository checks, experiment preflight |

## What L02 adds

- **Agent instructions and development skills.**
  - `AGENTS.md` with `CLAUDE.md` symlinks at the root and in each package.
  - `frontend-ui-architecture` and `onion-architecture` skills.
  - A manual `pr-self-review` workflow skill. Its router sends a mixed client and server diff to both skill sets.
- **Skills Lab.**
  - SKILLS LAB sidebar section (Conventions, Agents, Skills).
  - Skill cards with a side preview.
  - Create and Import, with a preview before saving and `imported_file` provenance.
  - Versions with Diff and Restore.
  - Delete confirmations.
  - Version and `agent_count` on each card.
- **Agent ↔ skill integration.**
  - Link up to 4 skills to an agent.
  - A per-agent enabled switch on each link.
  - Drag-and-drop order stored in `agent_skills.order`.
  - The review prompt takes enabled skills in that order, inside a fenced Skills block.
  - The run trace shows that block with its own token count.
- **Conventions Extractor.**
  - Code-selected samples: config files plus the top 12 files from repo intel.
  - Structured candidates.
  - Accept, Reject and inline Edit, with persisted status.
  - Run Scan and ReScan.
  - A `repo-conventions` skill, created and linked to an agent in one step.
  - A Conventions model row in Settings.
- **API Contract Reviewer** with the `breaking-change`, `response-schema`,
  `semver-discipline` and `deprecation-policy` skills. The last is imported,
  not seeded.
- **Controlled experiments.**
  - Fixtures for criteria 17 and 18.
  - A single-attempt, provider-pinned experiment mode, dispatched from the PR page's Run Review button.
  - A spending ledger with crash recovery and an independent key-usage check.

Also on the branch, as prerequisites:
- workspace-scoped run routes (#10);
- reliable run cancellation and guarded terminal writes (#11);
- loopback-only Postgres (#14);
- server tests isolated from the development database.

## Status

See the count at the top of [ACCEPTANCE.md](ACCEPTANCE.md): 50 Verified,
2 Implemented, 1 Blocked. Still open:
- criterion 14 is **Verified**. The mentor ruled on 2026-10-30 that Skills
  belong in the system-role message, and a live run trace confirmed it on
  2026-10-31 ([evidence](evidence/criterion-14-system-role.md)).
- criteria 17 and 18 are **Implemented, not passed**.
  - The exploratory pilot and the confirmatory Item B v3 run were both
    incomplete ([record](evidence/item-b-confirmatory/README.md)).
  - The authorized successor study v4 for #17 (2026-11-01) stopped at
    slot 2 of 10 on an upstream HTTP 429, so it is also `incomplete`: the
    one adjudicated *without* slot is "no", and no *with* slot completed
    ([record](evidence/item-b-v4-confirmatory/README.md)).
  - Under Skill v1, #18 is unresolved/unsupported. A disclosed Skill v2 needs
    the owner's review ([proposal](prereg/proposal-breaking-change-skill-v2.md)).
- criterion 21 is **Blocked**. It needs a real *interactive* Claude Code
  session in which the owner types `/pr-self-review --base HEAD`
  ([preparation](evidence/criterion-21-preparation.md)).
- original-source verification of the rubric, which was a recovered English
  translation.

Rows 38 and 40 are verified by the [single authorized live extraction](evidence/conventions-live-extraction.md), including model output, grounded persistence, API/SQL read-back and an API-only restart.

## Run it

All development runs in Ubuntu 24.04 WSL2 (see the root [README](../../../README.md)).

```bash
./scripts/dev.sh        # Postgres + API :3001 + web :3000, migrations and seed
```

A disposable, isolated stack with the experiment fixtures, as used for the evidence:

```bash
./scripts/e2e.sh        # hermetic browser flows
```

[MENTOR-WALKTHROUGH.md](MENTOR-WALKTHROUGH.md) lists what to check.
