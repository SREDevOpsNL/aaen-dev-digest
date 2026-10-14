import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  IntentAnalysis,
  IntentAnalysisRaw,
  Review,
  RunTrace,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { IntentRepository } from '../src/modules/intent/repository.js';
import { IntentService } from '../src/modules/intent/service.js';
import { issueHash } from '../src/modules/intent/helpers.js';
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

const INTENT_RAW: IntentAnalysisRaw = {
  claimed_purpose: 'Add the Stripe key to config',
  supported_points: [
    { statement: 'Adds a Stripe key to the config', evidence: [{ file: 'src/config.ts', side: 'new', start_line: 11, end_line: 11 }] },
  ],
  discrepancies: [],
  in_scope: ['payment configuration'],
  out_of_scope: ['rate limiting'],
  confidence: 'medium',
};

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 40,
  findings: [{
    id: 'f1', severity: 'CRITICAL', category: 'security', title: 'Hardcoded Stripe secret key',
    file: 'src/config.ts', start_line: 11, end_line: 11, rationale: 'Live key in source.', confidence: 0.95, kind: 'finding',
  }],
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Review calls return REVIEW at $0.01; Intent calls are counted, can block or fail, and cost $0.004. */
class IntentLLM extends MockLLMProvider {
  intentCalls = 0;
  gate: ReturnType<typeof deferred> | null = null;
  failIntent = false;
  intentFixture: IntentAnalysisRaw = INTENT_RAW;
  /** callGates[i] holds the (i+1)-th intent call until resolved (deterministic ordering). */
  callGates: ReturnType<typeof deferred>[] = [];
  /** Optional per-call fixture, so concurrent derivations are distinguishable. */
  fixtureFor: ((call: number) => IntentAnalysisRaw) | null = null;
  /** The classifier input of each intent call, in call order. */
  prompts: string[] = [];

  constructor() {
    super('openai', { structuredBySchema: { Review: REVIEW } });
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.schemaName !== 'Intent') {
      const res = await super.completeStructured(req);
      return { ...res, providerCostUsd: 0.01 };
    }
    this.intentCalls += 1;
    const call = this.intentCalls;
    this.prompts.push(req.messages.map((m) => m.content).join('\n'));
    const gate = this.callGates[call - 1] ?? this.gate;
    if (gate) await gate.promise;
    if (this.failIntent) throw new Error('classifier exploded');
    const fixture = this.fixtureFor ? this.fixtureFor(call) : this.intentFixture;
    return {
      data: fixture as unknown as T,
      model: 'cheap-intent-model',
      tokensIn: 300,
      tokensOut: 80,
      providerCostUsd: 0.004,
      costUsd: 0.004,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

/** A git client whose diff load waits on a gate, so a test can act before review pre-work. */
class GatedGit extends MockGitClient {
  gate = deferred();
  override async diff(...args: Parameters<MockGitClient['diff']>) {
    await this.gate.promise;
    return super.diff(...args);
  }
}

/** A GitHub client whose linked issue can be edited while a derivation is in flight. */
class MutableIssueGitHub extends MockGitHubClient {
  issueBody = 'ISSUE-V1: add the Stripe key';
  override async getIssue(_repo: Parameters<MockGitHubClient['getIssue']>[0], n: number) {
    return { number: n, title: `Issue #${n}`, body: this.issueBody, state: 'open' as const };
  }
}
const ISSUE_V2 = 'ISSUE-V2: scope changed to key rotation';

let seq = 0;

d('Intent Layer (Testcontainers pg)', () => {
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

  async function setup(
    opts: { body?: string; ws?: string; noKeys?: boolean; git?: MockGitClient; github?: MockGitHubClient } = {},
  ) {
    const llm = new IntentLLM();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: opts.git ?? new MockGitClient({ diff: DIFF }),
        github: opts.github ?? new MockGitHubClient(),
        ...(opts.noKeys ? { llm: {}, secrets: new MockSecretsProvider({}) } : { llm: { openai: llm } }),
      },
    });
    const ws = opts.ws ?? workspaceId;
    const name = `intent-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws, repoId: repo!.id, number: 7, title: 'Add Stripe config', author: 'dev',
        branch: 'feat/stripe', base: 'main', headSha: 'head-1', body: opts.body ?? 'Adds payment config.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0 });
    return { app, llm, pr: pr!, repo: repo! };
  }

  const intentUrl = (prId: string) => `/pulls/${prId}/intent`;

  it('GET never calls the model; first-open POST generates once and caches', async () => {
    const { app, llm, pr } = await setup();
    const before = (await app.inject({ method: 'GET', url: intentUrl(pr.id) })).json();
    expect(before.state).toBe('missing');
    expect(llm.intentCalls).toBe(0);

    const first = (await app.inject({ method: 'POST', url: intentUrl(pr.id) })).json();
    expect(first).toMatchObject({ state: 'ready', stale: false, model: 'cheap-intent-model', provider_cost_usd: 0.004 });
    expect(first.analysis.supported_points).toHaveLength(1);
    expect(llm.intentCalls).toBe(1);

    await app.inject({ method: 'POST', url: intentUrl(pr.id) });
    const after = (await app.inject({ method: 'GET', url: intentUrl(pr.id) })).json();
    expect(after.state).toBe('ready');
    expect(llm.intentCalls).toBe(1); // reused, not regenerated
    await app.close();
  });

  it('concurrent first-open requests share one classifier call', async () => {
    const { app, llm, pr } = await setup();
    llm.gate = deferred();
    // Count entries into the single-flight point, so the gate opens only once
    // all three requests are waiting on the same derivation.
    const deriveSpy = vi.spyOn(IntentService.prototype as unknown as { derive: () => unknown }, 'derive');
    try {
      const a = app.inject({ method: 'POST', url: intentUrl(pr.id) });
      const b = app.inject({ method: 'POST', url: intentUrl(pr.id) });
      const c = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` });
      await vi.waitFor(() => expect(deriveSpy).toHaveBeenCalledTimes(3));
      llm.gate.resolve();
      const results = await Promise.all([a, b, c]);
      expect(results.map((r) => r.json().state)).toEqual(['ready', 'ready', 'ready']);
      expect(llm.intentCalls).toBe(1);
    } finally {
      deriveSpy.mockRestore();
      await app.close();
    }
  });

  it('shows stale intent after a new head or edited description, and only Recompute regenerates', async () => {
    const { app, llm, pr } = await setup();
    await app.inject({ method: 'POST', url: intentUrl(pr.id) });
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
    let view = (await app.inject({ method: 'GET', url: intentUrl(pr.id) })).json();
    expect(view).toMatchObject({ stale: true, stale_reasons: ['head_changed'], head_sha: 'head-1', current_head_sha: 'head-2' });

    await pg.handle.db.update(t.pullRequests).set({ body: 'Edited description.' }).where(eq(t.pullRequests.id, pr.id));
    view = (await app.inject({ method: 'POST', url: intentUrl(pr.id) })).json(); // first-open path
    expect(view.stale_reasons).toEqual(['head_changed', 'context_changed']);
    expect(llm.intentCalls).toBe(1); // no automatic regeneration

    view = (await app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` })).json();
    expect(view).toMatchObject({ state: 'ready', stale: false, head_sha: 'head-2' });
    expect(llm.intentCalls).toBe(2);
    await app.close();
  });

  it('a failed Recompute keeps the previous valid intent and reports the error', async () => {
    const { app, llm, pr } = await setup();
    const good = (await app.inject({ method: 'POST', url: intentUrl(pr.id) })).json();
    llm.failIntent = true;
    const view = (await app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` })).json();
    expect(view.state).toBe('ready');
    expect(view.analysis).toEqual(good.analysis);
    expect(view.last_error).toContain('classifier exploded');
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.totalCostComplete).toBe(false); // the failed call may have been billed
    await app.close();
  });

  it('without a provider key, first open records skipped_no_key instead of failing', async () => {
    const { app, pr } = await setup({ noKeys: true });
    const res = await app.inject({ method: 'POST', url: intentUrl(pr.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'skipped_no_key', analysis: null });
    expect(res.json().last_error).toMatch(/not configured/);
    await app.close();
  });

  it('every intent route is workspace-scoped', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `intent-other-${Date.now()}` }).returning();
    const { app, llm, pr } = await setup({ ws: other!.id });
    for (const [method, url] of [
      ['GET', intentUrl(pr.id)],
      ['POST', intentUrl(pr.id)],
      ['POST', `${intentUrl(pr.id)}/recompute`],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(404);
    }
    expect(llm.intentCalls).toBe(0);
    await app.close();
  });

  it('uses a linked issue only when a closing keyword identifies it', async () => {
    const linked = await setup({ body: 'Fixes #12' });
    expect((await linked.app.inject({ method: 'POST', url: intentUrl(linked.pr.id) })).json().linked_issue)
      .toEqual({ number: 12, title: 'Issue #12' });
    await linked.app.close();

    const mention = await setup({ body: 'Related to #12' });
    expect((await mention.app.inject({ method: 'POST', url: intentUrl(mention.pr.id) })).json().linked_issue).toBeNull();
    await mention.app.close();
  });

  it('an older derivation never overwrites a newer one, but its spend is still counted', async () => {
    const { pr } = await setup();
    const repo = new IntentRepository(pg.handle.db);
    const analysis = (claimed: string): IntentAnalysis => ({ ...INTENT_RAW, claimed_purpose: claimed, unverified_statements: [] });
    const save = (claimed: string, startedAt: Date, cost: number | null) =>
      repo.saveSuccess({
        prId: pr.id, derivationId: crypto.randomUUID(), startedAt, analysis: analysis(claimed),
        evidence: { files_listed: 1, files_excerpted: 1, truncated: false, invalid_citations: 0 },
        headSha: 'head-1', contextHash: 'c', issueHash: 'i', promptVersion: 1, linkedIssue: null,
        provider: 'openai', model: 'm', tokensIn: 10, tokensOut: 5, providerCostUsd: cost,
      });
    expect(await save('newer', new Date('2026-10-14T10:00:02Z'), 0.002)).toBe(true);
    expect(await save('older', new Date('2026-10-14T10:00:01Z'), 0.003)).toBe(false);
    await repo.saveFailure(pr.id, { status: 'failed', error: 'late failure', at: new Date(), mayHaveBilled: false });

    const row = (await repo.get(pr.id))!;
    expect(row.analysis!.claimed_purpose).toBe('newer');
    expect(row.status).toBe('ready');
    expect(row.lastError).toBe('late failure');
    expect(row.totalTokensIn).toBe(20);
    expect(row.totalProviderCostUsd).toBeCloseTo(0.005);
    expect(row.intent).toBe('Adds a Stripe key to the config'); // legacy non-null column kept populated
  });

  describe('review integration', () => {
    async function reviewBatch(agentCount: number, opts: Parameters<typeof setup>[0] = {}) {
      const ctx = await setup(opts);
      const agents = [];
      for (let i = 0; i < agentCount; i++) {
        const created = (
          await ctx.app.inject({
            method: 'POST',
            url: '/agents',
            payload: { name: `intent-agent-${seq}-${i}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
          })
        ).json();
        const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, created.id));
        agents.push(row!);
      }
      const run = async () => {
        const { runs } = await new ReviewService(ctx.app.container).runReview(workspaceId, ctx.pr.id, agents);
        await waitForPrRuns(pg.handle.db, ctx.pr.id, { expected: runs.length });
        // Status commits before the trace is saved: wait for every trace.
        const traces: RunTrace[] = [];
        for (const r of runs) {
          await vi.waitFor(async () => {
            const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, r.run_id));
            expect(row).toBeDefined();
            traces.push(row!.trace as RunTrace);
          });
        }
        return { runs, traces };
      };
      return { ...ctx, run };
    }

    it('reuses fresh cached intent across agents and records it in each trace', async () => {
      const { app, llm, pr, run } = await reviewBatch(2);
      await app.inject({ method: 'POST', url: intentUrl(pr.id) });
      const { traces } = await run();
      expect(llm.intentCalls).toBe(1);
      for (const trace of traces) {
        expect(trace.intent).toMatchObject({ source: 'cache', status: 'used', attribution: 'shared' });
        expect(trace.prompt_assembly.intent).toContain('<untrusted source="intent">');
        expect(trace.prompt_assembly.system).toContain('INTENT POLICY');
      }
      await app.close();
    });

    it('refreshes stale intent once for the whole batch', async () => {
      const { app, llm, pr, run } = await reviewBatch(2);
      await app.inject({ method: 'POST', url: intentUrl(pr.id) });
      await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
      const { traces } = await run();
      expect(llm.intentCalls).toBe(2);
      expect(traces.map((tr) => tr.intent?.source)).toEqual(['derived', 'derived']);
      expect(traces[0]!.intent!.derivation_id).toBe(traces[1]!.intent!.derivation_id);
      expect(traces[0]!.intent!.head_sha).toBe('head-2');
      await app.close();
    });

    it('reviews without intent when generation fails, and never uses the stale intent', async () => {
      const { app, llm, pr, run } = await reviewBatch(1);
      await app.inject({ method: 'POST', url: intentUrl(pr.id) });
      await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
      llm.failIntent = true;
      const { runs, traces } = await run();
      expect(traces[0]!.intent).toMatchObject({ source: 'none', status: 'failed', analysis: null });
      expect(traces[0]!.prompt_assembly.intent ?? null).toBeNull();
      expect(traces[0]!.prompt_assembly.system).not.toContain('INTENT POLICY');
      const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runs[0]!.run_id));
      expect(row!.status).toBe('done'); // the review itself still ran
      await app.close();
    });

    it('keeps the trace immutable after Recompute and keeps classifier cost out of review totals', async () => {
      const { app, llm, pr, repo, run } = await reviewBatch(1);
      await app.inject({ method: 'POST', url: intentUrl(pr.id) });
      const { runs } = await run();
      const traceUrl = `/runs/${runs[0]!.run_id}/trace`;
      const before = (await app.inject({ method: 'GET', url: traceUrl })).json();

      llm.intentFixture = { ...INTENT_RAW, claimed_purpose: 'A completely different purpose' };
      await app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` });
      const after = (await app.inject({ method: 'GET', url: traceUrl })).json();
      expect(after.intent).toEqual(before.intent);
      expect(after.intent.analysis.claimed_purpose).toBe('Add the Stripe key to config');

      const [agentRun] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runs[0]!.run_id));
      expect(agentRun!.costUsd).toBeCloseTo(0.01); // review only, no classifier cost
      const listed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json()
        .find((p: { id: string }) => p.id === pr.id);
      expect(listed.cost_usd).toBeCloseTo(0.01);
      await app.close();
    });

    it('a Recompute for an updated PR never joins the older in-flight derivation, and the older result never overwrites it', async () => {
      const { app, llm, pr } = await setup();
      llm.callGates = [deferred(), deferred()];
      llm.fixtureFor = (call) => ({ ...INTENT_RAW, claimed_purpose: call === 1 ? 'derived for head-1' : 'derived for head-2' });

      const older = app.inject({ method: 'POST', url: intentUrl(pr.id) }); // head-1
      await vi.waitFor(() => expect(llm.intentCalls).toBe(1));
      await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
      const newer = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` }); // head-2
      await vi.waitFor(() => expect(llm.intentCalls).toBe(2)); // its own call, not joined

      llm.callGates[1]!.resolve(); // the newer derivation finishes first
      expect((await newer).json()).toMatchObject({ head_sha: 'head-2', stale: false });
      llm.callGates[0]!.resolve(); // the older one finishes last and is superseded
      await older;

      const view = (await app.inject({ method: 'GET', url: intentUrl(pr.id) })).json();
      expect(view).toMatchObject({ head_sha: 'head-2', stale: false });
      expect(view.analysis.claimed_purpose).toBe('derived for head-2');
      const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
      expect(row!.totalTokensIn).toBe(600); // both calls are accounted for
      await app.close();
    });

    it('a review batch never injects a derivation that was superseded', async () => {
      const { app, llm, pr, run } = await reviewBatch(1);
      llm.callGates = [deferred(), deferred()];
      llm.fixtureFor = (call) => ({ ...INTENT_RAW, claimed_purpose: call === 1 ? 'batch derivation (head-1)' : 'recompute (head-2)' });

      const batch = run(); // the batch snapshot is head-1; its derivation is call 1
      await vi.waitFor(() => expect(llm.intentCalls).toBe(1));
      await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
      const recompute = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` });
      await vi.waitFor(() => expect(llm.intentCalls).toBe(2));
      llm.callGates[1]!.resolve();
      await recompute; // head-2 wins the cache
      llm.callGates[0]!.resolve(); // the batch's own derivation is now superseded

      const { traces, runs } = await batch;
      expect(traces[0]!.intent).toMatchObject({ source: 'none', status: 'superseded', analysis: null });
      expect(traces[0]!.prompt_assembly.intent ?? null).toBeNull();
      const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runs[0]!.run_id));
      expect(row!.status).toBe('done'); // reviewed, just without intent
      await app.close();
    });

    it('a Recompute after the linked issue is edited never joins the derivation that read the older issue', async () => {
      const github = new MutableIssueGitHub();
      const { app, llm, pr } = await setup({ body: 'Fixes #12', github });
      llm.callGates = [deferred(), deferred()];
      llm.fixtureFor = (call) => ({ ...INTENT_RAW, claimed_purpose: call === 1 ? 'from issue v1' : 'from issue v2' });

      const older = app.inject({ method: 'POST', url: intentUrl(pr.id) }); // reads issue v1
      await vi.waitFor(() => expect(llm.intentCalls).toBe(1));
      github.issueBody = ISSUE_V2; // same PR, head and description; only the issue changed
      const newer = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` });
      await vi.waitFor(() => expect(llm.intentCalls).toBe(2)); // its own call, not joined
      expect(llm.prompts[0]).toContain('ISSUE-V1');
      expect(llm.prompts[1]).toContain('ISSUE-V2');

      llm.callGates[1]!.resolve();
      await newer;
      llm.callGates[0]!.resolve(); // the v1 derivation finishes last and is superseded
      await older;

      const view = (await app.inject({ method: 'GET', url: intentUrl(pr.id) })).json();
      expect(view.analysis.claimed_purpose).toBe('from issue v2');
      const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
      expect(row!.issueHash).toBe(issueHash({ number: 12, title: 'Issue #12', body: ISSUE_V2 }));
      await app.close();
    });

    it('a review batch never joins a derivation that read an outdated linked issue', async () => {
      const github = new MutableIssueGitHub();
      const { app, llm, pr, run } = await reviewBatch(1, { body: 'Fixes #12', github });
      llm.callGates = [deferred(), deferred()];
      llm.fixtureFor = (call) => ({ ...INTENT_RAW, claimed_purpose: call === 1 ? 'from issue v1' : 'from issue v2' });

      const recompute = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` }); // issue v1
      await vi.waitFor(() => expect(llm.intentCalls).toBe(1));
      github.issueBody = ISSUE_V2;
      const batch = run(); // reads issue v2, so it needs its own derivation
      await vi.waitFor(() => expect(llm.intentCalls).toBe(2));
      llm.callGates[1]!.resolve();

      const { traces } = await batch;
      expect(traces[0]!.intent).toMatchObject({ source: 'derived', status: 'used' });
      expect(traces[0]!.intent!.analysis!.claimed_purpose).toBe('from issue v2');
      llm.callGates[0]!.resolve();
      await recompute;
      await app.close();
    });

    it('a review batch never injects intent derived from an outdated linked issue', async () => {
      const github = new MutableIssueGitHub();
      const { app, llm, pr, run } = await reviewBatch(1, { body: 'Fixes #12', github });
      llm.callGates = [deferred(), deferred()];
      llm.fixtureFor = (call) => ({ ...INTENT_RAW, claimed_purpose: call === 1 ? 'from issue v1' : 'from issue v2' });

      const batch = run(); // reads issue v1; its derivation is call 1
      await vi.waitFor(() => expect(llm.intentCalls).toBe(1));
      github.issueBody = ISSUE_V2;
      const recompute = app.inject({ method: 'POST', url: `${intentUrl(pr.id)}/recompute` });
      await vi.waitFor(() => expect(llm.intentCalls).toBe(2));
      llm.callGates[1]!.resolve();
      await recompute; // the v2 derivation wins the cache
      llm.callGates[0]!.resolve(); // the batch's v1 derivation is superseded

      const { traces } = await batch;
      expect(traces[0]!.intent).toMatchObject({ source: 'none', status: 'superseded', analysis: null });
      expect(traces[0]!.prompt_assembly.intent ?? null).toBeNull();
      await app.close();
    });

    it('an older failed attempt never overwrites newer success metadata, but still marks cost incomplete', async () => {
      const { pr } = await setup();
      const repo = new IntentRepository(pg.handle.db);
      await repo.saveSuccess({
        prId: pr.id, derivationId: crypto.randomUUID(), startedAt: new Date('2026-10-14T12:00:02Z'),
        analysis: { ...INTENT_RAW, unverified_statements: [] },
        evidence: { files_listed: 1, files_excerpted: 1, truncated: false, invalid_citations: 0 },
        headSha: 'head-1', contextHash: 'c', issueHash: 'i', promptVersion: 1, linkedIssue: null,
        provider: 'openai', model: 'm', tokensIn: 10, tokensOut: 5, providerCostUsd: 0.001,
      });
      await repo.saveFailure(pr.id, { status: 'failed', error: 'stale failure', at: new Date('2026-10-14T12:00:01Z'), mayHaveBilled: true });
      let row = (await repo.get(pr.id))!;
      expect(row.lastError).toBeNull();
      expect(row.lastAttemptAt!.toISOString()).toBe('2026-10-14T12:00:02.000Z');
      expect(row.totalCostComplete).toBe(false);

      await repo.saveFailure(pr.id, { status: 'failed', error: 'newer failure', at: new Date('2026-10-14T12:00:03Z'), mayHaveBilled: false });
      row = (await repo.get(pr.id))!;
      expect(row.lastError).toBe('newer failure');
      expect(row.status).toBe('ready'); // the valid analysis is kept
    });

    it('cancelling every queued run before intent starts makes no classifier call', async () => {
      const git = new GatedGit({ diff: DIFF });
      const { app, llm, pr, agents } = await (async () => {
        const ctx = await reviewBatch(2, { git });
        const rows = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
        return { ...ctx, agents: rows.filter((a) => a.name.startsWith(`intent-agent-${seq - 1}-`)) };
      })();
      const { runs } = await new ReviewService(app.container).runReview(workspaceId, pr.id, agents);
      for (const r of runs) await app.inject({ method: 'POST', url: `/runs/${r.run_id}/cancel` });
      git.gate.resolve(); // pre-work resumes only after every run is cancelled

      for (const r of runs) {
        await vi.waitFor(async () => {
          const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, r.run_id));
          expect(row).toBeDefined();
          expect((row!.trace as RunTrace).intent).toMatchObject({ source: 'none', status: 'not_started' });
        });
        const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, r.run_id));
        expect(run!.status).toBe('cancelled');
      }
      expect(llm.intentCalls).toBe(0);
      await app.close();
    });
  });
});
