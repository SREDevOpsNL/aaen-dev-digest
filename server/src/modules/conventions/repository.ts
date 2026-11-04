import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { VerifiedCandidate } from './helpers.js';

export type ConventionRow = typeof t.conventions.$inferSelect;

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db.select().from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async listByIds(
    workspaceId: string,
    repoId: string,
    ids: string[],
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(t.conventions).where(and(
      eq(t.conventions.workspaceId, workspaceId),
      eq(t.conventions.repoId, repoId),
      inArray(t.conventions.id, ids),
      eq(t.conventions.status, 'accepted'),
    ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is ConventionRow => !!row);
  }

  async replacePending(
    workspaceId: string,
    repoId: string,
    candidates: VerifiedCandidate[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.conventions).where(and(
        eq(t.conventions.workspaceId, workspaceId),
        eq(t.conventions.repoId, repoId),
        eq(t.conventions.status, 'pending'),
      ));
      if (candidates.length === 0) return;
      await tx.insert(t.conventions).values(candidates.map((candidate) => ({
        workspaceId,
        repoId,
        category: candidate.category,
        rule: candidate.rule,
        rationale: candidate.rationale,
        evidencePath: candidate.evidencePath,
        evidenceLine: candidate.evidenceLine,
        evidenceSnippet: candidate.evidenceSnippet,
        confidence: candidate.confidence,
        status: 'pending' as const,
      })));
    });
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db.update(t.conventions).set({
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    }).where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id))).returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db.delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }
}
