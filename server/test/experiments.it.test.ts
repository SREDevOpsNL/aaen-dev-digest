import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  LLMProvider,
  ModelInfo,
  OpenRouterEndpointInfo,
  StructuredAttemptTelemetry,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import { EXPERIMENT_FIXTURES, patchStats } from '../src/db/seed-fixtures.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import { canonicalJson, sha256 } from '../src/modules/_shared/experiment.js';
import { expectedSkillFingerprint, writeCapability } from '../src/experiments/hw2/cli.js';
import { evaluateSlot } from '../src/experiments/hw2/eligibility.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[experiments] Docker not available — skipping integration tests.');

const MODEL = 'deepseek/deepseek-v4-flash';
const ENDPOINT: OpenRouterEndpointInfo = {
  providerName: 'DeepInfra',
  tag: 'deepinfra',
  quantization: 'fp8',
  contextLength: 128_000,
  maxCompletionTokens: 16_384,
  pricing: { prompt: 0.00000014, completion: 0.00000028, request: 0 },
};

/** Stands in for OpenRouter: reports one attempt the way the real provider does, and costs nothing. */
class FakeExperimentProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  requests: StructuredRequest<unknown>[] = [];
  mode: 'ok' | 'fail-after-dispatch' | 'hold' = 'ok';
  private release?: () => void;
  held = new Promise<void>((resolve) => (this.release = resolve));
  endpoints: OpenRouterEndpointInfo[] = [ENDPOINT];

  releaseHeld() {
    this.release?.();
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async listEndpoints(): Promise<OpenRouterEndpointInfo[]> {
    return this.endpoints;
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    if (this.mode === 'hold') await this.held;
    const attempt: StructuredAttemptTelemetry = {
      sequence: 1,
      dispatch: 'dispatched',
      outcome: this.mode === 'fail-after-dispatch' ? 'network_error' : 'valid',
      failureReason: this.mode === 'fail-after-dispatch' ? 'socket hang up' : null,
      httpStatus: this.mode === 'fail-after-dispatch' ? null : 200,
      startedAt: new Date().toISOString(),
      durationMs: 5,
      requested: { model: req.model, routing: req.experiment?.routing ?? null, maxTokens: req.experiment?.maxTokens ?? null },
      responseId: 'gen-test',
      generationIdHeader: null,
      servedModel: MODEL,
      finishReason: 'stop',
      tokensIn: this.mode === 'fail-after-dispatch' ? null : 900,
      tokensOut: this.mode === 'fail-after-dispatch' ? null : 120,
      costUsd: this.mode === 'fail-after-dispatch' ? null : 0.0002,
      router: { selected: [{ provider: 'DeepInfra', model: MODEL }], attempt: 1, attemptsCount: 1, requested: MODEL, strategy: 'direct' },
      generation: null,
      routerMetadataRaw: null,
      errorDetail: null,
    };
    req.onAttempt?.(attempt);
    if (this.mode === 'fail-after-dispatch') throw new Error('socket hang up');
    return {
      data: { verdict: 'approve', summary: 'ok', score: 100, findings: [] } as T,
      model: req.model,
      tokensIn: 900,
      tokensOut: 120,
      providerCostUsd: 0.0002,
      costUsd: 0.0002,
      raw: '{}',
      attempts: 1,
    };
  }
}

const EXPERIMENT_ENV = {
  DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-itest1',
  DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra',
  DEVDIGEST_EXPERIMENT_MODEL: MODEL,
  DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '4000',
  DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000014',
  DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000028',
  DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: '0',
};

/** sha256 of the diff a review of `number` loads from its stored patches. */
async function fixtureDiffSha(number: number): Promise<string> {
  const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === number)!;
  const stub = { getPrFiles: async () => fixture.files.map((f) => ({ ...f, ...patchStats(f.patch) })) } as unknown as ReviewRepository;
  return sha256((await diffFromPrFiles(stub, 'fixture')).raw);
}

d('HW2 experiment mode (disposable devdigest_test database, fake provider)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;
  let capHome: string;
  let token = '';
  /** Write the operator's capability for a phase (what `cli.ts authorize` does after a gate is authorized). */
  const authorize = (phase: 'exploration' | 'confirmatory', budgetUsd = phase === 'exploration' ? 0.5 : 1, hours = 2) => {
    // An authorize never replaces a capability: revoke the previous one and drop its token first, as the operator does.
    for (const f of ['capability.json', 'capability.token']) rmSync(join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itest1', f), { force: true });
    writeCapability({ stackId: 'hw2f-itest1', phase, budgetUsd, hours, home: capHome });
    token = readFileSync(join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itest1', 'capability.token'), 'utf8');
  };
  const llm = new FakeExperimentProvider();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pr502: string;
  let pr501: string;
  let apiAgent: string;
  let tqrAgent: string;
  let slotSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db, { experimentFixtures: true }));
    cloneDir = mkdtempSync(join(tmpdir(), 'hw2f-clones-'));
    capHome = mkdtempSync(join(tmpdir(), 'hw2f-home-'));
    const capabilityPath = join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itest1', 'capability.json');
    authorize('exploration');
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DEVDIGEST_CLONE_DIR: cloneDir,
        ...EXPERIMENT_ENV,
        DEVDIGEST_EXPERIMENT_CAPABILITY_PATH: capabilityPath,
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      // No git diff: like the disposable stack (no clone), the review uses the stored patches.
      overrides: { git: new MockGitClient({ diff: '' }), github: new MockGitHubClient(), llm: { openrouter: llm } },
    });
    const pulls = await pg.handle.db.select().from(t.pullRequests);
    pr501 = pulls.find((p) => p.number === 501)!.id;
    pr502 = pulls.find((p) => p.number === 502)!.id;
    const agents = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    apiAgent = agents.find((a) => a.name === 'API Contract Reviewer')!.id;
    tqrAgent = agents.find((a) => a.name === 'Test Quality Reviewer')!.id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    rmSync(cloneDir, { recursive: true, force: true });
    rmSync(capHome, { recursive: true, force: true });
  });

  const nextSlot = (phase: 'x' | 'c' = 'x') => `${phase}-itest-${++slotSeq}`;
  async function start(patch: Record<string, unknown> = {}, headers: Record<string, string> | null = null) {
    return app.inject({
      method: 'POST',
      url: '/experiments/runs',
      headers: headers ?? { 'x-hw2-capability': token },
      payload: {
        pr_id: pr502,
        agent_id: apiAgent,
        slot_id: nextSlot(),
        experiment: '18',
        condition: 'with',
        manifest_fingerprint: 'a'.repeat(64),
        reservation_usd: 0.05,
        expected_diff_sha256: await fixtureDiffSha(502),
        phase: 'exploration',
        expected_non_skill_fingerprint: null,
        ...patch,
      },
    });
  }
  /** The final trace: the preliminary one is written before dispatch, so wait past `dispatching`. */
  async function settledTrace(runId: string) {
    return vi.waitFor(
      async () => {
        const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
        const response = await app.inject({ url: `/runs/${runId}/trace` });
        const trace = response.statusCode === 200 ? response.json() : null;
        if (!run || run.status === 'running' || !trace?.experiment || trace.experiment.dispatch_state === 'dispatching') {
          throw new Error('not settled');
        }
        return { run, trace };
      },
      { timeout: 15_000, interval: 100 },
    );
  }
  const modelCalls = () => llm.requests.length;

  it('is invisible without an experiment configuration, where providers are not wrapped', async () => {
    const plainLlm = new FakeExperimentProvider();
    const plain = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), llm: { openrouter: plainLlm } },
    });
    expect(await plain.container.llm('openrouter')).toBe(plainLlm); // normal mode: unchanged
    expect((await plain.inject({ url: '/experiments/identity' })).statusCode).toBe(404);
    expect((await plain.inject({ method: 'POST', url: '/experiments/runs', payload: { nonsense: true } })).statusCode).toBe(404);
    await plain.close();
  });

  it('never falls back to an environment OpenRouter key', async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-env-everyday-key';
    try {
      const fresh = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test', DEVDIGEST_CLONE_DIR: cloneDir, ...EXPERIMENT_ENV } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: { git: new MockGitClient({ diff: '' }), github: new MockGitHubClient() },
      });
      expect(await fresh.container.secrets.get('OPENROUTER_API_KEY')).not.toBe('sk-env-everyday-key');
      await fresh.close();
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
  });

  it('rejects a partial experiment configuration at startup', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-abcd' } as NodeJS.ProcessEnv)).toThrow(/Partial experiment configuration/);
  });

  it('refuses an ordinary review in experiment mode without reaching the provider', async () => {
    const before = modelCalls();
    const response = await app.inject({ method: 'POST', url: `/pulls/${pr502}/review`, payload: { agentId: apiAgent } });
    expect(response.statusCode).toBe(200);
    const runId = response.json().runs[0].run_id as string;
    const run = await vi.waitFor(
      async () => {
        const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
        if (!row || row.status === 'running') throw new Error('not settled');
        return row;
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/Refused in experiment mode: an ordinary structured call/);
    expect(modelCalls()).toBe(before);
  });

  it('reports the stack identity: disposable database, fixtures present, no PR #3, no fixture clone', async () => {
    const identity = (await app.inject({ url: '/experiments/identity' })).json();
    expect(identity).toMatchObject({
      stack_id: 'hw2f-itest1',
      database: 'devdigest_test',
      database_is_disposable: true,
      repos: ['acme/payments-api'],
      fixture_pulls: [501, 502],
      demo_pr_3_present: false,
      fixture_clone_present: false,
      provider: 'deepinfra',
      model: MODEL,
      max_output_tokens: 4000,
      in_flight_slot: null,
    });
    // In a test run, the test-owned key file (test/setup/isolate-database.ts), never the real one; the key itself is never returned.
    expect(identity.secrets_path).toBe(process.env.DEVDIGEST_TEST_SECRETS_PATH);
    expect(typeof identity.openrouter_key_configured).toBe('boolean');
    expect(JSON.stringify(identity)).not.toMatch(/sk-or-/);
  });

  it('lists the live endpoints of the frozen model without a generation', async () => {
    const before = modelCalls();
    const body = (await app.inject({ url: '/experiments/endpoints' })).json();
    expect(body).toEqual({ model: MODEL, endpoints: [ENDPOINT] });
    expect(modelCalls()).toBe(before);
  });

  it('runs one slot: one request with the frozen routing, preflight, fingerprints and telemetry on record', async () => {
    const before = modelCalls();
    const slotId = nextSlot();
    const response = await start({ slot_id: slotId });
    expect(response.statusCode).toBe(202);
    const { run, trace } = await settledTrace(response.json().run_id);
    expect(modelCalls() - before).toBe(1);
    const sent = llm.requests.at(-1)!;
    expect(sent.experiment).toEqual({
      slotId,
      transportMaxRetries: 0,
      maxRetries: 0,
      routing: { order: ['deepinfra'], only: ['deepinfra'], allowFallbacks: false },
      maxTokens: 4000,
      routerMetadata: true,
      generationLookup: null,
    });
    expect(trace.experiment).toMatchObject({
      stack_id: 'hw2f-itest1',
      experiment: '18',
      condition: 'with',
      dispatch_state: 'completed',
      diff_sha256: await fixtureDiffSha(502),
      usage_known: true,
      routing: { order: ['deepinfra'], only: ['deepinfra'], allow_fallbacks: false },
    });
    expect(trace.experiment.non_skill_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(trace.experiment.preflight.worst_case_usd).toBeGreaterThan(0);
    expect(trace.experiment.preflight.worst_case_usd).toBeLessThanOrEqual(0.05);
    expect(trace.experiment.preflight.input_upper_bound).toBeGreaterThan(trace.experiment.preflight.output_cap / 100);
    expect(trace.experiment.attempts).toHaveLength(1);
    expect(run).toMatchObject({ status: 'done', tokensIn: 900, tokensOut: 120, costUsd: 0.0002 });
  });

  it('the non-Skill fingerprint is equal across conditions; the Skill fingerprint differs', async () => {
    const links = (await app.inject({ url: `/agents/${apiAgent}/skills` })).json() as Array<{ skill_id: string }>;
    const runWith = async (skillIds: string[], condition: 'with' | 'without') => {
      await app.inject({ method: 'POST', url: `/agents/${apiAgent}/skills`, payload: { skill_ids: skillIds } });
      const response = await start({ condition });
      return (await settledTrace(response.json().run_id)).trace.experiment;
    };
    const without = await runWith([], 'without');
    const withSkill = await runWith([links[0]!.skill_id], 'with');
    expect(without.non_skill_fingerprint).toBe(withSkill.non_skill_fingerprint);
    expect(without.skill_fingerprint).not.toBe(withSkill.skill_fingerprint);
    await app.inject({ method: 'POST', url: `/agents/${apiAgent}/skills`, payload: { skill_ids: links.map((l) => l.skill_id) } });
  });

  it.each([
    ['the runtime diff differs from the frozen hash', () => ({ expected_diff_sha256: 'b'.repeat(64) }), /does not equal the frozen fixture hash/],
    ['the reservation is below the worst case', () => ({ reservation_usd: 0.000001 }), /exceeds the slot reservation/],
  ])('refuses before any model request when %s', async (_label, patch, reason) => {
    const before = modelCalls();
    const response = await start(patch());
    const { run, trace } = await settledTrace(response.json().run_id);
    expect(modelCalls()).toBe(before);
    expect(trace.experiment.dispatch_state).toBe('refused');
    expect(trace.experiment.refusal_reason).toMatch(reason);
    expect(run).toMatchObject({ status: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0 });
  });

  it.each([
    ['repo intel on', { strategy: 'single-pass', repo_intel: true }, /repo intel must be off/],
    ['a map-reduce strategy', { strategy: 'map-reduce', repo_intel: false }, /strategy must be single-pass/],
  ])('refuses an explicitly invalid agent (%s) before any model request', async (label, config, reason) => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Invalid reviewer: ${label}`, provider: 'openrouter', model: MODEL, system_prompt: 'Review.', ...config },
    });
    expect(created.statusCode).toBeLessThan(300);
    expect(created.json()).toMatchObject(config);
    const before = modelCalls();
    const response = await start({ agent_id: created.json().id });
    const { run, trace } = await settledTrace(response.json().run_id);
    expect(modelCalls()).toBe(before);
    expect(trace.experiment.dispatch_state).toBe('refused');
    expect(trace.experiment.refusal_reason).toMatch(reason);
    expect(run).toMatchObject({ status: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0 });
  });

  it('the seeded Test Quality Reviewer is experiment-ready: a free preview of experiment 17 passes', async () => {
    const [tqr] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, tqrAgent));
    expect(tqr).toMatchObject({ strategy: 'single-pass', repoIntel: false });
    const before = modelCalls();
    const runsBefore = (await pg.handle.db.select().from(t.agentRuns)).length;
    const preview = await app.inject({
      method: 'POST',
      url: '/experiments/preview',
      payload: { pr_id: pr501, agent_id: tqrAgent, experiment: '17', condition: 'without', phase: 'exploration', reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(501) },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body).toMatchObject({
      ok: true,
      reason: null,
      block: { non_skill_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), skill_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(body.block.preflight.worst_case_usd).toBeGreaterThan(0);
    expect(body.block.preflight.worst_case_usd).toBeLessThanOrEqual(0.05);
    expect(modelCalls()).toBe(before);
    expect((await pg.handle.db.select().from(t.agentRuns)).length).toBe(runsBefore);
  });

  it('a preview reflects the linked skills, not its condition label', async () => {
    const links = (await app.inject({ url: `/agents/${tqrAgent}/skills` })).json() as Array<{ skill_id: string; skill: { name: string } }>;
    const target = links.find((l) => l.skill.name === 'Edge Cases and Error Paths')!.skill_id;
    const previewWith = async (skillIds: string[], condition: 'with' | 'without') => {
      await app.inject({ method: 'POST', url: `/agents/${tqrAgent}/skills`, payload: { skill_ids: skillIds } });
      const response = await app.inject({
        method: 'POST',
        url: '/experiments/preview',
        payload: { pr_id: pr501, agent_id: tqrAgent, experiment: '17', condition, phase: 'exploration', reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(501) },
      });
      return response.json().block as { non_skill_fingerprint: string; skill_fingerprint: string; preflight: { input_upper_bound: number } };
    };
    try {
      const labelledWithButUnlinked = await previewWith([], 'with');
      const labelledWithoutButLinked = await previewWith([target], 'without');
      const empty = sha256(canonicalJson([]));
      expect(labelledWithButUnlinked.skill_fingerprint).toBe(empty); // the label "with" added no Skill
      expect(labelledWithoutButLinked.skill_fingerprint).not.toBe(empty); // the label "without" removed none
      // The runner's Phase 0 check recomputes this value from the target skill.
      const [skill] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, target));
      expect(labelledWithoutButLinked.skill_fingerprint).toBe(expectedSkillFingerprint('with', skill!));
      expect(labelledWithButUnlinked.skill_fingerprint).toBe(expectedSkillFingerprint('without', skill!));
      expect(labelledWithoutButLinked.preflight.input_upper_bound).toBeGreaterThan(labelledWithButUnlinked.preflight.input_upper_bound);
      expect(labelledWithButUnlinked.non_skill_fingerprint).toBe(labelledWithoutButLinked.non_skill_fingerprint);
    } finally {
      await app.inject({ method: 'POST', url: `/agents/${tqrAgent}/skills`, payload: { skill_ids: links.map((l) => l.skill_id) } });
    }
  });

  it('refuses when no live endpoint matches the frozen provider', async () => {
    llm.endpoints = [{ ...ENDPOINT, providerName: 'Novita', tag: 'novita' }];
    const before = modelCalls();
    const response = await start();
    const { trace } = await settledTrace(response.json().run_id);
    expect(modelCalls()).toBe(before);
    expect(trace.experiment.refusal_reason).toMatch(/no live endpoint matches/);
    llm.endpoints = [ENDPOINT];
  });

  it('a dispatched failure records unknown usage as null, never zero', async () => {
    llm.mode = 'fail-after-dispatch';
    const response = await start();
    const { run, trace } = await settledTrace(response.json().run_id);
    llm.mode = 'ok';
    expect(trace.experiment).toMatchObject({ dispatch_state: 'failed', usage_known: false });
    expect(trace.experiment.attempts[0]).toMatchObject({ dispatch: 'dispatched', outcome: 'network_error' });
    expect(run).toMatchObject({ status: 'failed', tokensIn: null, tokensOut: null, costUsd: null });
  });

  it('never replays a slot, and allows one experiment run in flight', async () => {
    const slot = nextSlot();
    const first = await start({ slot_id: slot });
    await settledTrace(first.json().run_id);
    const replay = await start({ slot_id: slot });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.message).toMatch(/already used/);

    llm.mode = 'hold';
    const held = await start();
    expect(held.statusCode).toBe(202);
    await vi.waitFor(async () => expect((await app.inject({ url: '/experiments/identity' })).json().in_flight_slot).not.toBeNull());
    const concurrent = await start();
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().error.message).toMatch(/still in flight/);
    llm.releaseHeld();
    await settledTrace(held.json().run_id);
    llm.mode = 'ok';
    expect((await app.inject({ url: '/experiments/identity' })).json().in_flight_slot).toBeNull();

    const lookup = (await app.inject({ url: `/experiments/slots/${slot}` })).json();
    expect(lookup.runs).toHaveLength(1);
    expect(lookup.runs[0].experiment.slot_id).toBe(slot);
    // What actually ran, for the report's identity and Skills checks.
    expect(lookup.runs[0].config).toMatchObject({ agent: 'API Contract Reviewer', pr: 502 });
    expect(lookup.runs[0].skills_block).toMatch(/<untrusted source="skill-0">/);
    expect(lookup.runs[0].experiment).toMatchObject({ condition: 'with', phase: 'exploration' });
  });

  it('refuses a direct request without a valid capability for this stack and phase (no run created)', async () => {
    const runsBefore = (await pg.handle.db.select().from(t.agentRuns)).length;
    const refused = [
      await start({}, {}),
      await start({}, { 'x-hw2-capability': 'not-the-token' }),
      await start({ phase: 'confirmatory', slot_id: nextSlot('c'), expected_non_skill_fingerprint: 'a'.repeat(64) }),
    ];
    for (const response of refused) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('experiment_not_authorized');
    }
    authorize('exploration', 0.5, 0.000001); // expires immediately
    await new Promise((r) => setTimeout(r, 20));
    expect((await start()).json().error.message).toMatch(/expired/);
    rmSync(join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itest1', 'capability.json'));
    expect((await start()).json().error.message).toMatch(/no spending capability/);
    authorize('exploration');
    expect((await pg.handle.db.select().from(t.agentRuns)).length).toBe(runsBefore);
  });

  it('keeps slot ids in their phase', async () => {
    const response = await start({ slot_id: nextSlot('c') });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toMatch(/must start with x-/);
  });

  it('enforces the phase budget on the server, from the stored runs', async () => {
    // Earlier in this stack, the dispatched failure with unknown usage is charged at
    // its full $0.05 reservation (plus small known costs): a $0.06 capability then
    // has no room for another $0.05 slot, whatever the client claims.
    authorize('exploration', 0.06);
    const runsBefore = (await pg.handle.db.select().from(t.agentRuns)).length;
    const over = await start();
    expect(over.statusCode).toBe(409);
    expect(over.json().error.message).toMatch(/exploration budget: \$0\.05\d* charged \+ \$0\.05 > \$0\.06/);
    expect((await pg.handle.db.select().from(t.agentRuns)).length).toBe(runsBefore); // refused before a run row
    authorize('exploration');
  });

  it('previews a slot for free: fingerprints and preflight, no model request, no run', async () => {
    const before = modelCalls();
    const runsBefore = (await pg.handle.db.select().from(t.agentRuns)).length;
    const preview = await app.inject({
      method: 'POST',
      url: '/experiments/preview',
      payload: { pr_id: pr502, agent_id: apiAgent, experiment: '18', condition: 'without', phase: 'confirmatory', reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(502) },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ ok: true, reason: null, block: { non_skill_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(modelCalls()).toBe(before);
    expect((await pg.handle.db.select().from(t.agentRuns)).length).toBe(runsBefore);
  });

  it('confirmatory slots must reproduce the frozen non-Skill fingerprint and know the completion limit', async () => {
    authorize('confirmatory');
    const preview = (
      await app.inject({
        method: 'POST',
        url: '/experiments/preview',
        payload: { pr_id: pr502, agent_id: apiAgent, experiment: '18', condition: 'with', phase: 'confirmatory', reservation_usd: 0.05, expected_diff_sha256: await fixtureDiffSha(502) },
      })
    ).json();
    const frozen = preview.block.non_skill_fingerprint as string;
    const confirmatory = (patch: Record<string, unknown>) => start({ phase: 'confirmatory', slot_id: nextSlot('c'), ...patch });

    const missing = await confirmatory({ expected_non_skill_fingerprint: null });
    expect(missing.statusCode).toBe(422);

    const before = modelCalls();
    const wrong = await confirmatory({ expected_non_skill_fingerprint: 'b'.repeat(64) });
    expect((await settledTrace(wrong.json().run_id)).trace.experiment.refusal_reason).toMatch(/does not equal the frozen/);

    llm.endpoints = [{ ...ENDPOINT, maxCompletionTokens: null }];
    const unknownLimit = await confirmatory({ expected_non_skill_fingerprint: frozen });
    expect((await settledTrace(unknownLimit.json().run_id)).trace.experiment.refusal_reason).toMatch(/max completion tokens are unknown/);
    llm.endpoints = [ENDPOINT];
    expect(modelCalls()).toBe(before); // both refused before any model request

    const ok = await confirmatory({ expected_non_skill_fingerprint: frozen });
    const { trace } = await settledTrace(ok.json().run_id);
    expect(trace.experiment).toMatchObject({ phase: 'confirmatory', dispatch_state: 'completed', non_skill_fingerprint: frozen, expected_non_skill_fingerprint: frozen });
    expect(modelCalls()).toBe(before + 1);
    authorize('exploration');
  });

  it('refuses to start when a clone of the fixture repo exists, or another repository is present', async () => {
    mkdirSync(join(cloneDir, 'acme', 'payments-api'), { recursive: true });
    const withClone = await start();
    expect(withClone.statusCode).toBe(422);
    expect(withClone.json().error.message).toMatch(/clone of acme\/payments-api exists/);
    rmSync(join(cloneDir, 'acme'), { recursive: true, force: true });

    await pg.handle.db.insert(t.repos).values({ workspaceId, owner: 'someone', name: 'real', fullName: 'someone/real' });
    const notDisposable = await start();
    expect(notDisposable.statusCode).toBe(422);
    expect(notDisposable.json().error.message).toMatch(/holds other repositories/);
    await pg.handle.db.delete(t.repos).where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'someone/real')));
  });

  /** The real provider's key in the loopback slots below: it must never be persisted. */
  const LOOPBACK_KEY = 'sk-or-v1-itest0123456789abcdef0123456789';
  /**
   * One experiment slot through the real OpenRouterProvider, SDK and extractor
   * against a loopback stand-in for OpenRouter: endpoint metadata for the
   * preflight, `chat` for the one generation and, when given, `lookup` for the
   * generation record (`GET /generation`, read n = 1, 2, …; the provider's
   * clock and sleep are fakes, so 5 s between reads costs no time). Returns
   * what was persisted.
   */
  async function loopbackSlot(
    chat: (req: IncomingMessage, res: ServerResponse) => void,
    lookup?: (read: number) => Promise<{ status: number; body?: unknown }> | { status: number; body?: unknown },
  ) {
    const chats: Array<{ authorization: string | undefined }> = [];
    const generationReads: string[] = [];
    let clock = 0;
    const server: Server = createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        if (lookup && req.method === 'GET' && req.url?.startsWith('/v1/generation?id=')) {
          generationReads.push(new URL(req.url, 'http://loopback').searchParams.get('id') ?? '');
          const answer = await lookup(generationReads.length);
          res.writeHead(answer.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(answer.body ?? {}));
          return;
        }
        if (req.method === 'GET' && req.url === `/v1/models/${MODEL}/endpoints`) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', quantization: 'fp8', context_length: 128_000, max_completion_tokens: 16_384, pricing: { prompt: '0.00000014', completion: '0.00000028', request: '0' } }] } }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          chats.push({ authorization: req.headers.authorization });
          chat(req, res);
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const real = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DEVDIGEST_CLONE_DIR: cloneDir,
        ...EXPERIMENT_ENV,
        DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: lookup ? '1' : '0',
        DEVDIGEST_EXPERIMENT_CAPABILITY_PATH: join(capHome, '.devdigest', 'hw2-experiments', 'hw2f-itest1', 'capability.json'),
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        // maxRetries 2 on the client: the experiment path must still send exactly one request.
        llm: {
          openrouter: new OpenRouterProvider(LOOPBACK_KEY, {
            baseURL: `http://127.0.0.1:${port}/v1`,
            maxRetries: 2,
            sleep: async (ms) => {
              clock += ms;
            },
            now: () => clock,
          }),
        },
      },
    });
    try {
      const slotId = nextSlot();
      const response = await real.inject({
        method: 'POST',
        url: '/experiments/runs',
        headers: { 'x-hw2-capability': token },
        payload: {
          pr_id: pr502, agent_id: apiAgent, slot_id: slotId, experiment: '18', condition: 'without', phase: 'exploration',
          manifest_fingerprint: 'a'.repeat(64), reservation_usd: 0.01, expected_diff_sha256: await fixtureDiffSha(502), expected_non_skill_fingerprint: null,
        },
      });
      expect(response.statusCode).toBe(202);
      const runId = response.json().run_id as string;
      const { run, trace } = await vi.waitFor(
        async () => {
          const [row] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
          const tr = await real.inject({ url: `/runs/${runId}/trace` });
          const body = tr.statusCode === 200 ? tr.json() : null;
          if (!row || row.status === 'running' || !body?.experiment || body.experiment.dispatch_state === 'dispatching') throw new Error('not settled');
          return { run: row, trace: body };
        },
        { timeout: 15_000, interval: 100 },
      );
      const slot = (await real.inject({ url: `/experiments/slots/${slotId}` })).json();
      // Every persisted or served form of the failure: run row (error), trace (log, attempts, refusal reason), slot lookup.
      return { chats, generationReads, run, trace, slot, serialized: [JSON.stringify(run), JSON.stringify(trace), JSON.stringify(slot)] };
    } finally {
      await real.close();
      await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    }
  }

  it('a provider 429 through the real provider, SDK and extractor: one request, sanitized detail persisted, the key nowhere', async () => {
    const { chats, run, trace, serialized } = await loopbackSlot((req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '20', 'x-ratelimit-remaining': '0', 'x-request-id': 'req_itest_1', 'set-cookie': 'session=itestsecret' });
      // No `message`: the SDK then builds its error message from the whole body, echoed credential included.
      res.end(JSON.stringify({ error: { code: 429, metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited', provider_name: 'DeepInfra', raw: `upstream saw ${req.headers.authorization}` } } }));
    });
    expect(chats).toHaveLength(1); // one generation request, no SDK retry
    expect(chats[0]!.authorization).toBe(`Bearer ${LOOPBACK_KEY}`);
    expect(run).toMatchObject({ status: 'failed', costUsd: null });
    expect(run.error).toMatch(/^429 /);
    expect(trace.experiment).toMatchObject({ dispatch_state: 'failed', usage_known: false });
    expect(trace.experiment.attempts).toHaveLength(1);
    expect(trace.experiment.attempts[0]).toMatchObject({
      dispatch: 'dispatched',
      outcome: 'http_error',
      httpStatus: 429,
      errorDetail: {
        origin: 'upstream_provider',
        code: 429,
        errorType: 'rate_limit_exceeded',
        providerCode: 'rate_limited',
        providerName: 'DeepInfra',
        upstreamRawPresent: true,
        requestId: 'req_itest_1',
        retryAfter: '20',
        rateLimit: { 'x-ratelimit-remaining': '0' },
      },
    });
    for (const text of serialized) for (const leaked of [LOOPBACK_KEY, 'itestsecret', 'upstream saw']) expect(text).not.toContain(leaked);
    expect(trace.log.some((line: { msg: string }) => /Run failed: 429 /.test(line.msg))).toBe(true);
  });

  it('an HTTP 200 error body persists no openrouter_metadata and no unsafe identifier', async () => {
    const { chats, run, trace, serialized } = await loopbackSlot((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-generation-id': `gen-${LOOPBACK_KEY}` });
      res.end(JSON.stringify({
        id: `gen-err ${req.headers.authorization}`,
        model: '<model>',
        error: { code: 502, message: 'Provider returned error', metadata: { provider_name: 'DeepInfra' } },
        openrouter_metadata: {
          requested: MODEL,
          strategy: 'direct',
          attempt: 1,
          attempts: [{}],
          endpoints: { available: [{ provider: 'DeepInfra', model: `echo ${req.headers.authorization}`, selected: true }] },
          debug: { echoed_authorization: req.headers.authorization, internal: 'routing-itest-marker' },
        },
      }));
    });
    expect(chats).toHaveLength(1);
    expect(run).toMatchObject({ status: 'failed', costUsd: null });
    expect(trace.experiment).toMatchObject({ dispatch_state: 'failed', usage_known: false });
    expect(trace.experiment.attempts[0]).toMatchObject({
      outcome: 'http_error',
      httpStatus: 200,
      routerMetadataRaw: null,
      responseId: null,
      generationIdHeader: null,
      servedModel: null,
      router: { selected: [{ provider: 'DeepInfra', model: '[redacted]' }], attempt: 1, requested: MODEL, strategy: 'direct' },
      errorDetail: { origin: 'upstream_provider', code: 502, providerName: 'DeepInfra' },
    });
    for (const text of serialized) for (const leaked of [LOOPBACK_KEY, 'routing-itest-marker', 'echoed_authorization', 'echo Bearer']) expect(text).not.toContain(leaked);
  });

  /** The served version OpenRouter's records name, as in HW2 Gate 3. */
  const SERVED = 'deepseek/deepseek-v4-flash-20260423';
  /** A completed generation as Gate 3 saw it: router metadata with `attempt: 1` and no `attempts` array. */
  const completedChat = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'gen-itest-late-1',
      model: MODEL,
      choices: [{ message: { content: JSON.stringify({ verdict: 'approve', summary: 'ok', score: 100, findings: [] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0002 },
      openrouter_metadata: { requested: MODEL, strategy: 'direct', attempt: 1, endpoints: { total: 15, available: [{ provider: 'DeepInfra', model: SERVED, selected: true }] } },
    }));
  };
  const generationRecord = {
    data: { id: 'gen-itest-late-1', model: SERVED, provider_name: 'DeepInfra', finish_reason: 'stop', tokens_prompt: 900, tokens_completion: 120, total_cost: 0.0002, provider_responses: [{ provider_name: 'DeepInfra', endpoint_id: 'ep-1', model_permaslug: SERVED, status: 200 }] },
  };
  /** What `cli.ts report` expects of a counted experiment-18 slot. */
  const expectations18 = async () => {
    const fixture = EXPERIMENT_FIXTURES.find((f) => f.number === 502)!;
    return {
      providerName: 'DeepInfra',
      model: MODEL,
      servedModel: SERVED,
      expectedDiffSha256: await fixtureDiffSha(502),
    };
  };
  const runningRuns = async () => (await pg.handle.db.select({ id: t.agentRuns.id }).from(t.agentRuns).where(eq(t.agentRuns.status, 'running'))).length;

  it('a generation record that appears 35 s after the response is found, persisted with the trace, and makes the slot eligible', async () => {
    const runningDuringLookup: number[] = [];
    const { chats, generationReads, run, trace, slot } = await loopbackSlot(completedChat, async (read) => {
      runningDuringLookup.push(await runningRuns());
      return read < 8 ? { status: 404 } : { status: 200, body: generationRecord }; // reads 5 s apart: the 8th is at 35 s
    });
    expect(chats).toHaveLength(1); // the lookup reads metadata only: no second generation
    expect(generationReads).toEqual(Array(8).fill('gen-itest-late-1'));
    // While the lookup ran the run was not terminal, so the runner could not settle the slot without the record.
    expect(runningDuringLookup.every((n) => n >= 1)).toBe(true);
    expect(run).toMatchObject({ status: 'done', costUsd: 0.0002 });
    expect(trace.experiment).toMatchObject({ dispatch_state: 'completed', usage_known: true });
    expect(trace.experiment.attempts[0].generation).toEqual({
      status: 'found', providerName: 'DeepInfra', model: SERVED, finishReason: 'stop', tokensPrompt: 900, tokensCompletion: 120, totalCost: 0.0002,
      providerResponses: [{ providerName: 'DeepInfra', endpointId: 'ep-1', modelPermaslug: SERVED, status: 200 }],
    });
    // The report evaluates what the slot lookup serves.
    const [served] = slot.runs;
    expect(evaluateSlot(served, await expectations18())).toEqual({ eligible: true, provenance: 'verified', sources: ['router_metadata', 'generation'], reasons: [] });
  });

  it('a generation record that never appears is recorded as not_found: the cost stays known, nothing is invented, the slot is not counted', async () => {
    const { chats, generationReads, run, trace, slot } = await loopbackSlot(completedChat, () => ({ status: 404 }));
    expect(chats).toHaveLength(1);
    expect(generationReads).toHaveLength(13);
    expect(run).toMatchObject({ status: 'done', costUsd: 0.0002 });
    expect(trace.experiment).toMatchObject({ dispatch_state: 'completed', usage_known: true });
    expect(trace.experiment.attempts[0].generation).toMatchObject({ status: 'not_found', providerName: null, model: null, providerResponses: [] });
    const verdict = evaluateSlot(slot.runs[0], await expectations18());
    expect(verdict).toMatchObject({ eligible: false, provenance: 'unverified', sources: ['router_metadata'] });
  });
});
