import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';
import { REAPED_CANCELLED_NOTE, reapedTrace } from '../reaped-trace.js';
import { pgSafeDeep, pgSafeText } from '../../../db/pg-text.js';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  const runIds = rows.map(({ run }) => run.id);
  const countsByRun = new Map<string, { CRITICAL: number; WARNING: number; SUGGESTION: number }>();
  if (runIds.length) {
    const findings = await db.select({ runId: t.reviews.runId, severity: t.findings.severity }).from(t.findings).innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId)).where(inArray(t.reviews.runId, runIds));
    for (const finding of findings) {
      if (!finding.runId) continue;
      const counts = countsByRun.get(finding.runId) ?? { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
      if (finding.severity in counts) counts[finding.severity as keyof typeof counts] += 1;
      countsByRun.set(finding.runId, counts);
    }
  }
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    severity_counts: countsByRun.get(run.id) ?? { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Whether `runId` exists and belongs to `workspaceId` (run-scoped route guard). */
export async function runInWorkspace(db: Db, workspaceId: string, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row !== undefined;
}

/** Mark a still-running run of this workspace as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(t.agentRuns.id, runId),
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.status, 'running'),
      ),
    )
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI.
 *  Each reaped run's trace is labelled `persistence: reaped` in the same
 *  transaction (see `reapedTrace`): a partial trace is kept, never replaced,
 *  and the row's persisted tokens and cost are left as they are. */
export async function reapStaleRunningRuns(db: Db, now: Date = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(t.agentRuns)
      .set({ status: 'failed' })
      .where(eq(t.agentRuns.status, 'running'))
      .returning({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        durationMs: t.agentRuns.durationMs,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
      });
    // A cancelled run with no trace at all (the cancel wrote the status, then
    // the process died before the executor's trace): give it a minimal,
    // labelled one. Nothing about its request is invented.
    const orphanCancelled = await tx
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        durationMs: t.agentRuns.durationMs,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.status, 'cancelled'), isNull(t.runTraces.runId)));
    if (orphanCancelled.length > 0) {
      const agentIds = orphanCancelled.map((r) => r.agentId).filter((id): id is string => id !== null);
      const names = new Map(
        agentIds.length > 0
          ? (await tx.select({ id: t.agents.id, name: t.agents.name }).from(t.agents).where(inArray(t.agents.id, agentIds))).map((a) => [a.id, a.name] as const)
          : [],
      );
      for (const row of orphanCancelled) {
        const agentName = row.agentId ? (names.get(row.agentId) ?? null) : null;
        await saveRunTrace(tx, row.id, reapedTrace(undefined, { ...row, agentName }, now, REAPED_CANCELLED_NOTE));
      }
    }
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const existing = new Map(
      (await tx.select({ runId: t.runTraces.runId, trace: t.runTraces.trace }).from(t.runTraces).where(inArray(t.runTraces.runId, ids))).map(
        (r) => [r.runId, r.trace] as const,
      ),
    );
    const agentIds = rows.map((r) => r.agentId).filter((id): id is string => id !== null);
    const names = new Map(
      agentIds.length > 0
        ? (await tx.select({ id: t.agents.id, name: t.agents.name }).from(t.agents).where(inArray(t.agents.id, agentIds))).map((a) => [a.id, a.name] as const)
        : [],
    );
    for (const row of rows) {
      const trace = reapedTrace(
        existing.get(row.id),
        { ...row, agentName: row.agentId ? (names.get(row.agentId) ?? null) : null },
        now,
      );
      await saveRunTrace(tx, row.id, trace);
    }
    return rows.length;
  });
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

/** Terminal stats written when a run leaves `running`. */
export type RunCompletion = {
  status: 'done' | 'failed' | 'cancelled';
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Authoritative provider-reported USD cost; null when unavailable. */
  costUsd: number | null;
  findingsCount: number;
  grounding: string;
  /** Review score (0-100); null on failed/cancelled runs. */
  score?: number | null;
  /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
  blockers?: number | null;
  /** Failure reason (status='failed') / cancellation note. Null clears it. */
  error?: string | null;
};

/**
 * Move a run from `running` to a terminal status. Compare-and-set: it applies
 * only while the row is still `running`, so a run the user already cancelled
 * is never overwritten to `done` or `failed`. Returns whether it applied.
 */
export async function completeAgentRun(
  db: DbOrTx,
  runId: string,
  values: RunCompletion,
): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error == null ? null : pgSafeText(values.error),
    })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Whether the run's durable status is `cancelled` (the authoritative signal). */
export async function isRunCancelled(db: Db, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: t.agentRuns.status })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.id, runId));
  return row?.status === 'cancelled';
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: DbOrTx, runId: string, trace: RunTrace): Promise<void> {
  // Provider and prompt text may hold characters jsonb rejects (see pg-text.ts).
  const safe = pgSafeDeep(trace);
  await db
    .insert(t.runTraces)
    .values({ runId, trace: safe })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace: safe } });
}

/**
 * An API-cancelled run's row keeps only the status the cancel wrote. Fill in
 * the usage the executor measured, ONLY while the row is cancelled and has no
 * usage yet; the status is never touched. Returns whether it applied.
 */
export async function recordCancelledRunUsage(
  db: DbOrTx,
  runId: string,
  values: Pick<RunCompletion, 'durationMs' | 'tokensIn' | 'tokensOut' | 'costUsd'>,
): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ durationMs: values.durationMs, tokensIn: values.tokensIn, tokensOut: values.tokensOut, costUsd: values.costUsd })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'cancelled'), isNull(t.agentRuns.tokensIn), isNull(t.agentRuns.costUsd)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** The run's current status (inside a transaction: as that transaction sees it). */
export async function runStatus(db: DbOrTx, runId: string): Promise<string | null> {
  const [row] = await db.select({ status: t.agentRuns.status }).from(t.agentRuns).where(eq(t.agentRuns.id, runId));
  return row?.status ?? null;
}

export async function getRunTrace(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<RunTrace | undefined> {
  const [row] = await db
    .select({ trace: t.runTraces.trace })
    .from(t.runTraces)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
    .where(and(eq(t.runTraces.runId, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row ? (row.trace as RunTrace) : undefined;
}
