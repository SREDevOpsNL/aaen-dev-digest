import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 42,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** An LLM whose structured calls block until the test opens the gate. */
class GatedLLM extends MockLLMProvider {
  started = deferred();
  gate = deferred();
  failAfterGate = false;

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.started.resolve();
    await this.gate.promise;
    if (this.failAfterGate) throw new Error('provider exploded');
    return super.completeStructured(req);
  }
}

let repoSeq = 0;

d('run lifecycle: cancellation and terminal states (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setup(agentCount = 1) {
    const llm = new GatedLLM('openai', { structured: FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: llm } },
    });
    const name = `lifecycle-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add config',
        author: 'dev',
        branch: 'feat/config',
        base: 'main',
        headSha: 'head-sha-1',
      })
      .returning();
    const agents = [];
    for (let i = 0; i < agentCount; i++) {
      const created = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: `${name}-agent-${i}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
        })
      ).json();
      const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, created.id));
      agents.push(row!);
    }
    const service = new ReviewService(app.container);
    return { app, llm, pr: pr!, agents, service };
  }

  async function runRow(runId: string) {
    const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    return row!;
  }
  async function reviewsForRun(runId: string) {
    return pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId));
  }
  async function lastReviewedSha(prId: string) {
    const [row] = await pg.handle.db
      .select({ sha: t.pullRequests.lastReviewedSha })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, prId));
    return row?.sha ?? null;
  }

  it('a cancel during the model call wins even after the in-memory flag is cleared', async () => {
    const { app, llm, pr, agents, service } = await setup();
    const { runs } = await service.runReview(workspaceId, pr.id, agents);
    const runId = runs[0]!.run_id;

    await llm.started.promise;
    await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    // cancelRun completed the bus, which cleared the fast-path flag.
    expect(app.container.runBus.isCancelled(runId)).toBe(false);

    llm.gate.resolve();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    expect((await runRow(runId)).status).toBe('cancelled');
    expect(await reviewsForRun(runId)).toHaveLength(0);
    expect(await lastReviewedSha(pr.id)).toBeNull();
    const [trace] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    expect(trace).toBeDefined();
    await app.close();
  });

  it('cancelling a queued run stops only that run; earlier runs finish', async () => {
    const { app, llm, pr, agents, service } = await setup(2);
    const { runs } = await service.runReview(workspaceId, pr.id, agents);
    const [first, second] = runs.map((r) => r.run_id);

    await llm.started.promise;
    await app.inject({ method: 'POST', url: `/runs/${second}/cancel` });
    llm.gate.resolve();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    expect((await runRow(first!)).status).toBe('done');
    expect(await reviewsForRun(first!)).toHaveLength(1);
    expect((await runRow(second!)).status).toBe('cancelled');
    expect(await reviewsForRun(second!)).toHaveLength(0);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    await app.close();
  });

  it('a provider failure after a cancel keeps the run cancelled, not failed', async () => {
    const { app, llm, pr, agents, service } = await setup();
    llm.failAfterGate = true;
    const { runs } = await service.runReview(workspaceId, pr.id, agents);
    const runId = runs[0]!.run_id;

    await llm.started.promise;
    await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    llm.gate.resolve();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    // Give the executor's catch path time to attempt its (guarded) write.
    await vi.waitFor(async () => {
      const [trace] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
      expect(trace).toBeDefined();
    });

    const row = await runRow(runId);
    expect(row.status).toBe('cancelled');
    expect(row.error).not.toBe('provider exploded');
    await app.close();
  });

  it('on success, persistence commits before the trace is saved and before the stream completes', async () => {
    const { app, llm, pr, agents, service } = await setup();
    const order: string[] = [];
    const finalize = ReviewRepository.prototype.finalizeRunSuccess;
    const saveTrace = ReviewRepository.prototype.saveRunTrace;
    const finalizeSpy = vi
      .spyOn(ReviewRepository.prototype, 'finalizeRunSuccess')
      .mockImplementation(async function (this: ReviewRepository, ...args) {
        const result = await finalize.apply(this, args);
        order.push('finalize');
        return result;
      });
    const traceSpy = vi
      .spyOn(ReviewRepository.prototype, 'saveRunTrace')
      .mockImplementation(async function (this: ReviewRepository, ...args) {
        await saveTrace.apply(this, args);
        order.push('trace');
      });
    const complete = app.container.runBus.complete.bind(app.container.runBus);
    const completeSpy = vi.spyOn(app.container.runBus, 'complete').mockImplementation((id) => {
      order.push('complete');
      complete(id);
    });

    try {
      const { runs } = await service.runReview(workspaceId, pr.id, agents);
      llm.gate.resolve();
      await vi.waitFor(() => expect(order).toContain('complete'));

      expect(order).toEqual(['finalize', 'trace', 'complete']);
      const row = await runRow(runs[0]!.run_id);
      expect(row.status).toBe('done');
      expect(await reviewsForRun(runs[0]!.run_id)).toHaveLength(1);
      expect(await lastReviewedSha(pr.id)).toBe('head-sha-1');
    } finally {
      finalizeSpy.mockRestore();
      traceSpy.mockRestore();
      completeSpy.mockRestore();
      await app.close();
    }
  });

  it('terminal writes are compare-and-set: nothing overwrites a cancelled run', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const { pr } = await setup();
    const runId = await repo.createAgentRun({ workspaceId, agentId: null, prId: pr.id, provider: 'openai', model: 'm' });
    await pg.handle.db.update(t.agentRuns).set({ status: 'cancelled' }).where(eq(t.agentRuns.id, runId));

    const completion = { durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: null, findingsCount: 1, grounding: '1/1 passed' };
    // Success path (the transaction rolls back to nothing)…
    const persisted = await repo.finalizeRunSuccess({
      runId,
      completion,
      review: { workspaceId, prId: pr.id, agentId: null, runId, kind: 'review', verdict: 'comment', summary: 's', score: 90, model: 'm' },
      findings: FIXTURE.findings,
      prId: pr.id,
      headSha: 'head-sha-1',
    });
    expect(persisted.applied).toBe(false);
    expect(await reviewsForRun(runId)).toHaveLength(0);
    expect(await lastReviewedSha(pr.id)).toBeNull();

    // …and the failure path used by runOneAgent and failAll.
    expect(await repo.completeAgentRun(runId, { ...completion, status: 'failed', error: 'late' })).toBe(false);
    const row = await runRow(runId);
    expect(row.status).toBe('cancelled');
    expect(row.error).toBeNull();
  });
});
