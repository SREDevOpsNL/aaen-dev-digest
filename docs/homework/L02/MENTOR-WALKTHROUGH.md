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
3. **Skills tab:**
   - Filter by name (15).
   - Link `deprecation-policy` (4 / 4 attached) (16). The card count updates
     without a reload (17).
   - Switch one linked skill off for this agent (18). It stays attached,
     shows "off for this agent", and can no longer be dragged.
4. **Drag** a linked skill above another with the mouse. The order is saved
   and survives a reload. A browser-automation tool cannot do this: it has to
   be a real pointer drag.
5. **Paid** (row 14, criteria 19 and 20): after the drag, run a review of a
   PR with this agent. Then open **PR → Agent runs → the run's trace**. The
   Skills block shows the enabled skills in the dragged order, leaves out the
   one switched off, and carries its own token count.

## 4. Conventions (rows 38–42, 45–51, 53)

1. **Conventions** has separate **Run Scan** and **ReScan** buttons (23).
   **Paid:** Run Scan on an imported, indexed repository runs the extraction
   (row 38).
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
[EXPERIMENTS.md](EXPERIMENTS.md#operator-procedure). On the PR page, click
**Run Review** for the named agent when the runner prints "armed".

## Tests

The suite commands and results are in [TEST-RESULTS.md](TEST-RESULTS.md).
