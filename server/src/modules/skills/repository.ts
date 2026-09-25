import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { SkillSource, SkillType } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
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
}

export interface UpdateSkillRecord {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

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

  async create(values: CreateSkillRecord): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
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
      return row!;
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
}
