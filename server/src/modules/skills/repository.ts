import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { SkillSource, SkillType } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { AgentRow, SkillApprovalRow, SkillRow, SkillVersionRow } from '../../db/rows.js';
import {
  linkedSkillIds,
  lockAgent,
  MAX_AGENT_SKILLS,
  writeAgentSkills,
} from '../_shared/agent-skill-links.js';
import * as t from '../../db/schema.js';
import { latestSkillDecisions, skillBodySha256 } from '../_shared/skill-approval.js';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isSkillConfigChange } from './helpers.js';

export interface CreateSkillRecord {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
  /** Link the new skill to this agent (appended last) in the same transaction. */
  linkAgentId?: string;
}

export type CreateSkillResult =
  | { kind: 'ok'; skill: SkillRow }
  | { kind: 'agent_not_found' }
  | { kind: 'limit_exceeded'; max: number };

export interface UpdateSkillRecord {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** Outcome of restoring a snapshot; `restored: false` means the body already matched. */
export type RestoreSkillResult =
  | { kind: 'skill_not_found' }
  | { kind: 'version_not_found' }
  | { kind: 'ok'; skill: SkillRow; restored: boolean };

/** Outcome of recording an approval decision under the skill's row lock. */
export type SkillDecisionResult =
  | { kind: 'skill_not_found' }
  /** The reviewed version/digest is not the current content (approve only). */
  | { kind: 'content_mismatch'; skill: SkillRow; currentSha256: string }
  /** Nothing to do: already approved (approve) or not approved (revoke). */
  | { kind: 'unchanged'; skill: SkillRow; latest: SkillApprovalRow | undefined }
  | { kind: 'ok'; skill: SkillRow; latest: SkillApprovalRow };

export interface SkillWithUsage {
  skill: SkillRow;
  usedByCount: number;
}

/** SQL-only persistence boundary for workspace-owned skills. */
export class SkillsRepository {
  constructor(private readonly db: Db) {}

  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const rows = await this.db
      .select({
        skill: t.skills,
        usedByCount: sql<number>`count(${t.agentSkills.agentId})::int`,
      })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name), asc(t.skills.id));
    return rows.map((row) => ({ skill: row.skill, usedByCount: row.usedByCount }));
  }

  async get(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Insert a skill and its first snapshot. With `linkAgentId`, the agent row is
   * locked first and the limit checked before anything is inserted, so a
   * refused link leaves no orphan skill and concurrent creates cannot both
   * take the agent's last free slot.
   */
  async create(values: CreateSkillRecord): Promise<CreateSkillResult> {
    return this.db.transaction(async (tx) => {
      let link: { agent: AgentRow; previous: string[] } | undefined;
      if (values.linkAgentId) {
        const agent = await lockAgent(tx, values.workspaceId, values.linkAgentId);
        if (!agent) return { kind: 'agent_not_found' };
        const previous = await linkedSkillIds(tx, agent.id);
        // The new skill is never among the current links, so it always adds one.
        if (previous.length + 1 > MAX_AGENT_SKILLS) return { kind: 'limit_exceeded', max: MAX_AGENT_SKILLS };
        link = { agent, previous };
      }

      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description,
          type: values.type,
          source: values.source ?? 'manual',
          body: values.body,
          enabled: values.enabled ?? true,
          version: INITIAL_SKILL_VERSION,
          evidenceFiles: values.evidenceFiles,
        })
        .returning();
      await tx.insert(t.skillVersions).values({
        skillId: row!.id,
        version: INITIAL_SKILL_VERSION,
        body: row!.body,
      });
      if (link) await writeAgentSkills(tx, link.agent, link.previous, [...link.previous, row!.id]);
      return { kind: 'ok', skill: row! };
    });
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillRecord,
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!current) return undefined;

      const configChanged = isSkillConfigChange(current, patch);
      const nextVersion = configChanged ? current.version + 1 : current.version;
      const [updated] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(configChanged ? { version: nextVersion } : {}),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();

      if (configChanged) {
        await tx.insert(t.skillVersions).values({
          skillId: updated!.id,
          version: nextVersion,
          body: updated!.body,
        });
      }
      return updated;
    });
  }

  /**
   * Restore a snapshot's body as a new version, in one transaction under the
   * same row lock as `update`, so concurrent edits and restores get sequential
   * version numbers. History is append-only: the restored body becomes v(n+1),
   * and no existing snapshot is changed or removed. Snapshots hold the body
   * only, so name, description, type and enabled are left as they are.
   */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<RestoreSkillResult> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!current) return { kind: 'skill_not_found' };

      const [snapshot] = await tx
        .select()
        .from(t.skillVersions)
        .where(and(eq(t.skillVersions.skillId, id), eq(t.skillVersions.version, version)));
      if (!snapshot) return { kind: 'version_not_found' };
      if (snapshot.body === current.body) return { kind: 'ok', skill: current, restored: false };

      const nextVersion = current.version + 1;
      const [updated] = await tx
        .update(t.skills)
        .set({ body: snapshot.body, version: nextVersion })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();
      await tx.insert(t.skillVersions).values({ skillId: id, version: nextVersion, body: snapshot.body });
      return { kind: 'ok', skill: updated!, restored: true };
    });
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return deleted.length > 0;
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  async linkedAgents(skillId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name), asc(t.agents.id));
  }

  // ---- skill_approvals (append-only: insert and select only) --------------

  async latestDecisions(workspaceId: string, skillIds: readonly string[]): Promise<Map<string, SkillApprovalRow>> {
    return latestSkillDecisions(this.db, workspaceId, skillIds);
  }

  /** The audit trail for one skill, newest first, with the actor's display name. */
  async listDecisions(
    workspaceId: string,
    skillId: string,
  ): Promise<Array<{ row: SkillApprovalRow; actorName: string | null }>> {
    const rows = await this.db
      .select({ row: t.skillApprovals, actorName: t.users.name })
      .from(t.skillApprovals)
      .leftJoin(t.users, eq(t.users.id, t.skillApprovals.actorUserId))
      .where(and(eq(t.skillApprovals.workspaceId, workspaceId), eq(t.skillApprovals.skillId, skillId)))
      .orderBy(desc(t.skillApprovals.id));
    return rows.map((r) => ({ row: r.row, actorName: r.actorName ?? null }));
  }

  /** True when the user is an `owner` member of the workspace. */
  async isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ role: t.workspaceMembers.role })
      .from(t.workspaceMembers)
      .where(and(eq(t.workspaceMembers.workspaceId, workspaceId), eq(t.workspaceMembers.userId, userId)));
    return row?.role === 'owner';
  }

  /**
   * Approve the reviewed content, or revoke. Runs under the same skill row lock
   * as `update` and `restoreVersion`, so the digest check and the insert see
   * the body the decision is bound to, and decision ids follow decision order.
   */
  async recordDecision(input: {
    workspaceId: string;
    skillId: string;
    actorUserId: string;
    decision: 'approve' | 'revoke';
    reason?: string;
    /** Required for 'approve': what the reviewer saw. */
    reviewed?: { version: number; bodySha256: string };
  }): Promise<SkillDecisionResult> {
    return this.db.transaction(async (tx) => {
      const [skill] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, input.workspaceId), eq(t.skills.id, input.skillId)))
        .for('update');
      if (!skill) return { kind: 'skill_not_found' };
      const currentSha256 = skillBodySha256(skill.body);
      const latest = (await latestSkillDecisions(tx, input.workspaceId, [skill.id])).get(skill.id);
      const approvedNow =
        latest?.decision === 'approve' && latest.version === skill.version && latest.bodySha256 === currentSha256;

      if (input.decision === 'approve') {
        const reviewed = input.reviewed;
        if (!reviewed || reviewed.version !== skill.version || reviewed.bodySha256 !== currentSha256) {
          return { kind: 'content_mismatch', skill, currentSha256 };
        }
        if (approvedNow) return { kind: 'unchanged', skill, latest };
      } else if (latest?.decision !== 'approve') {
        // Never approved, or already revoked: there is no approval to revoke.
        return { kind: 'unchanged', skill, latest };
      }

      const [row] = await tx
        .insert(t.skillApprovals)
        .values({
          workspaceId: input.workspaceId,
          skillId: skill.id,
          skillName: skill.name,
          version: skill.version,
          bodySha256: currentSha256,
          decision: input.decision,
          actorUserId: input.actorUserId,
          reason: input.reason ?? null,
        })
        .returning();
      return { kind: 'ok', skill, latest: row! };
    });
  }
}
