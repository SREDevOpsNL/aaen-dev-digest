# Mentor walkthrough

A practical path through the L02 features in the UI. Every step is unpaid
except where marked. Screenshots of each step are in
[evidence/screenshots/](evidence/screenshots/). Their numbers match the list
below.

## Start

In WSL, from the repository root:

```bash
./scripts/dev.sh
```

Then open <http://localhost:3000>. With no OpenRouter key, the agent model
list is empty and Run Review fails at the model call. Everything below that
is not marked paid still works.

## 1. Agent instructions and skills (rows 1–5, 21)

```bash
git ls-files -s CLAUDE.md server/CLAUDE.md client/CLAUDE.md reviewer-core/CLAUDE.md   # mode 120000
node scripts/verify-agent-instructions.mjs
node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs
```

Read `.claude/skills/frontend-ui-architecture/SKILL.md`,
`.claude/skills/onion-architecture/SKILL.md` and
`.claude/skills/pr-self-review/SKILL.md`. In Claude Code, `/pr-self-review` on
a diff that touches both `client/` and `server/` loads both skill sets.

## 2. Skills Lab (rows 6–12, 15, 16, 22–29, 44, 52)

1. The sidebar shows **SKILLS LAB** with Conventions, Agents and Skills
   (01).
2. **Skills:** each card has name, type, description, toggle, version, agent
   count and Delete (02). Clicking a card opens a side preview (03).
3. **Add skill → Create** (04, 05): fill in name, description, type and a
   Markdown body, then create. The skill detail page has Config, Preview and
   Versioning tabs (06); Preview renders the Markdown (07).
4. Edit the body twice, then open **Versioning** (08). Click **Diff** on v1
   (09), then **Restore** on v1 (10). A new current version appears with v1's
   body (11).
5. **Add skill → Import**: choose `docs/skills/api-contract/deprecation-policy.md`.
   Check the preview (12), import, switch it on from its card, and see the
   **Imported** badge (13).
6. A card's **Delete** asks for confirmation (Confirm, Cancel, X) (22).

## 3. Agents (rows 13, 14, 30–37)

1. **Agents** shows cards with name, description, model, toggle and the
   linked-skill count (01). Delete asks for confirmation (20) and removes the
   agent (21).
2. Open **API Contract Reviewer**. It has exactly two tabs, Config (19) and
   Skills (14).
3. **Skills tab** (33). A legend above the list explains the controls. The
   columns are headed Attached, Skill, Enabled for this agent, Type and Order.
   - **Attached** (left switch) links a skill to this agent, up to 4.
   - **Enabled for this agent** (right switch, attached skills only) decides
     whether the skill goes into this agent's review prompt. Switching it off
     keeps the skill attached and in its place, and leaves it on for other
     agents.

   Steps:
   - Filter by name (15).
   - Link `deprecation-policy` (4 / 4 attached) (16). The card count updates
     without a reload (17).
   - Switch one attached skill's **Enabled for this agent** off (18). It
     stays attached, reads "Off" and "Off for this agent", and can no longer
     be dragged. Switch it back on to include it again.
4. **Drag** an enabled skill above another by its ≡ handle with the mouse.
   The order is saved and survives a reload. It has to be a real pointer drag;
   a browser-automation tool cannot do it. The owner's drag on the evidence
   stack (32) is verified through the API, SQL, the server's request log and
   the prompt fingerprint in [drag-verification.md](evidence/drag-verification.md).
5. **Paid** (row 14, criteria 19 and 20): after the drag, run a review of a
   PR with this agent. Then open **PR → Agent runs → the run's trace**. The
   Skills block shows the enabled skills in the dragged order, leaves out the
   one switched off, and carries its own token count.

### Criterion 14: system-role placement (mentor ruling, 2026-10-30)

The mentor confirmed that criterion 14 means the literal system-role message,
that drag order must change the executed prompt, and that the order must be
visible in the prompt-assembly trace. The mentor also recommended a trust or
approval step for imported and user-editable Skills. Both are implemented:
see [ARCHITECTURE.md](ARCHITECTURE.md#prompt-assembly-and-the-run-trace) and
[criterion-14-system-role.md](evidence/criterion-14-system-role.md). To see
the approval gate:

1. Open a skill → **Preview**. The approval panel shows the raw body, its
   version and SHA-256. **Approve this content** records an owner decision.
2. Edit the body: the badge becomes **stale** and agents that use it can no
   longer run a review until it is approved again.
3. On an agent's **Skills** tab, an enabled but unapproved skill is flagged;
   **Run Review** with that agent fails before any model request with
   `skill_not_approved`.

The earlier ordering evidence (physical drag, trace with Skills in the user
message) is kept as historical evidence.

## 4. Conventions (rows 38–42, 45–51, 53)

1. **Conventions** has separate **Run Scan** and **ReScan** buttons (23).
   One owner-authorized extraction ran through the same application endpoint
   used by Run Scan, against an imported, indexed Fastify repository. See
   [live extraction evidence](evidence/conventions-live-extraction.md) for
   rows 38 and 40; do not rerun the paid call during the walkthrough.
2. On the evidence stack, the candidates are seeded and labelled "Synthetic
   fixture — not a model extraction". Each card shows the rule, file link and
   confidence, with Accept, Reject and Edit (23).
3. Reject one candidate (24). Edit another inline (25) and accept it. Accept
   a third: **Create skill** appears (26). After a reload the statuses are
   kept (27).
4. **Create skill** (28): the banner names the source. Name, description,
   type, body and agent are all editable. Create, and `repo-conventions`
   appears on the Skills page (29), linked to the chosen agent.
5. **Settings → Feature Models** has a Conventions row with a searchable,
   live model list (30, 31).

## 5. Experiments (rows 17–20)

These are paid and need the owner's authorization. The procedure is in
[EXPERIMENTS.md](EXPERIMENTS.md#operator-procedure). When the runner prints
"armed", choose **Run Review → the named agent** on the PR page, once.
Run Review is a dropdown: the review is sent only when the agent is chosen.

The Phase 1 pilot's results are in
[EXPERIMENTS.md](EXPERIMENTS.md#phase-1-summary). To see rows 14, 19 and 20
on the evidence stack, open PR #502 → **Agent runs** → the newest API
Contract Reviewer run → **Open run trace & logs** → **Prompt assembly**. It
shows **Skills (dynamic) ~831 tokens**, with semver-discipline, then
breaking-change, and no response-schema (34;
[trace-evidence.md](evidence/trace-evidence.md)).

## Tests

The suite commands and results are in [TEST-RESULTS.md](TEST-RESULTS.md).
