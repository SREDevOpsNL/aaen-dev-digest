# Agent Skills tab: the two switches, explained (rows 13, 31, 37)

The owner reported that each attached row had two switches whose purposes were
not explained. The right-hand switch had only a hover tooltip and a
screen-reader label. This change improves the UX only. Persistence, the
per-agent `enabled` flag, prompt filtering and drag-and-drop are unchanged.

Screenshot (stack `hw2f-7d16304f`, API Contract Reviewer, after the physical
drag): [33-skills-tab-controls-explained](screenshots/33-skills-tab-controls-explained.png).
The earlier screenshot is
[32-skills-tab-after-physical-drag](screenshots/32-skills-tab-after-physical-drag.png).

## What changed (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab.tsx`)

- **One legend above the list** ("What the controls do"), instead of text on
  every row:
  - **Attached:** links the skill to this agent (up to 4). Switching it off
    detaches the skill from this agent only.
  - **Enabled for this agent:** shown only for attached skills. When it is on,
    the skill is part of this agent's review prompt. Switching it off marks the
    row "Off for this agent" and leaves the skill out of this agent's reviews,
    without detaching it, losing its place in the order, or switching it off
    for other agents. Switch it back on to include it again.
  - **Order:** earlier skills appear earlier in the review prompt. Drag an
    enabled skill by its ≡ handle, or use the arrows.
- **Column headings** (Attached · Skill · Enabled for this agent · Type ·
  Order) sit over fixed-width columns, so each switch lines up under its
  heading.
- **The per-agent state in words** next to its switch: "On" or "Off". An
  unattached skill shows "—" there, with the tooltip "Attach the skill first."
- **Explained statuses:**
  - "Off for this agent" has the tooltip "Attached, but left out of this
    agent's review prompt…".
  - "Disabled globally" has the tooltip "Switched off on the Skills page, so
    no agent uses it…".
  - Only the name and description dim, so the status and controls stay
    readable.
- **Tooltips on both switches:**
  - "Attached to agent: links {name} to this agent. Switch off to detach it
    from this agent only."
  - "Enabled for this agent: puts {name} in this agent's review prompt. Switch
    off to leave it out of this agent's reviews. It stays attached, keeps its
    place, and stays on for other agents."
- **Accessible names**, distinct per switch: "Attach {name} to this agent" and
  "Use {name} in this agent's reviews".

## Live check on the stack

Each row of the rendered tab, with each switch's accessible name and state:

```
legend: What the controls do
semver-discipline draggable=true  [Attach semver-discipline to this agent = true] [Use semver-discipline in this agent's reviews = true]
breaking-change   draggable=true  [Attach breaking-change to this agent = true]   [Use breaking-change in this agent's reviews = true]
response-schema   draggable=false [Attach response-schema to this agent = true]   [Use response-schema in this agent's reviews = false]
Assertion Quality draggable=false [Attach Assertion Quality to this agent = false]
Behavioral Coverage draggable=false [Attach Behavioral Coverage to this agent = false]
Edge Cases and Error Paths draggable=false [Attach Edge Cases and Error Paths to this agent = false]
Test Isolation and Determinism draggable=false [Attach Test Isolation and Determinism to this agent = false]
```

- e2e flow 12 (`12-agent-skills.flow.json`, read-only) was run alone against
  this stack: 11 of 11 steps pass.
- The reviewer's stored links were unchanged before and after:
  `[(0, semver-discipline, on), (1, breaking-change, on), (2, response-schema, off)]`.

## Tests

`SkillsTab.test.tsx`, 13 tests:
- the existing behaviour tests, with the new accessible names;
- **explains both switches once and labels their columns**;
- **every switch has an accessible name and a tooltip that says what it
  does**;
- **the per-agent state in words, and the off state explained where it
  appears**.

Client: typecheck, lint and 118 of 118 tests pass. Hermetic browser flows:
14 of 14 pass (`scripts/e2e.sh`). Flow 13 now reads each skill's name from
`[data-testid=skill-row-name]`. Its old `label > span` selector matched the
new hidden switch label instead; CI caught that on `dc97807`.
