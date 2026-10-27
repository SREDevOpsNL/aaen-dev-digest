# Physical drag-and-drop and per-agent switch (rows 13, 31; input to 14 and 20)

Stack `hw2f-7d16304f` at `e78fe0b`, disposable and keyless, with no capability.
On 2026-10-25 the owner used a real mouse in Chrome at
`http://localhost:3250/agents/fa0f7454-565d-4419-b2ae-620e894bbce1?tab=skills`
(API Contract Reviewer → Skills). Browser automation cannot start a native
HTML5 drag (see [e2e/LEARNINGS.md](../../../../e2e/LEARNINGS.md)).

The arrangement before the drag was:

| Order | Skill | Per-agent switch |
| --- | --- | --- |
| 0 | breaking-change | on |
| 1 | response-schema | on |
| 2 | semver-discipline | on |

The owner did two things:
1. dragged `semver-discipline` by its ≡ handle above `breaking-change`;
2. switched `response-schema` off for this agent with the right-hand switch,
   leaving its attachment switch on.

Screenshot after the change: [32-skills-tab-after-physical-drag](screenshots/32-skills-tab-after-physical-drag.png).

## API writes made by the UI (server request log)

```
18:01:52.569  POST  /agents/fa0f7454…/skills                 # the drop: one reorder write
18:04:55.561  PATCH /agents/fa0f7454…/skills/73c3291f…       # 73c3291f… = response-schema, switched off
```

Moving `semver-discipline` from position 2 to position 0 with the ↑ buttons
would take two reorder writes, one per step. The log shows a single write, as
one drop produces.

## Persisted state

```
$ curl -s http://127.0.0.1:3251/agents/fa0f7454…/skills
  {'order': 0, 'skill': 'semver-discipline', 'enabled': True, 'link_enabled': True}
  {'order': 1, 'skill': 'breaking-change', 'enabled': True, 'link_enabled': True}
  {'order': 2, 'skill': 'response-schema', 'enabled': True, 'link_enabled': False}

$ psql -d devdigest_hw2f_7d16304f
select s.name, a_s."order", a_s.enabled as link_enabled, s.enabled as skill_enabled
  from agent_skills a_s join skills s on s.id = a_s.skill_id join agents a on a.id = a_s.agent_id
 where a.name = 'API Contract Reviewer' order by a_s."order";
       name        | order | link_enabled | skill_enabled
-------------------+-------+--------------+---------------
 semver-discipline |     0 | t            | t
 breaking-change   |     1 | t            | t
 response-schema   |     2 | f            | t
```

`response-schema` is still attached (row present) and still enabled globally
(`skill_enabled = t`). Only its per-agent link switch is off.

## What the prompt carries (free preview, no generation)

```
$ cli.ts preview --experiment 18 --condition with --keep-links --reservation 0.01 …
ok: true, problems: []
links: operator
linked_skills:   [semver-discipline, breaking-change, response-schema]
prompted_skills: [semver-discipline, breaking-change]
skill_fingerprint:          b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6
expected_skill_fingerprint: b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6
non_skill_fingerprint:      baa2505e57b9… (unchanged)
input bound 12589, worst case $0.00602 (reservation $0.01)
```

The server builds the Skill fingerprint from the Skills section it would send:
the SHA-256 of the canonical JSON of the prompt blocks, in prompt order. It
equals the value computed independently from the skill bodies for exactly
`semver-discipline > breaking-change`. Other possibilities give other values:

| Skills in the prompt | Fingerprint |
| --- | --- |
| semver-discipline > breaking-change | `b4978ce0…` |
| breaking-change > semver-discipline (reversed) | `20154e42…` |
| semver-discipline > breaking-change > response-schema (switch ignored) | `683dd9f8…` |

So the assembled prompt contains only `semver-discipline` and
`breaking-change`, in the dragged order. `b4978ce0…` is the
`--expect-skill-fingerprint` for the trace-only slot `x-18-with-2`. The live
trace was later captured in the completed, owner-authorized trace-only slot
`x-18-with-2`; see [trace evidence](trace-evidence.md).
