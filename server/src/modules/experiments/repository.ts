import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** SQL for the HW2 experiment module: identity facts and slot lookups by trace. */
export class ExperimentsRepository {
  constructor(private readonly db: Db) {}

  async postgresSystemIdentifier(): Promise<string> {
    const rows = await this.db.execute<{ system_identifier: string }>(
      sql`select system_identifier::text from pg_control_system()`,
    );
    return [...rows][0]?.system_identifier ?? '';
  }

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
  async runsForSlot(
    workspaceId: string,
    slotId: string,
  ): Promise<Array<{ runId: string; status: string | null; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; trace: unknown }>> {
    const rows = await this.db
      .select({
        runId: t.agentRuns.id,
        status: t.agentRuns.status,
        costUsd: t.agentRuns.costUsd,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        trace: t.runTraces.trace,
      })
      .from(t.runTraces)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), sql`${t.runTraces.trace}->'experiment'->>'slot_id' = ${slotId}`));
    return rows;
  }

  /** Every experiment run recorded for a stack: what the server-side budget charges. */
  async runsForStack(
    workspaceId: string,
    stackId: string,
  ): Promise<Array<{ costUsd: number | null; trace: unknown }>> {
    return this.db
      .select({ costUsd: t.agentRuns.costUsd, trace: t.runTraces.trace })
      .from(t.runTraces)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), sql`${t.runTraces.trace}->'experiment'->>'stack_id' = ${stackId}`));
  }
}
