import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review, RunTrace, Skill, StructuredResult } from '@devdigest/shared';
import { AttemptRecorder, ProviderOutputError, ReviewRefusedError, type LifecycleStructuredRequest } from '@devdigest/reviewer-core';
import { buildApp } from '../src/app.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import { EXPERIMENT_FIXTURES, patchStats } from '../src/db/seed-fixtures.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { ConfigError, SkillNotApprovedError } from '../src/platform/errors.js';
import { ExperimentSpendRefusedError } from '../src/platform/experiment-spend-gate.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import { ExperimentRefusedError } from '../src/modules/reviews/experiment-run.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { preDispatchRefusal } from '../src/modules/reviews/run-executor.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { REAPED_CANCELLED_NOTE, REAPED_NOTE } from '../src/modules/reviews/reaped-trace.js';
import { TOP_ASSEMBLY_MAX_BYTES, assemblyDigest } from '../src/modules/reviews/trace-recorder.js';
import { promptEvidence } from '../src/modules/_shared/trace-evidence.js';
import { sha256 } from '../src/modules/_shared/experiment.js';
import { writeCapability } from '../src/experiments/hw2/cli.js';
import { buildReport, executionIssues, promptIssues, renderReport, type SlotRunData } from '../src/experiments/hw2/report.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { approveSkill } from './helpers/skills.js';
import { FAKE_MODEL, FakeExperimentProvider, TRUNCATED_OUTPUT, TRUNCATED_USAGE } from './helpers/fake-experiment-provider.js';

/**
 * The five lifecycle cases of a run's trace (refused, success, truncated,
 * provider error after dispatch, cancelled), map-stage failure, structured
 * retries, the one-transaction terminal write, the reaper, the legacy
 * classification, and the HW2 report and slot view. Every prompt and output
 * is synthetic; no provider is contacted.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[run-failure-trace] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const ONE_FILE = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  retries: 3,
   redisUrl: x,`;

const TWO_FILES = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -0,0 +1 @@
+export const a = 1;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -0,0 +1 @@
+export const b = 2;`;

const CLEAN: Review = { verdict: 'approve', summary: 'Synthetic: nothing to report.', score: 100, findings: [] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

type Step = 'ok' | 'invalid-then-ok' | 'truncate' | 'truncate-nul' | 'ok-nul' | 'ok-no-usage' | 'http-429' | 'hold' | 'throw-secret' | 'throw-configured-key';

/** A configured key whose shape no credential pattern recognizes: only redaction by value can catch it. */
const CONFIGURED_KEY = 'custom.shape:OPENAI~key0123';

/** An SDK-style error message carrying an upstream body: a credential, a NUL and 3,000 characters. */
const SECRET_ERROR = `502 upstream said: Authorization: Bearer sk-or-v1-itestsecret0123456789\u0000 ${'q'.repeat(3000)}`;

/** Text with characters Postgres text/jsonb rejects: U+0000 and an unpaired surrogate. */
const NUL_TEXT = 'before\u0000after \uD800 end';

/**
 * A provider that reports its attempts through the stage lifecycle exactly as
 * the real adapters do, one scripted step per structured call.
 */
class ScriptedLLM extends MockLLMProvider {
  steps: Step[] = [];
  started = deferred();
  gate = deferred();
  structuredCalls = 0;

  override async completeStructured<T>(req: LifecycleStructuredRequest<T>): Promise<StructuredResult<T>> {
    this.structuredCalls++;
    const step = this.steps.shift() ?? 'ok';
    const recorder = new AttemptRecorder(req.lifecycle);
    const ok = (tokensIn: number, tokensOut: number, cost: number, attempts: number): StructuredResult<T> => ({
      data: CLEAN as T, model: req.model, tokensIn, tokensOut, providerCostUsd: cost, costUsd: cost, raw: JSON.stringify(CLEAN), attempts,
    });
    const usage = { tokens_in: 100, tokens_out: 50, cost_usd: 0.0001 };
    if (step === 'throw-configured-key') {
      recorder.submit('initial').failed('http_error', { http_status: 401 });
      throw Object.assign(new Error(`401 Incorrect API key provided: ${CONFIGURED_KEY}`), { status: 401 });
    }
    if (step === 'throw-secret') {
      recorder.submit('initial').failed('network_error');
      throw new Error(SECRET_ERROR);
    }
    if (step === 'http-429') {
      recorder.submit('initial').failed('http_error', { http_status: 429 });
      throw Object.assign(new Error('429 Provider returned error'), { status: 429 });
    }
    if (step === 'truncate' || step === 'truncate-nul') {
      const a = recorder.submit('initial');
      a.received({ response_id: 'gen-1793471676-synthetic0002', finish_reason: 'length', http_status: 200, usage: { tokens_in: TRUNCATED_USAGE.tokensIn, tokens_out: TRUNCATED_USAGE.tokensOut, cost_usd: TRUNCATED_USAGE.costUsd } });
      a.failed('truncated', { finish_reason: 'length' });
      throw new ProviderOutputError('OpenRouter structured output failed schema validation for Review', {
        kind: 'truncated', text: step === 'truncate' ? TRUNCATED_OUTPUT : `${TRUNCATED_OUTPUT}${NUL_TEXT}`, usage: TRUNCATED_USAGE, finishReason: 'length', responseId: 'gen-1793471676-synthetic0002', attempts: 1,
      });
    }
    if (step === 'ok-nul') {
      recorder.submit('initial').received({ response_id: 'gen-ok-nul', finish_reason: 'stop', http_status: 200, usage });
      const data = { ...CLEAN, summary: `Synthetic ${NUL_TEXT}` };
      return { data: data as T, model: req.model, tokensIn: 100, tokensOut: 50, providerCostUsd: 0.0001, costUsd: 0.0001, raw: JSON.stringify(data).replace('\\u0000', '\u0000'), attempts: 1 };
    }
    if (step === 'ok-no-usage') {
      // The response omitted its token counts; the adapter's result still carries numbers (the contract's 0).
      recorder.submit('initial').received({ response_id: 'gen-ok-nousage', finish_reason: 'stop', http_status: 200, usage: { tokens_in: null, tokens_out: null, cost_usd: null } });
      return ok(0, 0, 0, 1);
    }
    if (step === 'invalid-then-ok') {
      const first = recorder.submit('initial');
      first.received({ response_id: 'gen-retry-1', finish_reason: 'stop', http_status: 200, usage });
      first.failed('schema_invalid', { finish_reason: 'stop' });
      recorder.submit('structured_retry').received({ response_id: 'gen-retry-2', finish_reason: 'stop', http_status: 200, usage });
      return ok(200, 100, 0.0002, 2);
    }
    const a = recorder.submit('initial');
    if (step === 'hold') {
      this.started.resolve();
      await this.gate.promise;
    }
    a.received({ response_id: 'gen-ok-1', finish_reason: 'stop', http_status: 200, usage });
    return ok(100, 50, 0.0001, 1);
  }
}

d('run traces across the request lifecycle (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setup(opts: { diff?: string; llm?: boolean; secrets?: Record<string, string> } = {}) {
    const llm = new ScriptedLLM('openai', { structured: CLEAN });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: opts.diff ?? ONE_FILE }),
        ...(opts.llm === false ? {} : { llm: { openai: llm } }),
        ...(opts.secrets ? { secrets: { get: async (key: string) => opts.secrets![key] } } : {}),
      },
    });
    const name = `trace-${++seq}`;
    const [repo] = await pg.handle.db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: 7, title: 'Synthetic change', author: 'dev', branch: 'feat/x', base: 'main', headSha: 'head-1' })
      .returning();
    const agent = async (payload: Record<string, unknown> = {}) => {
      const created = (
        await app.inject({ method: 'POST', url: '/agents', payload: { name: `${name}-agent-${++seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Synthetic reviewer.', repo_intel: false, ...payload } })
      ).json();
      const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, created.id));
      return row!;
    };
    const service = new ReviewService(app.container);
    return { app, llm, pr: pr!, agent, service };
  }

  async function settled(runId: string) {
    return vi.waitFor(
      async () => {
        const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
        const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
        if (!run || run.status === 'running' || !row) throw new Error('not settled');
        return { run, trace: row.trace as RunTrace };
      },
      { timeout: 15_000, interval: 50 },
    );
  }
  const reviewsFor = (runId: string) => pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId));

  async function linkApprovedSkill(app: Awaited<ReturnType<typeof setup>>['app'], agentId: string, approved = true) {
    const skill = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: `Synthetic rule ${++seq}`, description: '', type: 'rubric', body: 'Check the synthetic rule.' } })
    ).json() as Skill;
    if (approved) await approveSkill(app, skill.id);
    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [skill.id] } });
    return skill;
  }

  describe('case 1: refused before dispatch', () => {
    it('a missing provider key: not_dispatched, agent_config only, explicit refusal code, no usage, no attempt', async () => {
      const { app, pr, agent, service } = await setup({ llm: false });
      const a = await agent({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
      const { runs } = await service.runReview(workspaceId, pr.id, [a]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run).toMatchObject({ status: 'failed', tokensIn: 0, tokensOut: 0, costUsd: null });
      expect(trace.dispatch).toEqual({ state: 'not_dispatched', refusal: { code: 'config_error', reason: 'ANTHROPIC_API_KEY is not configured' } });
      expect(trace.prompt_assembly_source).toBe('agent_config');
      expect(trace.prompt_assembly).toEqual({ system: 'Synthetic reviewer.', skills: null, memory: null, specs: null, user: '' });
      expect(trace.stages).toEqual([]);
      expect(trace.stats).toMatchObject({ tokens_in: 0, tokens_out: 0, cost_usd: null, usage_state: 'none' });
      expect(promptEvidence(trace)).toBe('agent_config');
      await app.close();
    });

    it('an unapproved Skill: refused with skill_not_approved before any model request', async () => {
      const { app, llm, pr, agent, service } = await setup();
      const a = await agent();
      await linkApprovedSkill(app, a.id, false);
      const { runs } = await service.runReview(workspaceId, pr.id, [a]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(llm.structuredCalls).toBe(0);
      expect(run.status).toBe('failed');
      expect(trace.dispatch?.state).toBe('not_dispatched');
      expect(trace.dispatch?.refusal?.code).toBe('skill_not_approved');
      expect(trace).toMatchObject({ prompt_assembly_source: 'agent_config', stages: [], stats: { usage_state: 'none' } });
      expect(trace.prompt_assembly.skills).toBeNull();
      await app.close();
    });

    it('each pre-dispatch guard maps to its own stable refusal code; a dispatched provider error is not a refusal', () => {
      const block = {} as ConstructorParameters<typeof ExperimentRefusedError>[1];
      expect(preDispatchRefusal(new ConfigError('OPENAI_API_KEY is not configured'))?.code).toBe('config_error');
      expect(preDispatchRefusal(new SkillNotApprovedError('not approved'))?.code).toBe('skill_not_approved');
      expect(preDispatchRefusal(new ExperimentRefusedError('diff differs', block))).toEqual({ code: 'experiment_refused', reason: 'diff differs' });
      expect(preDispatchRefusal(new ExperimentSpendRefusedError('an ordinary structured call'))?.code).toBe('experiment_spend_refused');
      expect(preDispatchRefusal(new ReviewRefusedError('strategy_guard', "Experiment mode requires strategy 'single-pass'"))?.code).toBe('strategy_guard');
      expect(preDispatchRefusal(new ProviderOutputError('cut', { kind: 'truncated', text: 'x', usage: TRUNCATED_USAGE, finishReason: 'length', responseId: null, attempts: 1 }))).toBeNull();
      expect(preDispatchRefusal(Object.assign(new Error('429'), { status: 429 }))).toBeNull();
    });
  });

  describe('case 2: success', () => {
    it('unchanged content, plus completed, dispatched_request and measured; the assembly is stored once', async () => {
      const { app, pr, agent, service } = await setup();
      const a = await agent();
      await linkApprovedSkill(app, a.id);
      const { runs } = await service.runReview(workspaceId, pr.id, [a]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run).toMatchObject({ status: 'done', tokensIn: 100, tokensOut: 50, costUsd: 0.0001 });
      expect(trace).toMatchObject({
        dispatch: { state: 'completed' },
        prompt_assembly_source: 'dispatched_request',
        stats: { tokens_in: 100, tokens_out: 50, cost_usd: 0.0001, usage_state: 'measured', findings: 0 },
        raw_output: JSON.stringify(CLEAN),
        tool_calls: [{ tool: 'review_file', args: 'all files', meta: 'single-pass' }],
      });
      expect(trace.prompt_assembly.skills).toMatch(/<untrusted source="skill-0">/);
      expect(trace.prompt_assembly.skills_tokens).toBeGreaterThan(0);
      expect(trace.prompt_assembly.user).toContain('retries: 3');
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages![0]).toMatchObject({ stage_id: 'single-0', state: 'completed', assembly_sha256: trace.prompt_assembly_sha256, assembly_complete: true, usage_state: 'measured' });
      expect(trace.stages![0]!.assembly).toBeUndefined(); // the top-level prompt_assembly is the stored copy
      expect(trace.partial_output).toBeUndefined();
      expect(promptEvidence(trace)).toBe('dispatched_request');
      await app.close();
    });

    it('a structured retry is two attempts under ONE stage, each response counted once', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['invalid-then-ok'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run).toMatchObject({ status: 'done', tokensIn: 200, tokensOut: 100 });
      expect(trace.stages).toHaveLength(1);
      const attempts = trace.stages![0]!.attempts;
      expect(attempts.map((x) => [x.attempt, x.retry, x.phase, x.failure, x.response_id])).toEqual([
        [1, 'initial', 'response_received', 'schema_invalid', 'gen-retry-1'],
        [2, 'structured_retry', 'response_received', null, 'gen-retry-2'],
      ]);
      expect(trace.stages![0]!.usage).toEqual({ tokens_in: 200, tokens_out: 100, cost_usd: 0.0002 });
      await app.close();
    });
  });

  describe('case 3: truncated output', () => {
    it('failed, with the real assembly, the bounded partial output, real usage and cost, no raw output and no findings', async () => {
      const { app, llm, pr, agent, service } = await setup();
      const a = await agent();
      await linkApprovedSkill(app, a.id);
      llm.steps = ['truncate'];
      const { runs } = await service.runReview(workspaceId, pr.id, [a]);
      const runId = runs[0]!.run_id;
      const { run, trace } = await settled(runId);
      expect(run).toMatchObject({ status: 'failed', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278, findingsCount: 0 });
      expect(trace.stats).toMatchObject({ tokens_in: run.tokensIn, tokens_out: run.tokensOut, cost_usd: run.costUsd, usage_state: 'measured' });
      expect(trace.dispatch).toEqual({ state: 'dispatched' });
      expect(trace.prompt_assembly_source).toBe('dispatched_request');
      expect(trace.prompt_assembly.system).toContain('Synthetic reviewer.');
      expect(trace.prompt_assembly.skills).toMatch(/<untrusted source="skill-0">\n### Synthetic rule/);
      expect(trace.prompt_assembly.user).toContain('retries: 3');
      expect(trace.partial_output).toEqual({
        kind: 'truncated',
        stage_id: 'single-0',
        text: TRUNCATED_OUTPUT,
        provider_incomplete: true,
        finish_reason: 'length',
        response_id: 'gen-1793471676-synthetic0002',
        total_bytes: Buffer.byteLength(TRUNCATED_OUTPUT),
        sha256: sha(TRUNCATED_OUTPUT),
      });
      expect(trace.raw_output).toBe('');
      expect(await reviewsFor(runId)).toHaveLength(0);
      expect(trace.stages![0]!.attempts[0]).toMatchObject({ phase: 'response_received', failure: 'truncated', finish_reason: 'length' });
      // Private: the partial text and the prompt never reach the live stream or the stored log.
      const streamed = JSON.stringify(app.container.runBus.buffer(runId));
      for (const text of [streamed, JSON.stringify(trace.log)]) {
        expect(text).not.toContain('mid-sente');
        expect(text).not.toContain('Check the synthetic rule');
      }
      await app.close();
    });
  });

  describe('case 4: provider error after dispatch', () => {
    it('a 429: the real assembly, unknown usage stays null (row and trace), one request, no retry added', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['http-429'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(llm.structuredCalls).toBe(1);
      expect(run).toMatchObject({ status: 'failed', tokensIn: null, tokensOut: null, costUsd: null, error: '429 Provider returned error' });
      expect(trace.stats).toMatchObject({ tokens_in: null, tokens_out: null, cost_usd: null, usage_state: 'unknown' });
      expect(trace).toMatchObject({ dispatch: { state: 'dispatched' }, prompt_assembly_source: 'dispatched_request', partial_output: null });
      expect(trace.prompt_assembly.user).toContain('retries: 3');
      expect(trace.stages![0]!.attempts).toEqual([
        expect.objectContaining({ attempt: 1, phase: 'submitted', failure: 'http_error', http_status: 429, usage: null }),
      ]);
      await app.close();
    });

    it('map-reduce: a chunk failing after one completed chunk keeps the completed usage and the ordered stages', async () => {
      const { app, llm, pr, agent, service } = await setup({ diff: TWO_FILES });
      llm.steps = ['ok', 'truncate'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent({ strategy: 'map-reduce' })]);
      const { run, trace } = await settled(runs[0]!.run_id);
      // Chunk 1 (100/50/0.0001) plus the failing chunk's reported usage, counted once.
      expect(run).toMatchObject({ status: 'failed', tokensIn: 1242, tokensOut: 4050 });
      expect(run.costUsd).toBeCloseTo(0.00092278, 10);
      expect(trace.stats).toMatchObject({ tokens_in: 1242, tokens_out: 4050, cost_usd: run.costUsd, usage_state: 'measured' });
      expect(trace.stages!.map((s) => [s.stage_id, s.label, s.state, s.usage.tokens_in])).toEqual([
        ['map-0', 'src/a.ts', 'completed', 100],
        ['map-1', 'src/b.ts', 'failed', 1142],
      ]);
      // The top-level prompt is the failing chunk's; the completed chunk's distinct prompt is stored on its stage.
      expect(trace.prompt_assembly.user).toContain('export const b');
      expect(trace.prompt_assembly.user).not.toContain('export const a');
      expect(trace.stages![1]!.assembly).toBeUndefined();
      expect(trace.stages![0]!.assembly!.user).toContain('export const a');
      expect(trace.partial_output?.stage_id).toBe('map-1');

      // A 429 on chunk 2: chunk 1's usage survives in stages[], the run totals are unknown, never a partial zero.
      llm.steps = ['ok', 'http-429'];
      const second = await service.runReview(workspaceId, pr.id, [await agent({ strategy: 'map-reduce' })]);
      const unknown = await settled(second.runs[0]!.run_id);
      expect(unknown.run).toMatchObject({ tokensIn: null, tokensOut: null, costUsd: null });
      expect(unknown.trace.stages!.map((s) => [s.state, s.usage_state, s.usage.tokens_in])).toEqual([
        ['completed', 'measured', 100],
        ['failed', 'unknown', null],
      ]);
      await app.close();
    });
  });

  describe('case 5: cancellation', () => {
    it('before dispatch: not_dispatched, no stage; after dispatch: dispatched with the attempt evidence; the cancelled status stands', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['hold'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent(), await agent()]);
      const [first, second] = runs.map((r) => r.run_id);
      await llm.started.promise; // the first run's request is in flight; the second waits behind it
      await app.inject({ method: 'POST', url: `/runs/${first}/cancel` });
      await app.inject({ method: 'POST', url: `/runs/${second}/cancel` });
      llm.gate.resolve();

      const after = await settled(first!);
      const before = await settled(second!);
      await vi.waitFor(async () => {
        const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, second!));
        expect((row?.trace as RunTrace | undefined)?.dispatch).toBeDefined();
      });
      const beforeTrace = (await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, second!)))[0]!.trace as RunTrace;
      const afterTrace = await vi.waitFor(async () => {
        const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, first!));
        const trace = row?.trace as RunTrace | undefined;
        if (!trace?.dispatch) throw new Error('not yet');
        return trace;
      });

      expect(before.run.status).toBe('cancelled');
      expect(beforeTrace).toMatchObject({ dispatch: { state: 'not_dispatched' }, prompt_assembly_source: 'agent_config', stages: [], stats: { usage_state: 'none' } });
      expect(beforeTrace.dispatch?.refusal).toBeUndefined();

      expect(after.run.status).toBe('cancelled');
      expect(await reviewsFor(first!)).toHaveLength(0);
      expect(afterTrace).toMatchObject({ dispatch: { state: 'dispatched' }, prompt_assembly_source: 'dispatched_request' });
      expect(afterTrace.stages![0]!.attempts[0]).toMatchObject({ phase: 'response_received', response_id: 'gen-ok-1' });
      expect(llm.structuredCalls).toBe(1);
      // The API cancel wrote the status only; the row's usage now equals the trace's (same totals), status untouched.
      const rows = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, first!));
      expect(rows[0]).toMatchObject({ status: 'cancelled', tokensIn: afterTrace.stats.tokens_in, tokensOut: afterTrace.stats.tokens_out, costUsd: afterTrace.stats.cost_usd });
      expect(afterTrace.stats).toMatchObject({ tokens_in: 100, tokens_out: 50, cost_usd: 0.0001, usage_state: 'measured' });
      const beforeRow = (await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, second!)))[0]!;
      expect(beforeRow).toMatchObject({ status: 'cancelled', tokensIn: beforeTrace.stats.tokens_in, tokensOut: beforeTrace.stats.tokens_out, costUsd: beforeTrace.stats.cost_usd ?? null });
      await app.close();
    });
  });

  describe('crash-consistent persistence and the reaper', () => {
    it('a trace-save failure inside the transaction rolls back the terminal status (the minimal retry failing too); the reaper then reports missing evidence', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['http-429'];
      const spy = vi.spyOn(ReviewRepository.prototype, 'saveRunTraceIn').mockRejectedValue(new Error('injected trace write failure'));
      let runId: string;
      try {
        ({ runs: [{ run_id: runId }] } = (await service.runReview(workspaceId, pr.id, [await agent()])) as { runs: [{ run_id: string }] });
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        // Let the rolled-back transactions and the executor's catch finish.
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2)); // the full trace, then the minimal retry
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        spy.mockRestore();
      }
      const [stuck] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId!));
      expect(stuck!.status).toBe('running'); // rolled back with the trace
      expect(await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId!))).toHaveLength(0);

      expect(await service.reapStaleRuns()).toBeGreaterThanOrEqual(1);
      const { run, trace } = await settled(runId!);
      expect(run).toMatchObject({ status: 'failed', tokensIn: null, tokensOut: null, costUsd: null });
      expect(trace.persistence).toMatchObject({ state: 'reaped', note: REAPED_NOTE });
      expect(trace).toMatchObject({ prompt_assembly_source: 'unrecorded', stats: { tokens_in: null, usage_state: 'unknown' } });
      expect(trace.prompt_assembly).toMatchObject({ system: '', user: '', skills: null });
      expect(promptEvidence(trace)).toBe('unrecorded');
      // The row recorded no duration: 0 is a placeholder, flagged as not known.
      expect(trace.stats).toMatchObject({ duration_ms: 0, duration_known: false });
      await app.close();
    });

    it('the reaper keeps a partial trace and the persisted usage, and never overwrites them with zeros', async () => {
      const { app, pr, agent } = await setup();
      const a = await agent();
      const [row] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId: a.id, prId: pr.id, provider: 'openai', model: 'gpt-4.1', status: 'running', source: 'local', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 })
        .returning();
      // A pre-dispatch checkpoint trace (as an experiment slot writes before its request).
      const checkpoint: RunTrace = {
        config: { agent: a.name, model: 'gpt-4.1', source: 'local' },
        stats: { duration_ms: 12, tokens_in: 0, tokens_out: 0, cost_usd: 0, findings: 0, grounding: '0/0 passed', usage_state: 'none' },
        prompt_assembly: { system: 'Synthetic reviewer.', skills: null, memory: null, specs: null, user: '' },
        prompt_assembly_source: 'agent_config',
        dispatch: { state: 'not_dispatched' },
        stages: [],
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [{ t: '00.01', kind: 'info', msg: 'Experiment slot x: checks passed, dispatching one request' }],
      };
      await pg.handle.db.insert(t.runTraces).values({ runId: row!.id, trace: checkpoint });

      await new ReviewService(app.container).reapStaleRuns();
      const { run, trace } = await settled(row!.id);
      expect(run).toMatchObject({ status: 'failed', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 });
      expect(trace.log).toEqual(checkpoint.log);
      expect(trace.dispatch).toBeUndefined(); // whether it dispatched after the checkpoint is unknown
      expect(trace).toMatchObject({
        prompt_assembly_source: 'unrecorded',
        persistence: { state: 'reaped' },
        stats: { tokens_in: 1142, tokens_out: 4000, cost_usd: 0.00082278, usage_state: 'measured' },
      });
      await app.close();
    });
  });

  describe('text Postgres rejects, retries and bounds', () => {
    it('a NUL in the partial output: the run still fails terminally, the text is stored with U+FFFD, the hash is of the original', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['truncate-nul'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run.status).toBe('failed');
      expect(trace.partial_output!.text).toContain('before\uFFFDafter \uFFFD end');
      expect(trace.partial_output!.text).not.toContain('\u0000');
      expect(trace.partial_output!.sha256).toBe(sha(`${TRUNCATED_OUTPUT}${NUL_TEXT}`));
      await app.close();
    });

    it('a NUL in the prompt (the diff): the failure trace persists with the prompt made storable', async () => {
      const { app, llm, pr, agent, service } = await setup({ diff: ONE_FILE.replace('retries: 3,', `retries: 3, // ${NUL_TEXT}`) });
      llm.steps = ['http-429'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run.status).toBe('failed');
      expect(trace.prompt_assembly_source).toBe('dispatched_request');
      expect(trace.prompt_assembly.user).toContain('before\uFFFDafter');
      await app.close();
    });

    it('a NUL in raw_output and the review text: a billed success stays a success', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['ok-nul'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const runId = runs[0]!.run_id;
      const { run, trace } = await settled(runId);
      expect(run).toMatchObject({ status: 'done', tokensIn: 100, costUsd: 0.0001 });
      expect(trace.raw_output).toContain('\uFFFD');
      expect(trace.raw_output).not.toContain('\u0000');
      const [review] = await reviewsFor(runId);
      expect(review!.summary).toContain('before\uFFFDafter');
      await app.close();
    });

    it('when the full failure trace cannot be written, one retry writes a minimal labelled trace and the row reaches its terminal state', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['truncate'];
      const spy = vi.spyOn(ReviewRepository.prototype, 'saveRunTraceIn').mockRejectedValueOnce(new Error('injected trace write failure'));
      try {
        const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
        const { run, trace } = await settled(runs[0]!.run_id);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(run).toMatchObject({ status: 'failed', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 });
        expect(trace).toMatchObject({
          persistence: { state: 'fallback' },
          prompt_assembly_source: 'unrecorded',
          dispatch: { state: 'dispatched' },
          stages: [],
          partial_output: null,
          log: [],
          stats: { tokens_in: 1142, tokens_out: 4000, cost_usd: 0.00082278, usage_state: 'measured' },
        });
        expect(trace.prompt_assembly).toMatchObject({ system: '', user: '' });
      } finally {
        spy.mockRestore();
      }
      await app.close();
    });

    it('a success whose response omitted its token counts is unknown usage (null), not a measured 0', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['ok-no-usage'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run).toMatchObject({ status: 'done', tokensIn: null, tokensOut: null, costUsd: null });
      expect(trace.stats).toMatchObject({ tokens_in: null, tokens_out: null, cost_usd: null, usage_state: 'unknown' });
      expect(trace.stages![0]!.usage_state).toBe('unknown');
      await app.close();
    });

    it('a top-level prompt over the bound is cut, keeps the full hash and byte count, and the stage copy is not duplicated', async () => {
      const big = Array.from({ length: 6000 }, (_, i) => `+  line${i}: '${'x'.repeat(40)}',`).join('\n');
      const diff = `diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts\n+++ b/src/big.ts\n@@ -0,0 +1,6000 @@\n${big}`;
      const { app, pr, agent, service } = await setup({ diff });
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent({ strategy: 'single-pass' })]);
      const { run, trace } = await settled(runs[0]!.run_id);
      expect(run.status).toBe('done');
      expect(trace.prompt_assembly_complete).toBe(false);
      expect(trace.prompt_assembly_bytes!).toBeGreaterThan(TOP_ASSEMBLY_MAX_BYTES);
      expect(assemblyDigest(trace.prompt_assembly).bytes).toBeLessThanOrEqual(TOP_ASSEMBLY_MAX_BYTES);
      expect(trace.prompt_assembly_sha256).not.toBe(assemblyDigest(trace.prompt_assembly).sha256); // the hash is of the full text
      expect(trace.stages![0]).toMatchObject({ assembly_sha256: trace.prompt_assembly_sha256, assembly_bytes: trace.prompt_assembly_bytes, assembly_complete: false });
      expect(trace.stages![0]!.assembly).toBeUndefined();
      await app.close();
    });

    it('map-reduce and single-pass successes are distinguishable: whole_diff versus single_stage', async () => {
      const { app, pr, agent, service } = await setup({ diff: TWO_FILES });
      const single = await service.runReview(workspaceId, pr.id, [await agent({ strategy: 'single-pass' })]);
      const map = await service.runReview(workspaceId, pr.id, [await agent({ strategy: 'map-reduce' })]);
      const s1 = (await settled(single.runs[0]!.run_id)).trace;
      const m1 = (await settled(map.runs[0]!.run_id)).trace;
      expect(s1.prompt_assembly_scope).toBe('single_stage');
      expect(m1.prompt_assembly_scope).toBe('whole_diff');
      expect(promptEvidence(s1)).toBe('dispatched_request');
      expect(promptEvidence(m1)).toBe('dispatched_request_whole_diff');
      expect(m1.stages!.every((st) => st.assembly && st.assembly_complete)).toBe(true); // each chunk's prompt is stored
      await app.close();
    });
  });

  describe('terminal writes never overwrite another terminal trace; the reaper covers cancelled runs', () => {
    it('a CAS miss on a non-cancelled terminal row (e.g. reaped) writes no trace', async () => {
      const { app, pr, agent } = await setup();
      const a = await agent();
      const [row] = await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: a.id, prId: pr.id, status: 'failed', source: 'local' }).returning();
      const reaped = { config: { agent: a.name, model: 'gpt-4.1', source: 'local' }, stats: { duration_ms: 0, tokens_in: null, tokens_out: null, cost_usd: null, findings: 0, grounding: '0/0 passed', usage_state: 'unknown' }, prompt_assembly: { system: '', user: '' }, prompt_assembly_source: 'unrecorded', tool_calls: [], raw_output: '', memory_pulled: [], specs_read: [], log: [], persistence: { state: 'reaped', at: '2026-11-01T00:00:00.000Z', note: REAPED_NOTE } } as RunTrace;
      await pg.handle.db.insert(t.runTraces).values({ runId: row!.id, trace: reaped });
      const repo = new ReviewRepository(pg.handle.db);
      const late = { ...reaped, persistence: undefined, prompt_assembly_source: 'dispatched_request' as const, prompt_assembly: { system: 'late', user: 'late' } };
      const result = await repo.finalizeRunFailure({ runId: row!.id, completion: { status: 'failed', durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 1, findingsCount: 0, grounding: '0/0 passed', error: 'late' }, trace: late });
      expect(result).toEqual({ applied: false, traceWritten: false });
      const [stored] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, row!.id));
      expect(stored!.trace).toEqual(reaped);
      const [after] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, row!.id));
      expect(after).toMatchObject({ status: 'failed', tokensIn: null, costUsd: null, error: null });
      await app.close();
    });

    it('a cancelled run with known usage keeps it; the guarded fill never overwrites', async () => {
      const { app, pr, agent } = await setup();
      const a = await agent();
      const [row] = await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: a.id, prId: pr.id, status: 'cancelled', source: 'local', tokensIn: 5, tokensOut: 6, costUsd: 0.5 }).returning();
      const repo = new ReviewRepository(pg.handle.db);
      const trace = { config: { agent: a.name, model: 'm', source: 'local' }, stats: { duration_ms: 1, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding: '0/0 passed' }, prompt_assembly: { system: 's', user: '' }, tool_calls: [], raw_output: '', memory_pulled: [], specs_read: [], log: [] } as RunTrace;
      expect(await repo.finalizeRunFailure({ runId: row!.id, completion: { status: 'cancelled', durationMs: 1, tokensIn: 0, tokensOut: 0, costUsd: null, findingsCount: 0, grounding: '0/0 passed' }, trace })).toEqual({ applied: false, traceWritten: true });
      const [after] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, row!.id));
      expect(after).toMatchObject({ status: 'cancelled', tokensIn: 5, tokensOut: 6, costUsd: 0.5 });
      await app.close();
    });

    it('the reaper gives a cancelled run with no trace a minimal labelled one, and leaves a cancelled run that has a trace alone', async () => {
      const { app, pr, agent } = await setup();
      const a = await agent();
      const [bare] = await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: a.id, prId: pr.id, provider: 'openai', model: 'gpt-4.1', status: 'cancelled', source: 'local' }).returning();
      const [traced] = await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: a.id, prId: pr.id, status: 'cancelled', source: 'local' }).returning();
      const own = { config: { agent: a.name, model: 'gpt-4.1', source: 'local' }, stats: { duration_ms: 1, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding: '0/0 passed', usage_state: 'none' }, prompt_assembly: { system: 'Synthetic reviewer.', user: '' }, prompt_assembly_source: 'agent_config', tool_calls: [], raw_output: '', memory_pulled: [], specs_read: [], log: [] } as RunTrace;
      await pg.handle.db.insert(t.runTraces).values({ runId: traced!.id, trace: own });

      await new ReviewService(app.container).reapStaleRuns();
      const [bareTrace] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, bare!.id));
      expect(bareTrace!.trace).toMatchObject({
        persistence: { state: 'reaped', note: REAPED_CANCELLED_NOTE },
        prompt_assembly_source: 'unrecorded',
        prompt_assembly: { system: '', user: '', skills: null },
        stats: { tokens_in: null, tokens_out: null, cost_usd: null, usage_state: 'unknown', duration_ms: 0, duration_known: false },
        config: { agent: a.name, model: 'gpt-4.1' },
      });
      expect((bareTrace!.trace as RunTrace).dispatch).toBeUndefined();
      const [bareRow] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, bare!.id));
      expect(bareRow!.status).toBe('cancelled');
      const [ownTrace] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, traced!.id));
      expect(ownTrace!.trace).toEqual(own);
      await app.close();
    });
  });

  describe('error text is sanitized once, before every sink', () => {
    it('a provider error carrying an upstream body: the row, the bus, the logs and the trace get a bounded, redacted message', async () => {
      const { app, llm, pr, agent, service } = await setup();
      llm.steps = ['throw-secret'];
      const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
      const runId = runs[0]!.run_id;
      const { run, trace } = await settled(runId);
      expect(run.status).toBe('failed');
      expect(run.error).toMatch(/^502 upstream said: Authorization: /);
      expect(run.error!.length).toBeLessThanOrEqual(500);
      for (const text of [run.error!, JSON.stringify(trace), JSON.stringify(app.container.runBus.buffer(runId))]) {
        expect(text).not.toContain('sk-or-v1-itestsecret');
        expect(text).not.toContain('\u0000');
        expect(text).not.toContain('q'.repeat(600));
      }
      // Classification reads the error, not its text: still a dispatched failure.
      expect(trace.dispatch).toEqual({ state: 'dispatched' });
      await app.close();
    });

    it('a configured key of any shape is redacted from the row, the bus and the trace; a repo-intel failure line too', async () => {
      const { app, llm, pr, agent, service } = await setup({ secrets: { OPENAI_API_KEY: CONFIGURED_KEY, GITHUB_TOKEN: 'gh-token-shape:abc123456' } });
      llm.steps = ['throw-configured-key'];
      const map = vi.spyOn(app.container.repoIntel, 'getRepoMap').mockRejectedValueOnce(new Error('clone failed for https://x:gh-token-shape:abc123456@github.com/acme/r'));
      try {
        const { runs } = await service.runReview(workspaceId, pr.id, [await agent({ repo_intel: true })]);
        const runId = runs[0]!.run_id;
        const { run, trace } = await settled(runId);
        expect(run.error).toMatch(/^401 Incorrect API key provided: /);
        expect(trace.log.some((l) => l.msg.includes('repo map: repoIntel failed — clone failed for https://[redacted]@github.com/acme/r'))).toBe(true);
        for (const text of [run.error!, JSON.stringify(trace), JSON.stringify(app.container.runBus.buffer(runId))]) {
          expect(text).not.toContain(CONFIGURED_KEY);
          expect(text).not.toContain('gh-token-shape:abc123456');
        }
      } finally {
        map.mockRestore();
      }
      await app.close();
    });

    it('a pre-work failure (loading the diff) is sanitized the same way for every queued run', async () => {
      const { app, pr, agent, service } = await setup({ diff: '' });
      const spy = vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockRejectedValueOnce(new Error(SECRET_ERROR));
      try {
        const { runs } = await service.runReview(workspaceId, pr.id, [await agent()]);
        const runId = runs[0]!.run_id;
        const { run, trace } = await settled(runId);
        expect(run.error).toMatch(/^Failed to load PR diff: 502 upstream said/);
        expect(run.error!.length).toBeLessThanOrEqual(530);
        expect(trace.dispatch).toMatchObject({ state: 'not_dispatched', refusal: { code: 'diff_unavailable' } });
        for (const text of [run.error!, JSON.stringify(trace), JSON.stringify(app.container.runBus.buffer(runId))]) {
          expect(text).not.toContain('sk-or-v1-itestsecret');
          expect(text).not.toContain('q'.repeat(600));
        }
      } finally {
        spy.mockRestore();
      }
      await app.close();
    });
  });

  it('legacy traces are classified at read time, never rewritten', async () => {
    const { app, pr, agent } = await setup();
    const a = await agent();
    const legacy = (tool_calls: RunTrace['tool_calls'], user: string): RunTrace => ({
      config: { agent: a.name, model: 'gpt-4.1', source: 'local' },
      stats: { duration_ms: 1, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding: '0/0 passed' },
      prompt_assembly: { system: 'Synthetic reviewer.', skills: null, memory: null, specs: null, user },
      tool_calls,
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    const cases: Array<[RunTrace, string]> = [
      [legacy([{ tool: 'review_file', args: 'all files', meta: 'single-pass', ms: 1 }], 'Synthetic diff'), 'legacy_single_pass'],
      [legacy([{ tool: 'review_file', args: 'src/a.ts', meta: 'map-reduce', ms: 1 }, { tool: 'review_file', args: 'src/b.ts', meta: 'map-reduce', ms: 1 }], 'Whole diff'), 'legacy_map_reduce_whole_diff'],
      [legacy([], ''), 'legacy_failed_fallback'],
    ];
    for (const [trace, expected] of cases) {
      const [row] = await pg.handle.db.insert(t.agentRuns).values({ workspaceId, agentId: a.id, prId: pr.id, status: 'done', source: 'local' }).returning();
      await pg.handle.db.insert(t.runTraces).values({ runId: row!.id, trace });
      const read = (await app.inject({ url: `/runs/${row!.id}/trace` })).json();
      expect(promptEvidence(read)).toBe(expected);
      expect(read).toEqual(trace); // the stored document is unchanged
    }
    await app.close();
  });
});

// ---- HW2 experiment mode: the same lifecycle, the slot view and the report --

const EXPERIMENT_ENV = {
  DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-itrace',
  DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra',
  DEVDIGEST_EXPERIMENT_MODEL: FAKE_MODEL,
  DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '4000',
  DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000014',
  DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000028',
  DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: '0',
};

async function fixtureDiffSha(number: number): Promise<string> {
  const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === number)!;
  const stub = { getPrFiles: async () => fixture.files.map((f) => ({ ...f, ...patchStats(f.patch) })) } as unknown as ReviewRepository;
  return sha256((await diffFromPrFiles(stub, 'fixture')).raw);
}

d('HW2 slot traces, slot view and report (Testcontainers pg, fake provider)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;
  let capHome: string;
  let token = '';
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pr502: string;
  let apiAgent: string;
  let slotSeq = 0;
  const llm = new FakeExperimentProvider();

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db, { experimentFixtures: true }));
    cloneDir = mkdtempSync(join(tmpdir(), 'hw2-trace-clones-'));
    capHome = mkdtempSync(join(tmpdir(), 'hw2-trace-home-'));
    writeCapability({ stackId: 'hw2f-itrace', phase: 'exploration', budgetUsd: 0.5, hours: 2, home: capHome });
    token = readFileSync(join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itrace', 'capability.token'), 'utf8');
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DEVDIGEST_CLONE_DIR: cloneDir,
        ...EXPERIMENT_ENV,
        DEVDIGEST_EXPERIMENT_CAPABILITY_PATH: join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itrace', 'capability.json'),
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: '' }), github: new MockGitHubClient(), llm: { openrouter: llm } },
    });
    const pulls = await pg.handle.db.select().from(t.pullRequests);
    pr502 = pulls.find((p) => p.number === 502)!.id;
    const agents = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    apiAgent = agents.find((a) => a.name === 'API Contract Reviewer')!.id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    rmSync(cloneDir, { recursive: true, force: true });
    rmSync(capHome, { recursive: true, force: true });
  });

  async function start(patch: Record<string, unknown> = {}) {
    const slot = (patch.slot_id as string | undefined) ?? `x-itrace-${++slotSeq}`;
    const response = await app.inject({
      method: 'POST',
      url: '/experiments/runs',
      headers: { 'x-hw2-capability': token },
      payload: {
        pr_id: pr502, agent_id: apiAgent, slot_id: slot, experiment: '18', condition: 'with', manifest_fingerprint: 'a'.repeat(64),
        reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(502), phase: 'exploration', expected_non_skill_fingerprint: null, ...patch,
      },
    });
    expect(response.statusCode).toBe(202);
    return { slot, runId: response.json().run_id as string };
  }
  async function settled(runId: string) {
    return vi.waitFor(
      async () => {
        const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
        const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
        const trace = row?.trace as (RunTrace & { experiment: Record<string, unknown> }) | undefined;
        if (!run || run.status === 'running' || !trace?.experiment || trace.experiment.dispatch_state === 'dispatching') throw new Error('not settled');
        return { run, trace };
      },
      { timeout: 15_000, interval: 100 },
    );
  }
  const slotView = async (slot: string) => (await app.inject({ url: `/experiments/slots/${slot}` })).json().runs[0];

  it('an ExperimentRefusedError and the spend gate are pre-dispatch refusals with their own codes', async () => {
    const before = llm.requests.length;
    const refused = await start({ expected_diff_sha256: 'b'.repeat(64) });
    const r = await settled(refused.runId);
    expect(r.run).toMatchObject({ status: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0 });
    expect(r.trace).toMatchObject({ dispatch: { state: 'not_dispatched', refusal: { code: 'experiment_refused' } }, prompt_assembly_source: 'agent_config', stages: [], stats: { usage_state: 'none' } });

    const ordinary = await app.inject({ method: 'POST', url: `/pulls/${pr502}/review`, payload: { agentId: apiAgent } });
    const runId = ordinary.json().runs[0].run_id as string;
    const trace = await vi.waitFor(async () => {
      const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
      if (!row) throw new Error('not yet');
      return row.trace as RunTrace;
    }, { timeout: 15_000 });
    expect(trace).toMatchObject({ dispatch: { state: 'not_dispatched', refusal: { code: 'experiment_spend_refused' } }, prompt_assembly_source: 'agent_config', stages: [] });
    expect(llm.requests.length).toBe(before);
  });

  it('a 429 after dispatch: unknown usage is null in the row and the trace; the real prompt is kept', async () => {
    llm.mode = 'http-429';
    try {
      const { runId } = await start();
      const { run, trace } = await settled(runId);
      expect(run).toMatchObject({ status: 'failed', tokensIn: null, tokensOut: null, costUsd: null });
      expect(trace.stats).toMatchObject({ tokens_in: null, tokens_out: null, cost_usd: null, usage_state: 'unknown' });
      expect(trace.experiment).toMatchObject({ dispatch_state: 'failed', usage_known: false });
      expect(trace).toMatchObject({ dispatch: { state: 'dispatched' }, prompt_assembly_source: 'dispatched_request' });
      expect(trace.prompt_assembly.skills).toMatch(/<untrusted source="skill-0">/);
    } finally {
      llm.mode = 'ok';
    }
  });

  it('deep provider metadata is depth-bounded in the full trace; the minimal retry carries no raw provider blob', async () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 500; i++) deep = { next: deep };
    llm.routerMetadataRaw = { requested: FAKE_MODEL, deep };
    llm.mode = 'truncate';
    try {
      const full = await start();
      const a = await settled(full.runId);
      expect(a.run.status).toBe('failed');
      const raw = (a.trace.experiment.attempts as Array<Record<string, unknown>>)[0]!.routerMetadataRaw;
      expect(JSON.stringify(raw)).toContain('[omitted: nested too deep]');

      const spy = vi.spyOn(ReviewRepository.prototype, 'saveRunTraceIn').mockRejectedValueOnce(new Error('injected trace write failure'));
      try {
        const retried = await start();
        const b = await settled(retried.runId);
        expect(b.run).toMatchObject({ status: 'failed', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 });
        expect(b.trace.persistence).toMatchObject({ state: 'fallback' });
        const attempt = (b.trace.experiment.attempts as Array<Record<string, unknown>>)[0]!;
        expect(attempt.routerMetadataRaw).toBeNull();
        expect(attempt).toMatchObject({ outcome: 'truncated', tokensIn: 1142, responseId: 'gen-1793471676-synthetic0001' });
        expect(JSON.stringify(b.trace)).not.toContain('"next"');
      } finally {
        spy.mockRestore();
      }
    } finally {
      llm.mode = 'ok';
      llm.routerMetadataRaw = null;
    }
  });

  it('an endpoints-read failure: the refusal reason and the free preview carry sanitized text only; the refusal is unchanged', async () => {
    llm.endpointsError = new Error(`403 for https://u:p4ssw0rd@openrouter.ai/api?key=abc Authorization: Bearer sk-or-v1-itestsecret0123456789 \u0000${'w'.repeat(2000)}`);
    try {
      const { runId } = await start();
      const { run, trace } = await settled(runId);
      expect(run).toMatchObject({ status: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0 });
      expect(trace.experiment).toMatchObject({ dispatch_state: 'refused' });
      expect(trace.experiment.refusal_reason as string).toMatch(/^live endpoint prices unavailable: 403 /);
      const preview = (await app.inject({
        method: 'POST',
        url: '/experiments/preview',
        payload: { pr_id: pr502, agent_id: apiAgent, experiment: '18', condition: 'with', phase: 'exploration', reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(502) },
      })).json();
      expect(preview.ok).toBe(false);
      expect(preview.reason).toMatch(/^live endpoint prices unavailable: 403 /);
      for (const text of [JSON.stringify(trace), run.error!, JSON.stringify(preview)]) {
        for (const leak of ['p4ssw0rd', 'sk-or-v1-itestsecret', 'key=abc', '\u0000', 'w'.repeat(600)]) expect(text).not.toContain(leak);
      }
    } finally {
      llm.endpointsError = null;
    }
  });

  it('the slot view does not present a cut prompt\'s Skills section as sent', async () => {
    const slot = 'x-itrace-cut';
    const [cut] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: apiAgent, prId: pr502, provider: 'openrouter', model: FAKE_MODEL, status: 'failed', source: 'local' })
      .returning();
    await pg.handle.db.insert(t.runTraces).values({
      runId: cut!.id,
      trace: {
        config: { agent: 'API Contract Reviewer', model: FAKE_MODEL, pr: 502, source: 'local' },
        stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: 0, findings: 0, grounding: '0/0 passed', usage_state: 'measured' },
        prompt_assembly: { system: 's', skills: '<untrusted source="skill-0">\n### breaking-change\ncut here', user: '' },
        prompt_assembly_source: 'dispatched_request',
        prompt_assembly_complete: false,
        prompt_assembly_scope: 'single_stage',
        tool_calls: [], raw_output: '', memory_pulled: [], specs_read: [], log: [],
        experiment: { slot_id: slot, experiment: '18', condition: 'with' },
      },
    });
    const view = await slotView(slot);
    expect(view).toMatchObject({ prompt_evidence: 'dispatched_request_incomplete', skills_block: null, skills_block_complete: false });
    const run: SlotRunData = { run_id: view.run_id, cost_usd: view.cost_usd, experiment: view.experiment, config: view.config, skills_block: view.skills_block, prompt_evidence: view.prompt_evidence, findings: [] };
    expect(promptIssues(run)).toEqual(['prompt recorded only in part (cut at the trace size bound)']);
    expect(executionIssues({ slot_id: slot, experiment: '18', condition: 'with' }, run, {
      manifestFingerprint: 'a'.repeat(64), phase: 'exploration', fixture: () => ({ reviewer: 'API Contract Reviewer', prNumber: 502, targetSkill: 'breaking-change' }), skillFingerprint: () => 'x',
    }).join(' ')).not.toMatch(/skill\(s\)|skills instead/);
    // A complete trace still presents its Skills section.
    const fresh = await slotView((await (async () => { const r = await start(); await settled(r.runId); return r; })()).slot);
    expect(fresh).toMatchObject({ prompt_evidence: 'dispatched_request', skills_block_complete: true });
    expect(fresh.skills_block).toMatch(/<untrusted source="skill-0">/);
  });

  it('report and slot view: a new failed with-slot counts its 1 Skill; a legacy failure trace reads "prompt not recorded"', async () => {
    const links = (await app.inject({ url: `/agents/${apiAgent}/skills` })).json() as Array<{ skill_id: string; skill: { name: string } }>;
    const target = links.find((l) => l.skill.name === 'breaking-change')!.skill_id;
    await app.inject({ method: 'POST', url: `/agents/${apiAgent}/skills`, payload: { skill_ids: [target] } });
    llm.mode = 'truncate';
    let fresh: { slot: string; runId: string };
    let settledRun: Awaited<ReturnType<typeof settled>>;
    try {
      fresh = await start();
      settledRun = await settled(fresh.runId);
    } finally {
      llm.mode = 'ok';
    }
    const { run, trace } = settledRun;
    await app.inject({ method: 'POST', url: `/agents/${apiAgent}/skills`, payload: { skill_ids: links.map((l) => l.skill_id) } });

    // The truncated slot, as v3's c-17-with-2 should have been recorded.
    expect(run).toMatchObject({ status: 'failed', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 });
    expect(trace.stats).toMatchObject({ tokens_in: 1142, tokens_out: 4000, cost_usd: 0.00082278, usage_state: 'measured' });
    expect(trace.experiment).toMatchObject({ dispatch_state: 'failed', usage_known: true });
    expect(trace.partial_output).toMatchObject({ kind: 'truncated', finish_reason: 'length', text: TRUNCATED_OUTPUT });
    expect(trace.raw_output).toBe('');

    // A legacy failure trace for another with-slot: the shape every failure path wrote before.
    const legacySlot = 'x-itrace-legacy';
    const [agentRow] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, apiAgent));
    const [legacyRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: apiAgent, prId: pr502, provider: 'openrouter', model: FAKE_MODEL, status: 'failed', source: 'local', tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 })
      .returning();
    await pg.handle.db.insert(t.runTraces).values({
      runId: legacyRun!.id,
      trace: {
        config: trace.config,
        stats: { duration_ms: 106577, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding: '0/0 passed' },
        prompt_assembly: { system: agentRow!.systemPrompt, skills: null, memory: null, specs: null, user: '' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
        experiment: { ...trace.experiment, slot_id: legacySlot },
      },
    });

    const freshView = await slotView(fresh.slot);
    const legacyView = await slotView(legacySlot);
    expect(freshView.prompt_evidence).toBe('dispatched_request');
    expect(legacyView.prompt_evidence).toBe('legacy_failed_fallback');

    const asRun = (view: typeof freshView): SlotRunData => ({
      run_id: view.run_id, cost_usd: view.cost_usd, experiment: view.experiment, config: view.config, skills_block: view.skills_block, prompt_evidence: view.prompt_evidence, findings: [],
    });
    const skillFingerprint = trace.experiment.skill_fingerprint as string;
    const execution = {
      manifestFingerprint: 'a'.repeat(64),
      phase: 'exploration' as const,
      fixture: () => ({ reviewer: 'API Contract Reviewer', prNumber: 502, targetSkill: 'breaking-change' }),
      skillFingerprint: () => skillFingerprint,
    };
    const freshSlot = { slot_id: fresh.slot, experiment: '18', condition: 'with' as const };
    const legacySlotRow = { slot_id: legacySlot, experiment: '18', condition: 'with' as const };
    expect(executionIssues(freshSlot, asRun(freshView), execution)).toEqual([]); // exactly the 1 target Skill was sent
    expect(promptIssues(asRun(freshView))).toEqual([]);
    expect(executionIssues(legacySlotRow, asRun(legacyView), execution).join(' ')).not.toMatch(/sent 0 skills/);
    expect(promptIssues(asRun(legacyView))).toEqual(['prompt not recorded (legacy failure trace)']);

    const report = buildReport({
      schedule: [freshSlot, legacySlotRow],
      ledger: new Map(),
      runs: new Map([[fresh.slot, asRun(freshView)], [legacySlot, asRun(legacyView)]]),
      rules: {},
      frozenNonSkill: { '18': trace.experiment.non_skill_fingerprint as string },
      expectations: () => ({ providerName: 'DeepInfra', model: FAKE_MODEL, servedModel: FAKE_MODEL, expectedDiffSha256: trace.experiment.diff_sha256 as string }),
      execution,
    });
    const [freshRow, legacyRow] = report.rows;
    expect(freshRow).toMatchObject({ counted: false, execution_issues: [], prompt_issues: [] });
    expect(legacyRow).toMatchObject({ counted: false, execution_issues: [], prompt_issues: ['prompt not recorded (legacy failure trace)'] });
    // Missing evidence keeps the slot uncounted without marking the experiment invalid.
    expect(report.summaries[0]).toMatchObject({ outcome: 'incomplete' });
    const rendered = renderReport(report);
    expect(rendered).toContain('prompt not recorded (legacy failure trace)');
    expect(rendered).not.toMatch(/sent 0 skills/);
  });
});
