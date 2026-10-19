import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** SQL for the HW2 experiment module: identity facts and slot lookups by trace. */
export class ExperimentsRepository {
  constructor(private readonly db: Db) {}

  async databaseName(): Promise<string> {
    const rows = await this.db.execute<{ name: string }>(sql`select current_database() as name`);
    return [...rows][0]?.name ?? '';
  }

  async repoFullNames(): Promise<string[]> {
    const rows = await this.db.select({ fullName: t.repos.fullName }).from(t.repos);
    return rows.map((row) => row.fullName).sort();
  }

  async pullNumbers(workspaceId: string, repoFullName: string): Promise<number[]> {
    const rows = await this.db
      .select({ number: t.pullRequests.number })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.repos.fullName, repoFullName)));
    return rows.map((row) => row.number).sort((a, b) => a - b);
  }

  /** Runs whose stored trace carries this experiment slot id (written before dispatch). */
  async runsForSlot(workspaceId: string, slotId: string): Promise<Array<{ runId: string; status: string | null; trace: unknown }>> {
    const rows = await this.db
      .select({ runId: t.agentRuns.id, status: t.agentRuns.status, trace: t.runTraces.trace })
      .from(t.runTraces)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), sql`${t.runTraces.trace}->'experiment'->>'slot_id' = ${slotId}`));
    return rows;
  }
}
