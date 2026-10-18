# API Contract skills

Four review skills for the built-in **API Contract Reviewer** agent. Each file
is a self-contained skill: a level-one heading with the skill name, a
`Description:` line (the directive the reviewer applies), the rules, the
severity scale, and one good and one bad example.

| Skill | Seeded | How it reaches the agent |
| --- | --- | --- |
| [`breaking-change`](./breaking-change.md) | yes | linked by the seed |
| [`response-schema`](./response-schema.md) | yes | linked by the seed |
| [`semver-discipline`](./semver-discipline.md) | yes | linked by the seed |
| [`deprecation-policy`](./deprecation-policy.md) | **no** | imported from this file and linked (below) |

The seed copies the three seeded files verbatim (`server/src/db/seed-skills.ts`);
a unit test fails if a seeded body or description drifts from its file.

## Mandatory setup: import `deprecation-policy`

A freshly seeded workspace has the API Contract Reviewer with **three**
skills. The fourth is imported for real, so at least one skill linked to the
agent has imported provenance (Homework 2 criteria 16 and 43). Do this once
per environment:

1. **Skills** → **Add skill** → **Import skill**, choose
   `docs/skills/api-contract/deprecation-policy.md`. The drawer shows the body
   before saving; the name `deprecation-policy` comes from the heading.
2. **Import skill**. The skill is saved with source `imported_file`, disabled,
   and opens on its Config tab.
3. On the Config tab, set **Description** to the file's `Description:` line,
   **Type** to `rubric`, turn it on, and **Save**.
4. **Agents** → **API Contract Reviewer** → **Skills**: turn on
   `deprecation-policy`. The tab shows **4 / 4 attached**.

Expected result:

- the Skills page shows all four skills, `deprecation-policy` with the
  **Imported** badge;
- in PostgreSQL, `skills.source = 'imported_file'` for `deprecation-policy`,
  its body equals this file, and `agent_skills` holds four rows for the agent
  in the order above.

Run the setup on a disposable stack (`npm run e2e:hermetic` style), not on
the development database, unless that is explicitly intended.
