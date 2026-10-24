import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * A run's status commits before its trace is saved (terminal transition first,
 * then the trace, then stream completion). After `waitForPrRuns`, wait for the
 * trace too before reading `/runs/:id/trace`, or the read can race and 404.
 */
export async function waitForRunTrace(
  db: PgFixture['handle']['db'],
  runId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const [row] = await db
      .select({ runId: t.runTraces.runId })
      .from(t.runTraces)
      .where(eq(t.runTraces.runId, runId));
    if (row) return;
    if (Date.now() - start > timeoutMs) throw new Error(`no trace for run ${runId} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
