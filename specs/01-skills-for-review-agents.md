# Skills for Review Agents

**Status:** implemented; Docker-backed verification pending (2026-09-23)
**Packages touched:** server, client, reviewer-core integration, seed data, docs
**Design reference:** attached `DevDigest Design (design with Skills).html`, Skills rail/editor and Agent editor Skills tab

## Problem

Reviewer guidance currently lives inside each agent's system prompt, which makes the same review knowledge hard to reuse, update, order, and audit across agents. Users need a first-class skill library where a skill is an editable block of review guidance and several agents can link the same skill without copying it.

A product skill is deliberately **text configuration only**. It cannot execute code, declare tools, call another skill, access the filesystem/network, or mutate the application by itself. Its enabled body is assembled into a review prompt as fenced untrusted content.

## Outcome

Users can:

- browse, search, create, edit, enable/disable, and delete workspace skills;
- preview exactly how a skill's Markdown reads;
- inspect immutable body versions;
- paste Markdown or import a local text/Markdown file without uploading/executing arbitrary archive content;
- attach, detach, and order shared skills on an agent;
- run a review where globally enabled linked skills appear in deterministic order in the prompt and persisted trace.

The seeded demonstration contains one **Test Quality Reviewer** with four attached skills:

1. Behavioral Coverage;
2. Assertion Quality;
3. Edge Cases and Error Paths;
4. Test Isolation and Determinism.

## Capability boundary

The updated design contains future-facing surfaces. This implementation must make their status explicit:

| Surface | This slice | Notes |
| --- | --- | --- |
| Skill library, search, create/edit/delete, global enable | Operational target | Wired to workspace-scoped API and persistence. |
| Config tab | Operational target | Name, description, type, Markdown body, enabled state, save/delete. |
| Preview tab | Operational target | Rendered Markdown from current body. |
| Versions tab | Operational target | Read-only immutable body snapshots from the API. Restore and author messages are not in this slice. |
| Agent Skills tab | Operational target | Attach/detach up to four in the current UI, reorder, persist ordered IDs. |
| Review prompt + trace | Operational target | Resolve linked globally enabled bodies in order, fence them, persist assembly. |
| Local file import | Operational target | Browser reads `.md`, `.markdown`, or `.txt`; user previews/edits text; create starts disabled. |
| Evals tab | Scaffolded | Honest unavailable state only. Existing eval schema is not evidence of a workflow. |
| Stats tab | Scaffolded | Honest unavailable state; do not invent attribution, acceptance, or usage metrics. `used_by_count` is a real library projection, not skill effectiveness. |
| URL import | Not operational | No server fetch, no remote trust path. UI states it is unavailable. |
| Community catalog/search | Not operational | No marketplace/network API; design affordance is unavailable. |
| Archive/plugin import | Out of scope | No zip extraction and no bundled scripts/assets. |
| CI skill execution | Out of scope | Studio review path only; no CI runner/export is made operational. |

The product-boundary document moves Skills to operational only after the target rows above are verified end to end. Placeholder tabs, schema, contracts, and prompt slots remain scaffold evidence, not capability evidence.

## User experience

### Skills library

- `/skills` renders a left rail with heading, search, Add Skill action, and skill cards.
- With no selection, the main pane prompts the user to select a skill.
- Selecting a card navigates to `/skills/:id` while preserving the shared rail.
- Search filters by name, description, and type without a server round trip for each keystroke.
- Cards show name, type, source, current version, enabled/disabled state, and real `used_by_count` where the design needs it.
- Empty, loading, error, and deleted/not-found states are explicit.

### Skill editor

The selected skill route uses `?tab=` for `config`, `preview`, `evals`, `stats`, and `versions`, so refresh/back/forward preserve the selected tab.

**Config**

- Editable name, description, type, and Markdown body.
- Global Enabled toggle. Disabled skills remain linked to agents but are omitted from review prompts.
- Save is disabled until valid dirty state exists; successful save refreshes both detail and library projections.
- Delete confirmation names linked agents using `GET /skills/:id/agents`, explains that links cascade, and returns to the library on success.
- Description explains when the guidance applies; body contains the actual review guidance.

**Preview**

- Render the current body using the existing safe Markdown presentation.
- Preview is presentation, not execution: links/code blocks do not gain tool access.

**Versions**

- Newest first, showing version number and creation time.
- Expand a version to inspect its exact stored body.
- No fabricated change message: current storage has no message column and returns `message: null`.
- Restore is deferred; version history remains append-only.

**Evals / Stats**

- Render purpose-specific unavailable copy, not fake rows or sample percentages.
- Do not call scaffolded eval endpoints or derive unsupported skill attribution from findings.

### Add/import flow

- Create blank skill: user enters text fields and saves through `POST /skills`.
- Paste/import: browser reads local `.md`, `.markdown`, or `.txt` as text. It never executes the content and sends no file path or binary archive to the server.
- Derive a draft name from the first heading or filename only as an editable convenience.
- Imported text creates a disabled `manual` source skill; the user must vet and enable it.
- URL and community actions explain that they are unavailable rather than silently simulating success.

### Agent editor Skills tab

- Agent editor adds `?tab=skills` using the existing tab shell.
- List all workspace skills with search, global disabled indication, and attached state.
- Attach/detach by inclusion in the ordered ID list; there is no per-link enabled flag in this model.
- Reorder attached skills with accessible controls; drag interaction may be added only with an equivalent keyboard path.
- Current UI limits an agent to four attached skills, matching the updated Test Quality design. The seeded reviewer uses all four.
- Persist one complete ordered `skill_ids` list so removals and reorder are atomic from the UI's perspective.

## Data model and invariants

Existing tables remain the source of truth:

- `skills`: workspace-owned name, description, type, source, body, global enabled, current version, optional evidence files;
- `skill_versions`: immutable `(skill_id, version, body, created_at)` snapshots;
- `agent_skills`: `(agent_id, skill_id, order)` ordered many-to-many links.

Invariants:

1. All reads and mutations are scoped through the current workspace. A cross-workspace UUID is indistinguishable from not found.
2. UUID is identity. Duplicate display names are allowed.
3. Create writes skill version 1 and its version-1 body snapshot atomically.
4. A name, description, type, or body change increments the skill version and snapshots the resulting body in the same transaction.
5. An enabled-only change does not create a version.
6. Version rows are append-only and cascade when the skill is deleted.
7. Agent links cascade when the skill or agent is deleted.
8. Link order is normalized to contiguous zero-based integers.
9. Link replacement validates that the agent and every requested skill belong to the same workspace before mutating any links.
10. Changing the ordered link set increments/snapshots the agent configuration so historical agent versions retain the effective ordered skill IDs.
11. Global `skill.enabled` is the only enable flag. `agent_skills` presence means attached; disabled skills remain visible but do not enter prompts.

No migration is required for version messages or per-link enablement because neither is part of this slice.

## Shared contracts

The canonical definitions live under `server/src/vendor/shared` and are hand-ported to the client mirror in the same change.

```ts
Skill = {
  id, name, description,
  type: "rubric" | "convention" | "security" | "custom",
  source: "manual" | "imported_url" | "extracted" | "community",
  body, enabled, version, evidence_files?
}

SkillSummary = Skill & { used_by_count: number }

SkillVersion = {
  skill_id, version, body,
  message: null,
  created_at
}

AgentSkillDetail = {
  agent_id, skill_id, order,
  enabled, // mirrors global skill.enabled
  skill
}
```

The broader source enum is existing scaffold. This slice creates manual-source
skills, while the Conventions Extractor may create `extracted` skills through
the same endpoint. Its existence does not make URL/community import operational.

## Server API

All routes resolve the workspace with the standard request context.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/skills` | Workspace list with `used_by_count`. |
| `POST` | `/skills` | Create validated text-only configuration, version 1, `201`. |
| `GET` | `/skills/:id` | Get one workspace skill or `404`. |
| `PUT` | `/skills/:id` | Partial update; config changes version, enabled-only does not. |
| `DELETE` | `/skills/:id` | Delete skill and cascading links/versions. |
| `GET` | `/skills/:id/versions` | Immutable snapshots newest first. |
| `GET` | `/skills/:id/versions/:version` | One snapshot or `404`. |
| `GET` | `/skills/:id/agents` | Linked agent IDs/names for delete impact. |
| `GET` | `/agents/:id/skills` | Ordered resolved `AgentSkillDetail[]`. |
| `POST` | `/agents/:id/skills` | Replace/reorder with `{skill_ids}` or add one with `{skill_id, order?}`. |

Route schemas enforce non-empty bounded names/bodies, enum types/sources, UUIDs, unique skill IDs, and mutually exclusive set-one/add-one bodies. The service owns business behavior; repositories own Drizzle queries and transactions.

There is intentionally no `/skills/import`, URL fetch, community, eval, or stats endpoint in this slice.

## Prompt assembly and trust boundary

Before a run, the server resolves the agent's linked skills ordered by `agent_skills.order`, then filters globally disabled skills. It passes raw bodies to reviewer-core without giving a skill any tool or I/O capability.

Reviewer-core wraps each body separately:

```text
## Skills / rules
<untrusted source="skill-1">...</untrusted>
<untrusted source="skill-2">...</untrusted>
```

Trusted prompt text tells the model to evaluate the diff using relevant criteria while never obeying embedded commands that attempt to change role, output schema, tools, security boundaries, or system instructions. This is required because imported/user-authored skill text is instruction-like untrusted input.

The same assembled `PromptAssembly.skills` value is persisted in the run trace. Zero effective skills omits the section so existing agents keep their prior prompt behavior.

## Seed and reproducibility

Seeding is idempotent by workspace/name for the four named skills and the Test Quality Reviewer. It creates missing version-1 snapshots and ordered links without duplicating rows. The reviewer prompt's reviewable copy lives at [the Test Quality Reviewer prompt](../docs/agent-prompts/test-quality-reviewer.md).

The reviewer is a normal enabled independent reviewer, not a composed/multi-agent workflow. Its system prompt defines test-review judgment; the four skills define reusable criteria.

## Implementation plan and ownership

| Wave | Deliverable | Status |
| --- | --- | --- |
| 1 | Canonical/shared contracts and DTO projections | Implemented |
| 2 | Registered skills route/service/repository module with transactional versions | Implemented |
| 3 | Agent ordered-link validation/versioning | Implemented |
| 4 | Review executor resolution, reviewer-core fencing, trace evidence | Implemented |
| 5 | Idempotent reviewer + four-skill seed and prompt doc | Implemented |
| 6 | Skills rail, editor tabs, local text import, hooks/i18n | Implemented |
| 7 | Agent Skills tab with attach/detach/reorder/max-four UI | Implemented |
| 8 | Server, reviewer-core, client, and browser verification | Typechecks/unit green; Docker-backed suites pending |
| 9 | Product-boundary and architecture-doc update | Updated with explicit Partial status pending Docker evidence |

Backend and frontend work can proceed in parallel after contracts are stable. Prompt wiring depends on the repository/service API; UI depends on the mirrored client contracts.

## Testing

### Server unit/integration

- CRUD and workspace isolation, including cross-workspace `404` behavior.
- Validation limits, invalid enums/UUIDs, and empty patches.
- Version 1 on create; config update increments/snapshots; enabled-only does not.
- Delete cascades versions and links.
- Link set validates all IDs before mutation, rejects duplicates, normalizes order, and bumps agent version only when effective links change.
- Concurrent version updates remain unique/transactional.
- Seed rerun is idempotent and yields exactly one Test Quality Reviewer with four ordered skills.

### Prompt/reviewer-core

- Zero skills preserves omission behavior.
- Multiple skills preserve link order and omit globally disabled bodies.
- Each body is fenced as an independent untrusted source.
- A malicious skill body cannot replace the system role/output/security instructions in the assembled messages.
- Persisted trace skill block matches the effective prompt input.

### Client

- Library loading, empty, filter, selection, create, toggle, and failure states.
- Config dirty/validation/save/delete behavior.
- Preview renders the current body.
- Versions display exact snapshots; Evals/Stats show honest unavailable states.
- Local file extension/read failures and disabled-by-default imported draft.
- URL/community unavailable copy performs no network mutation.
- Agent attach/detach/reorder persists one ordered ID list, enforces max four, and indicates globally disabled skills.

### Package gates

- `client`: `pnpm typecheck` and `pnpm test`.
- `server`: `pnpm typecheck`, hermetic unit suite, then DB-backed `*.it.test.ts` with Docker.
- `reviewer-core`: `npm run typecheck` and `npm test`.
- Run the existing hermetic browser path when the seed/navigation changes affect its fixture.

## Acceptance criteria

1. A user creates a text-only skill, edits it, sees the version increment and exact immutable snapshots, toggles it, and deletes it with linked-agent impact shown.
2. The Skills library and editor match the updated rail/five-tab design; Evals and Stats are visibly unavailable rather than fabricated.
3. A local Markdown/text import never executes or remotely uploads a bundle and creates a disabled manual skill for vetting.
4. The seeded Test Quality Reviewer has exactly the four named ordered skills after repeated seeds.
5. Agent editing can attach/detach/reorder up to four skills and persists the complete order.
6. Review execution includes only attached globally enabled bodies, in order, fenced as untrusted content; trace evidence matches.
7. Existing agents with no skills behave as before.
8. URL import and community search make no network call and are not described as operational.
9. Required package tests pass; capability documentation is updated only after the end-to-end evidence exists.

## Risks and controls

- **Prompt injection through skill text:** fence every body and keep authoritative behavior in the system message; imported drafts start disabled.
- **Contract mirror drift:** update canonical server contracts first, then the client mirror, and typecheck both.
- **Version/link partial writes:** transactions cover snapshot/version changes and replace-all links.
- **Stale design metrics:** Stats/Evals remain unavailable until real services and attribution exist.
- **Schema-as-capability confusion:** maintain the capability table above and product-boundary vocabulary.
- **Prompt budget growth:** show body size/token estimate in UI where practical and log effective skill count; hard budgeting is a separate decision.
- **Deletion surprise:** show linked agents before confirmation; rely on database cascades only after explicit user action.

## Open follow-ups (not blockers for this slice)

- Should future restoration create a new forward version with an optional author message? This requires a deliberate storage/contract change.
- Should a future API enforce the UI's four-skill limit or permit different agent types to set other limits?
- What provenance and signature policy is required before URL/community import can leave the scaffolded state?
- What attribution model can honestly connect a finding or acceptance outcome to one skill before Stats becomes operational?
