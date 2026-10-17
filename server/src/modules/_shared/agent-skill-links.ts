import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import type { AgentRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';

/**
 * Agent ↔ skill link policy and its locked persistence, shared by the agents
 * module (set / link one) and the skills module (create a skill already linked
 * to an agent). Every write goes through one transaction that locks the agent
 * row first, so concurrent link requests serialise on the same row.
 */

/** Maximum number of skills linked to one agent. */
export const MAX_AGENT_SKILLS = 4;

/**
 * True when `next` links a skill that `previous` did not and ends above `max`.
 * Reordering or reducing an agent that already exceeds the limit is allowed.
 */
export function exceedsSkillLimit(
  previous: readonly string[],
  next: readonly string[],
  max = MAX_AGENT_SKILLS,
): boolean {
  if (next.length <= max) return false;
  const before = new Set(previous);
  return next.some((id) => !before.has(id));
}

/** Pure: insert `skillId` at `order` (default: the end), moving it if already linked. */
export function insertSkillAt(previous: readonly string[], skillId: string, order?: number): string[] {
  const withoutTarget = previous.filter((id) => id !== skillId);
  const index = Math.min(order ?? withoutTarget.length, withoutTarget.length);
  withoutTarget.splice(index, 0, skillId);
  return withoutTarget;
}

/** Lock the agent row (`FOR UPDATE`) inside `tx`; undefined if not in the workspace. */
export async function lockAgent(tx: Tx, workspaceId: string, agentId: string): Promise<AgentRow | undefined> {
  const [agent] = await tx
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
    .for('update');
  return agent;
}

/** The agent's linked skill ids in link order. Call after `lockAgent` in the same `tx`. */
export async function linkedSkillIds(tx: Tx, agentId: string): Promise<string[]> {
  const rows = await tx
    .select({ skillId: t.agentSkills.skillId })
    .from(t.agentSkills)
    .where(eq(t.agentSkills.agentId, agentId))
    .orderBy(asc(t.agentSkills.order), asc(t.agentSkills.skillId));
  return rows.map((row) => row.skillId);
}

/** Ids from `skillIds` that are not skills of `workspaceId`. */
export async function missingWorkspaceSkills(tx: Tx, workspaceId: string, skillIds: readonly string[]): Promise<string[]> {
  if (skillIds.length === 0) return [];
  const owned = await tx
    .select({ id: t.skills.id })
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, [...skillIds])));
  const ownedIds = new Set(owned.map((row) => row.id));
  return skillIds.filter((id) => !ownedIds.has(id));
}

/**
 * Replace the agent's links with `next` (order = index). When the list
 * changes, bump the agent version and snapshot its config with the new skill
 * list. The caller holds the agent lock and has validated `next`.
 */
export async function writeAgentSkills(
  tx: Tx,
  agent: AgentRow,
  previous: readonly string[],
  next: readonly string[],
): Promise<void> {
  const changed = previous.length !== next.length || previous.some((id, index) => id !== next[index]);
  if (!changed) return;

  await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agent.id));
  if (next.length > 0) {
    await tx.insert(t.agentSkills).values(next.map((skillId, order) => ({ agentId: agent.id, skillId, order })));
  }
  const nextVersion = agent.version + 1;
  await tx
    .update(t.agents)
    .set({ version: nextVersion })
    .where(and(eq(t.agents.workspaceId, agent.workspaceId), eq(t.agents.id, agent.id)));
  await tx.insert(t.agentVersions).values({
    agentId: agent.id,
    version: nextVersion,
    configJson: {
      provider: agent.provider,
      model: agent.model,
      system_prompt: agent.systemPrompt,
      output_schema: agent.outputSchema,
      strategy: agent.strategy,
      ci_fail_on: agent.ciFailOn,
      repo_intel: agent.repoIntel,
      skills: [...next],
    },
  });
}
