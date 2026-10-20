import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns, waitForRunTrace } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(
    structured: unknown,
    provider: 'openai' | 'anthropic' | 'openrouter' = 'openai',
    providerCostUsd: number | null = null,
  ) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured, providerCostUsd }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'openrouter', 0.012);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openrouter', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    expect(review.cost_usd).toBe(0.012);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    await waitForRunTrace(pg.handle.db, runId);
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.stats.cost_usd).toBe(0.012);
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');
    expect(run!.costUsd).toBe(0.012);

    const runHistory = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })
    ).json();
    expect(runHistory[0].cost_usd).toBe(0.012);

    await app.close();
  });

  it('does not persist an estimated cost when authoritative provider cost is unavailable', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Estimate Only', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, body.runs[0].run_id));
    expect(run!.costUsd).toBeNull();

    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].cost_usd).toBeNull();

    await waitForRunTrace(pg.handle.db, body.runs[0].run_id);
    const trace = (
      await app.inject({ method: 'GET', url: `/runs/${body.runs[0].run_id}/trace` })
    ).json();
    expect(trace.stats.cost_usd).toBeNull();

    await app.close();
  });

  it('aggregates all successful review-run costs while preserving the newest review score', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [olderRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 9 })
      .returning();
    const [newerRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: null })
      .returning();
    await pg.handle.db.insert(t.reviews).values([
      {
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: olderRun!.id,
        kind: 'review',
        score: 80,
        createdAt: new Date('2026-09-20T10:00:00Z'),
      },
      {
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: newerRun!.id,
        kind: 'review',
        score: 90,
        createdAt: new Date('2026-09-20T11:00:00Z'),
      },
    ]);

    const listWithMissingLatest = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    expect(listWithMissingLatest.find((item: { id: string }) => item.id === pr.id).cost_usd).toBeNull();

    await pg.handle.db
      .update(t.agentRuns)
      .set({ costUsd: 0.025 })
      .where(eq(t.agentRuns.id, newerRun!.id));
    const listWithCost = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const listed = listWithCost.find((item: { id: string }) => item.id === pr.id);
    expect(listed.score).toBe(90);
    expect(listed.cost_usd).toBe(9.025);

    await app.close();
  });

  it("counts a run's cost once when two review rows link to the same run", async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [sharedRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 0.04 })
      .returning();
    const [otherRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 0.01 })
      .returning();
    await pg.handle.db.insert(t.reviews).values([
      { workspaceId, prId: pr.id, agentId: null, runId: otherRun!.id, kind: 'review', score: 70, createdAt: new Date('2026-09-20T09:00:00Z') },
      { workspaceId, prId: pr.id, agentId: null, runId: sharedRun!.id, kind: 'review', score: 80, createdAt: new Date('2026-09-20T10:00:00Z') },
      { workspaceId, prId: pr.id, agentId: null, runId: sharedRun!.id, kind: 'review', score: 90, createdAt: new Date('2026-09-20T11:00:00Z') },
    ]);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json()
      .find((item: { id: string }) => item.id === pr.id);
    expect(listed.cost_usd).toBeCloseTo(0.05, 10);
    expect(listed.score).toBe(90);

    await app.close();
  });

  it('reports unknown cost when a run without a reported cost is linked to two reviews', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [unpricedRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: null })
      .returning();
    const [pricedRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 0.01 })
      .returning();
    await pg.handle.db.insert(t.reviews).values([
      { workspaceId, prId: pr.id, agentId: null, runId: pricedRun!.id, kind: 'review', score: 70, createdAt: new Date('2026-09-20T09:00:00Z') },
      { workspaceId, prId: pr.id, agentId: null, runId: unpricedRun!.id, kind: 'review', score: 80, createdAt: new Date('2026-09-20T10:00:00Z') },
      { workspaceId, prId: pr.id, agentId: null, runId: unpricedRun!.id, kind: 'review', score: 90, createdAt: new Date('2026-09-20T11:00:00Z') },
    ]);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json()
      .find((item: { id: string }) => item.id === pr.id);
    expect(listed.has_successful_review).toBe(true);
    expect(listed.cost_usd).toBeNull();
    expect(listed.score).toBe(90);

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
  it('keeps one unattributed group when neither the review nor its run names an agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [olderRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 0.01 })
      .returning();
    const [newerRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', costUsd: 0.02 })
      .returning();
    const [olderReview, newerReview] = await pg.handle.db
      .insert(t.reviews)
      .values([
        { workspaceId, prId: pr.id, agentId: null, runId: olderRun!.id, kind: 'review', score: 80, createdAt: new Date('2026-09-20T10:00:00Z') },
        { workspaceId, prId: pr.id, agentId: null, runId: newerRun!.id, kind: 'review', score: 90, createdAt: new Date('2026-09-20T11:00:00Z') },
      ])
      .returning();

    await pg.handle.db.insert(t.findings).values([
      { reviewId: olderReview!.id, severity: 'CRITICAL', category: 'security', title: 'Older critical', file: 'src/old.ts', startLine: 1, endLine: 1, rationale: 'Older run only.', confidence: 0.9 },
      { reviewId: newerReview!.id, severity: 'WARNING', category: 'performance', title: 'Latest warning', file: 'src/new.ts', startLine: 2, endLine: 2, rationale: 'Newest ' + 'x'.repeat(220), confidence: 0.8 },
    ]);

    const listed = (await app.inject({ method: 'GET', url: '/repos/' + repo.id + '/pulls' })).json()
      .find((item: { id: string }) => item.id === pr.id);
    expect(listed.has_successful_review).toBe(true);
    expect(listed.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
    expect(listed.finding_previews).toEqual([
      expect.objectContaining({ title: 'Latest warning', severity: 'WARNING', file: 'src/new.ts', start_line: 2, rationale: 'Newest ' + 'x'.repeat(172) + '…', agent_name: null }),
    ]);
    await app.close();
  });

  it('reports no cost, score, or findings for a PR without a successful review run', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [failedRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'failed', costUsd: 0.01 })
      .returning();
    const [failedReview] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr.id, agentId: null, runId: failedRun!.id, kind: 'review', score: 40 })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: failedReview!.id, severity: 'CRITICAL', category: 'security', title: 'Failed-run finding', file: 'src/a.ts', startLine: 1, endLine: 1, rationale: 'From a failed run.', confidence: 0.9,
    });

    const listed = (await app.inject({ method: 'GET', url: '/repos/' + repo.id + '/pulls' })).json()
      .find((item: { id: string }) => item.id === pr.id);
    expect(listed.has_successful_review).toBe(false);
    expect(listed.cost_usd).toBeNull();
    expect(listed.score).toBeNull();
    expect(listed.findings_by_severity).toBeNull();
    expect(listed.finding_previews).toEqual([]);
    await app.close();
  });

  describe('run-scoped routes are workspace-scoped', () => {
    const TRACE = { log: [], raw_output: 'secret trace' };

    async function seedRun(ws: string, status: string) {
      const [run] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId: ws, status })
        .returning();
      await pg.handle.db.insert(t.runTraces).values({ runId: run!.id, trace: TRACE });
      return run!;
    }

    async function foreignWorkspace() {
      const [ws] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `runs-other-${Date.now()}` })
        .returning();
      return ws!.id;
    }

    async function runStatus(runId: string) {
      const [row] = await pg.handle.db
        .select({ status: t.agentRuns.status })
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, runId));
      return row?.status;
    }

    it('GET /runs/:id/trace returns 404 for another workspace and the trace for its own', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const foreign = await seedRun(await foreignWorkspace(), 'done');
      const own = await seedRun(workspaceId, 'done');

      const denied = await app.inject({ method: 'GET', url: `/runs/${foreign.id}/trace` });
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain('secret trace');

      const allowed = await app.inject({ method: 'GET', url: `/runs/${own.id}/trace` });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toEqual(TRACE);
      await app.close();
    });

    it('GET /runs/:id/events returns 404 for another workspace before streaming', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const foreign = await seedRun(await foreignWorkspace(), 'running');

      const res = await app.inject({ method: 'GET', url: `/runs/${foreign.id}/events` });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).not.toContain('text/event-stream');
      await app.close();
    });

    it('GET /runs/:id/events streams an own-workspace run', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const own = await seedRun(workspaceId, 'done');
      // Buffer one event and complete the run so the replay-then-end stream finishes.
      app.container.runBus.publish(own.id, 'info', 'own workspace event');
      app.container.runBus.complete(own.id);

      const res = await app.inject({ method: 'GET', url: `/runs/${own.id}/events` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('own workspace event');
      await app.close();
    });

    it('POST /runs/:id/cancel returns 404 for another workspace and leaves the run untouched', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const foreign = await seedRun(await foreignWorkspace(), 'running');
      const own = await seedRun(workspaceId, 'running');

      const denied = await app.inject({ method: 'POST', url: `/runs/${foreign.id}/cancel` });
      expect(denied.statusCode).toBe(404);
      expect(await runStatus(foreign.id)).toBe('running');

      const allowed = await app.inject({ method: 'POST', url: `/runs/${own.id}/cancel` });
      expect(allowed.statusCode).toBe(200);
      expect(await runStatus(own.id)).toBe('cancelled');
      await app.close();
    });
  });

  describe("PR-list FINDINGS: each agent's latest successful review run", () => {
    const at = (time: string) => new Date(`2026-10-20T${time}:00Z`);

    async function insertAgent(name: string) {
      const [agent] = await pg.handle.db
        .insert(t.agents)
        .values({ workspaceId, name, provider: 'openrouter', model: 'test/model', systemPrompt: 'Review the diff.' })
        .returning();
      return agent!.id;
    }

    /** One review run on the PR; `agent` sets both ids unless `reviewAgent` / `runAgent` override one. */
    async function insertReviewRun(
      prId: string,
      o: {
        agent?: string | null;
        reviewAgent?: string | null;
        runAgent?: string | null;
        status?: 'done' | 'failed';
        ranAt: string;
        createdAt: string;
        reviewId?: string;
        findings?: { severity: string; title: string }[];
      },
    ) {
      const [run] = await pg.handle.db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          prId,
          agentId: o.runAgent !== undefined ? o.runAgent : o.agent ?? null,
          status: o.status ?? 'done',
          costUsd: 0.01,
          ranAt: at(o.ranAt),
        })
        .returning();
      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({
          ...(o.reviewId ? { id: o.reviewId } : {}),
          workspaceId,
          prId,
          agentId: o.reviewAgent !== undefined ? o.reviewAgent : o.agent ?? null,
          runId: run!.id,
          kind: 'review',
          score: 50,
          createdAt: at(o.createdAt),
        })
        .returning();
      if (o.findings?.length) {
        await pg.handle.db.insert(t.findings).values(
          o.findings.map((f, i) => ({
            reviewId: review!.id,
            severity: f.severity,
            category: 'bug',
            title: f.title,
            file: 'src/a.ts',
            startLine: i + 1,
            endLine: i + 1,
            rationale: f.title,
            confidence: 0.9,
          })),
        );
      }
    }

    async function listFindings(repoId: string, prId: string) {
      const app = await appWith(REVIEW_FIXTURE);
      const listed = (await app.inject({ method: 'GET', url: '/repos/' + repoId + '/pulls' })).json()
        .find((item: { id: string }) => item.id === prId);
      await app.close();
      return {
        counts: listed.findings_by_severity,
        previews: (listed.finding_previews as { title: string; agent_name?: string | null }[]).map((p) => [
          p.title,
          p.agent_name,
        ]),
      };
    }

    it('includes the latest review of every agent, names each agent, and orders by severity', async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const security = await insertAgent('Security Reviewer');
      const performance = await insertAgent('Performance Reviewer');
      await insertReviewRun(pr.id, {
        agent: security, ranAt: '12:00', createdAt: '12:05',
        findings: [{ severity: 'SUGGESTION', title: 'Security suggestion' }, { severity: 'CRITICAL', title: 'Security critical' }],
      });
      await insertReviewRun(pr.id, {
        agent: performance, ranAt: '11:00', createdAt: '11:05',
        findings: [{ severity: 'WARNING', title: 'Performance warning' }],
      });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
        previews: [
          ['Security critical', 'Security Reviewer'],
          ['Performance warning', 'Performance Reviewer'],
          ['Security suggestion', 'Security Reviewer'],
        ],
      });
    });

    it("counts only an agent's newest review when it reviewed the PR twice", async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('General Reviewer');
      await insertReviewRun(pr.id, { agent, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'CRITICAL', title: 'Old critical' }] });
      await insertReviewRun(pr.id, { agent, ranAt: '11:00', createdAt: '11:05', findings: [{ severity: 'WARNING', title: 'New warning' }] });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['New warning', 'General Reviewer']],
      });
    });

    it("keeps an agent's last successful review when its newer run failed", async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('Security Reviewer');
      await insertReviewRun(pr.id, { agent, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'WARNING', title: 'Successful warning' }] });
      await insertReviewRun(pr.id, {
        agent, status: 'failed', ranAt: '11:00', createdAt: '11:05',
        findings: [{ severity: 'CRITICAL', title: 'Failed-run critical' }],
      });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Successful warning', 'Security Reviewer']],
      });
    });

    it("groups a review under its own agent when its run has none, and resolves that agent's name", async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('Review-Only Agent');
      await insertReviewRun(pr.id, { agent, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'CRITICAL', title: 'Older' }] });
      await insertReviewRun(pr.id, {
        reviewAgent: agent, runAgent: null, ranAt: '11:00', createdAt: '11:05',
        findings: [{ severity: 'WARNING', title: 'Newer, review names the agent' }],
      });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Newer, review names the agent', 'Review-Only Agent']],
      });
    });

    it("uses the run's agent when the review has none", async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('Run-Only Agent');
      await insertReviewRun(pr.id, { agent, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'CRITICAL', title: 'Older' }] });
      await insertReviewRun(pr.id, {
        reviewAgent: null, runAgent: agent, ranAt: '11:00', createdAt: '11:05',
        findings: [{ severity: 'WARNING', title: 'Newer, run names the agent' }],
      });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Newer, run names the agent', 'Run-Only Agent']],
      });
    });

    it('picks the higher review id when two runs of an agent share their timestamps', async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('Tied Agent');
      await insertReviewRun(pr.id, {
        agent, ranAt: '10:00', createdAt: '10:05', reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        findings: [{ severity: 'WARNING', title: 'Higher id wins' }],
      });
      await insertReviewRun(pr.id, {
        agent, ranAt: '10:00', createdAt: '10:05', reviewId: '00000000-0000-4000-8000-000000000000',
        findings: [{ severity: 'CRITICAL', title: 'Lower id loses' }],
      });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Higher id wins', 'Tied Agent']],
      });
    });

    it("drops an agent's older findings when its latest review found nothing", async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const cleaned = await insertAgent('Cleaned-Up Agent');
      const other = await insertAgent('Other Agent');
      await insertReviewRun(pr.id, { agent: cleaned, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'CRITICAL', title: 'Stale critical' }] });
      await insertReviewRun(pr.id, { agent: cleaned, ranAt: '11:00', createdAt: '11:05' });
      await insertReviewRun(pr.id, { agent: other, ranAt: '09:00', createdAt: '09:05', findings: [{ severity: 'WARNING', title: 'Other warning' }] });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Other warning', 'Other Agent']],
      });
    });

    it('takes the run that started last when two runs of an agent overlap', async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await insertAgent('Overlapping Agent');
      await insertReviewRun(pr.id, { agent, ranAt: '12:00', createdAt: '12:20', findings: [{ severity: 'CRITICAL', title: 'Started 12:00, finished 12:20' }] });
      await insertReviewRun(pr.id, { agent, ranAt: '12:10', createdAt: '12:15', findings: [{ severity: 'WARNING', title: 'Started 12:10, finished 12:15' }] });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Started 12:10, finished 12:15', 'Overlapping Agent']],
      });
    });

    it('keeps the group of an agent that no longer exists, without a name', async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const deletedAgent = crypto.randomUUID();
      await insertReviewRun(pr.id, { reviewAgent: deletedAgent, runAgent: null, ranAt: '10:00', createdAt: '10:05', findings: [{ severity: 'CRITICAL', title: 'Older' }] });
      await insertReviewRun(pr.id, { reviewAgent: deletedAgent, runAgent: null, ranAt: '11:00', createdAt: '11:05', findings: [{ severity: 'WARNING', title: 'Deleted agent, latest' }] });

      expect(await listFindings(repo.id, pr.id)).toEqual({
        counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
        previews: [['Deleted agent, latest', null]],
      });
    });
  });
});
