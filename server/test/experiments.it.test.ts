import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import { EXPERIMENT_FIXTURES, patchStats } from '../src/db/seed-fixtures.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import { sha256 } from '../src/modules/_shared/experiment.js';
import { writeCapability } from '../src/experiments/hw2/cli.js';
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

  it('refuses intent derivation in experiment mode without reaching the provider', async () => {
    const before = modelCalls();
    await app.inject({ method: 'POST', url: `/pulls/${pr501}/intent/recompute` });
    expect(modelCalls()).toBe(before); // the derivation never reached the provider
    // The seeded cached intent is still the one the experiment slots use.
    expect((await app.inject({ url: `/pulls/${pr501}/intent` })).json()).toMatchObject({ state: 'ready', stale: false, provider: 'seed' });
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
    // The dedicated key file only (no env fallback); the key itself is never returned.
    expect(identity.secrets_path).toMatch(/\/\.devdigest\/hw2-experiments\/secrets\.json$/);
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
    expect(trace.intent).toMatchObject({ source: 'cache', status: 'used' });
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

  it('refuses an agent that is not single-pass with repo intel off', async () => {
    const before = modelCalls();
    const response = await start({ pr_id: pr501, agent_id: tqrAgent, experiment: '17', expected_diff_sha256: await fixtureDiffSha(501) });
    const { trace } = await settledTrace(response.json().run_id);
    expect(modelCalls()).toBe(before);
    expect(trace.experiment.refusal_reason).toMatch(/single-pass|repo intel/);
  });

  it('refuses when the cached intent is not fresh, and never derives one', async () => {
    const [intent] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr502));
    await pg.handle.db.update(t.prIntent).set({ headSha: 'stale' }).where(eq(t.prIntent.prId, pr502));
    const before = modelCalls();
    const response = await start();
    const { trace } = await settledTrace(response.json().run_id);
    expect(modelCalls()).toBe(before); // neither a derivation nor the review
    expect(trace.experiment.refusal_reason).toMatch(/fresh cache/);
    await pg.handle.db.update(t.prIntent).set({ headSha: intent!.headSha }).where(eq(t.prIntent.prId, pr502));
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
});
