/**
 * Study v5 end to end: the real attempt-pool runner (`runAttemptPool`)
 * against the real API, the experiment executor and a disposable Postgres
 * (testcontainers), with FakeExperimentProvider standing in for OpenRouter
 * (structured 429 modes: a classified shared-pool 429, a 429 with a response
 * ID, an OpenRouter-side 429, an upstream 429 with another limit_source).
 *
 * Mutation record (2026-11-02; see hw2-study-v5.test.ts for the full list):
 * dropping the response-ID check, the pool cap K (off by one), the outage
 * stop, the pacing call, the limit_source allowlist, or the classified-429
 * exemption from the unknown-cost stop each fails at least one test here. The runner's requests go through
 * `app.inject`; nothing leaves the process and nothing is billed.
 *
 * Each scenario uses its own study tag (v51, v52, …) so its attempt IDs are
 * new to the stack, which never replays a slot.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { ExperimentApi } from '../src/experiments/hw2/api.js';
import { attemptPlan, P3_ATTEMPT_POLICY_V5 } from '../src/experiments/hw2/attempt-policy.js';
import { charge, spent } from '../src/experiments/hw2/budget.js';
import { expectedSkillFingerprint, writeCapability } from '../src/experiments/hw2/cli.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { STUDY_V5, fixtureDiffSha, scheduleFor, studySemantics, type StudySemantics } from '../src/experiments/hw2/manifest.js';
import { buildP3Report } from '../src/experiments/hw2/report-p3.js';
import type { SlotRunData } from '../src/experiments/hw2/report.js';
import { runAttemptPool, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';
import { EXPERIMENT_FIXTURES } from '../src/db/seed-fixtures.js';
import { traceProblems } from '../src/experiments/hw2/throttle-policy.js';
import { modelPacing, modelPolicy, outcomeOfClass, type AttemptClassification } from '../src/experiments/hw2/attempt-policy.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { FAKE_MODEL, FakeExperimentProvider, type FakeMode } from './helpers/fake-experiment-provider.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[hw2-study-v5-runner] Docker not available — skipping integration tests.');

const STACK = 'hw2f-itestv5';
const RESERVATION = 0.01;
const MANIFEST = 'a'.repeat(64);
const FIXTURE = EXPERIMENT_FIXTURES.find((f) => f.number === 501)!;

d('HW2 study v5: the attempt-pool runner against the real API (fake provider, disposable database)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let capHome: string;
  let token = '';
  const llm = new FakeExperimentProvider();
  let pr501 = '';
  let tqr = '';
  let target = { id: '', name: '', body: '' };
  let nonSkill = '';
  let diffSha = '';
  const V5 = studySemantics({ version: 5, study: STUDY_V5 });

  /** The runner's HTTP client, routed through `app.inject`. */
  const api = () => new ExperimentApi('http://stack.invalid', (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: `${u.pathname}${u.search}`,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    return new Response(res.statusCode === 204 || res.body === '' ? null : res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db, { experimentFixtures: true });
    capHome = mkdtempSync(join(tmpdir(), 'hw2-v5-home-'));
    writeCapability({ stackId: STACK, phase: 'confirmatory', budgetUsd: 1, hours: 2, home: capHome });
    token = readFileSync(join(capHome, '.devdigest', 'hw2-experiments', STACK, 'capability.token'), 'utf8');
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DEVDIGEST_CLONE_DIR: mkdtempSync(join(tmpdir(), 'hw2-v5-clones-')),
        DEVDIGEST_EXPERIMENT_STACK_ID: STACK,
        DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra',
        DEVDIGEST_EXPERIMENT_MODEL: FAKE_MODEL,
        DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '8000',
        DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000009',
        DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000018',
        DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: '0',
        DEVDIGEST_EXPERIMENT_CAPABILITY_PATH: join(capHome, '.devdigest', 'hw2-experiments', STACK, 'capability.json'),
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: '' }), github: new MockGitHubClient(), llm: { openrouter: llm } },
    });
    pr501 = (await pg.handle.db.select().from(t.pullRequests)).find((p) => p.number === 501)!.id;
    tqr = (await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId))).find((a) => a.name === 'Test Quality Reviewer')!.id;
    const skills = (await app.inject({ url: '/skills' })).json() as Array<{ id: string; name: string; body: string }>;
    target = skills.find((s) => s.name === FIXTURE.targetSkill)!;
    diffSha = await fixtureDiffSha(FIXTURE);
    const preview = (await app.inject({
      method: 'POST', url: '/experiments/preview',
      payload: { pr_id: pr501, agent_id: tqr, experiment: '17', condition: 'without', phase: 'confirmatory', reservation_usd: RESERVATION, expected_diff_sha256: diffSha },
    })).json();
    expect(preview.ok).toBe(true);
    nonSkill = preview.block.non_skill_fingerprint;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    rmSync(capHome, { recursive: true, force: true });
  });

  const EXPECT = () => ({ providerName: 'DeepInfra', model: FAKE_MODEL, servedModel: FAKE_MODEL, expectedDiffSha256: diffSha });

  /** Run one scenario under its own tag: the trials, the runner, the ledger and the report. */
  async function scenario(tag: string, script: FakeMode[]) {
    const semantics: StudySemantics = { ...V5, slotTag: tag };
    const trials = scheduleFor(semantics, 777);
    const runs: SlotRun[] = trials.map((slot) => ({
      slot, prId: pr501, agentId: tqr, agentName: 'Test Quality Reviewer', prNumber: 501, skillIds: slot.condition === 'with' ? [target.id] : [],
      manifestFingerprint: MANIFEST, expectedDiffSha256: diffSha, reservationUsd: RESERVATION, expectedNonSkillFingerprint: nonSkill, semantics, expectations: EXPECT(),
    }));
    const dir = mkdtempSync(join(tmpdir(), `hw2-v5-${tag}-`));
    let tick = Date.parse('2026-11-03T12:00:00.000Z');
    const ledger = new Ledger(dir, () => new Date((tick += 1000)));
    ledger.acquire({ pid: process.pid, stackId: STACK });
    const paced: number[] = [];
    const logs: string[] = [];
    const client = api();
    const deps: RunnerDeps = {
      api: client, ledger, log: (m) => logs.push(m), capabilityToken: token, stackId: STACK,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))), pollIntervalMs: 50, pollTimeoutMs: 30_000,
      // The fake wait moves the ledger clock, so the report's measured gaps cover the plan.
      pacingSleep: async (ms) => { paced.push(ms); tick += ms; },
    };
    const requestsBefore = llm.requests.length;
    llm.script = [...script];
    try {
      const result = await runAttemptPool(deps, STUDY_V5, runs);
      const plan = attemptPlan(trials, P3_ATTEMPT_POLICY_V5);
      // The report, from the stack's own slot views and reviews, as `cli.ts report` reads them.
      const reports = new Map<string, SlotRunData | null>();
      for (const a of plan) {
        const view = (await app.inject({ url: `/experiments/slots/${a.attempt_id}` })).json() as { runs: Array<SlotRunData & { run_id: string }> };
        const found = view.runs[0];
        if (!found?.experiment) { reports.set(a.attempt_id, null); continue; }
        const reviews = (await app.inject({ url: `/pulls/${pr501}/reviews` })).json() as Array<{ run_id: string | null; findings: SlotRunData['findings'] }>;
        reports.set(a.attempt_id, { ...found, findings: reviews.find((r) => r.run_id === found.run_id)?.findings ?? [] });
      }
      const report = buildP3Report({
        trials: trials.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })),
        ledger: ledger.slots(), runs: reports, rules: { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 4, end_line: 8 }], keywords: ['expired'] } },
        frozenNonSkill: { '17': nonSkill }, expectations: EXPECT, semantics,
        execution: {
          manifestFingerprint: MANIFEST, phase: 'confirmatory',
          fixture: () => ({ reviewer: FIXTURE.reviewer, prNumber: 501, targetSkill: FIXTURE.targetSkill }),
          skillFingerprint: (_e, condition) => expectedSkillFingerprint(condition, target),
        },
      });
      // Cross-check: the ledger's recorded classes, replayed through the pure model's validator.
      const recorded = plan.filter((a) => ledger.slots().has(a.attempt_id));
      const trace = recorded.map((a) => {
        const record = ledger.slots().get(a.attempt_id)!;
        const p3 = record.events.find((e) => e.state === record.state)!.detail!.p3 as AttemptClassification;
        return { attempt_id: a.attempt_id, outcome: outcomeOfClass(p3.class), delay_before_ms: (record.events[0]!.detail!.p3_attempt as { delay_before_ms: number }).delay_before_ms };
      });
      const validator = traceProblems(trials, modelPolicy(P3_ATTEMPT_POLICY_V5), trace, modelPacing(P3_ATTEMPT_POLICY_V5));
      return { result, report, ledger: ledger.slots(), posts: recorded.map((a) => a.attempt_id), plan, paced, logs, requests: llm.requests.length - requestsBefore, validator, trials };
    } finally {
      llm.script = [];
      ledger.release();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const classOf = (ledger: Map<string, { state: string; events: Array<{ state: string; detail?: Record<string, unknown> }> }>, id: string) => {
    const record = ledger.get(id)!;
    return (record.events.find((e) => e.state === record.state)!.detail!.p3 as AttemptClassification).class;
  };

  it('a classified shared-pool 429 on a1: a2 after 60 s is observed; one model request per attempt; reservation held for the 429', async () => {
    const s = await scenario('v51', ['http-429-shared-pool']);
    expect(s.result.stopped).toBeNull();
    expect(s.result.state).toEqual({ kind: 'done' });
    expect(s.posts).toEqual([s.plan[0]!.attempt_id, s.plan[1]!.attempt_id, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => s.plan[i * 3]!.attempt_id)]);
    expect(s.requests).toBe(11);
    expect(s.paced).toEqual([60_000, ...Array(9).fill(30_000)]);
    expect(classOf(s.ledger, s.plan[0]!.attempt_id)).toBe('throttled');
    expect(classOf(s.ledger, s.plan[1]!.attempt_id)).toBe('observed');
    const throttled = s.ledger.get(s.plan[0]!.attempt_id)!;
    expect(throttled).toMatchObject({ state: 'failed', cost_usd: null });
    expect(charge(throttled)).toBe(RESERVATION); // unknown cost: held at its reservation, never released
    expect(spent(s.ledger.values())).toBeCloseTo(RESERVATION + 10 * 0.0002, 10);
    expect(s.validator).toEqual([]);
    // The stack records the non-Skill fingerprint on the failed 429 run too (as the real v4 429 trace did).
    const view = (await app.inject({ url: `/experiments/slots/${s.plan[0]!.attempt_id}` })).json();
    expect(view.runs[0].experiment).toMatchObject({ dispatch_state: 'failed', usage_known: false, non_skill_fingerprint: nonSkill });
    expect(view.runs[0].experiment.attempts[0]).toMatchObject({ httpStatus: 429, responseId: null, errorDetail: { origin: 'upstream_provider', limitSource: 'upstream_provider_shared_pool', providerName: 'DeepInfra' } });
    expect(s.report.trials.map((x) => x.label)).toEqual(Array(10).fill('observed'));
    expect(s.report.trials[1]!.attempts[0]!.gap_ms).toBeGreaterThanOrEqual(30_000);
    expect(s.report.trials[0]).toMatchObject({ scoring_attempt_id: s.plan[1]!.attempt_id });
    expect(s.report.trials[0]!.attempts[0]).toMatchObject({ class: 'throttled', ledger_class: 'throttled' });
    expect(s.report.trials[0]!.attempts[0]!.provider_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.report.p3[0]!.inconsistencies).toEqual([]);
    expect(s.report.p3[0]!.throttles).toEqual([expect.objectContaining({ position: 1, attempt: 1, condition: s.trials[0]!.condition })]);
    expect(s.report.p3[0]!.p4).toMatchObject({ claim_basis: 'strict', strict: 'negative', claim: 'not_detected' });
  }, 120_000);

  it('three classified 429s exhaust the pool: the trial is bounded and the next trial follows', async () => {
    const s = await scenario('v52', ['http-429-shared-pool', 'http-429-shared-pool', 'http-429-shared-pool']);
    expect(s.result.stopped).toBeNull();
    expect(s.posts.slice(0, 4)).toEqual([s.plan[0]!.attempt_id, s.plan[1]!.attempt_id, s.plan[2]!.attempt_id, s.plan[3]!.attempt_id]);
    expect(s.requests).toBe(12);
    expect(s.paced.slice(0, 3)).toEqual([60_000, 180_000, 30_000]);
    expect(s.validator).toEqual([]);
    expect(s.report.trials[0]).toMatchObject({ label: 'bounded', pool_exhausted: true });
    expect(s.report.p3[0]!.exhausted_pools).toEqual([s.trials[0]!.slot_id]);
    expect(s.report.p3[0]!.p4.tallies[s.trials[0]!.condition]).toMatchObject({ bounded: 1, incomplete: 0, observed: 4 });
    expect(spent(s.ledger.values())).toBeCloseTo(3 * RESERVATION + 9 * 0.0002, 10);
  }, 120_000);

  it.each([
    ['a 429 that carries a response ID', 'v53', 'http-429-with-response-id' as const, /response ID/],
    ['an OpenRouter-side 429', 'v54', 'http-429-openrouter' as const, /error origin openrouter/],
    ['an upstream 429 with another limit_source', 'v57', 'http-429-other-limit' as const, /limit_source upstream_provider_rate_limit is not in the allowlist/],
  ])('%s is a failure: the study stops with no re-attempt', async (_label, tag, mode, reason) => {
    const s = await scenario(tag, [mode]);
    expect(s.result.stopped).toMatch(/is incomplete: .*not a classified 429/);
    expect(s.result.stopped).toMatch(reason);
    expect(s.posts).toEqual([s.plan[0]!.attempt_id]);
    expect(s.requests).toBe(1);
    expect(s.paced).toEqual([]);
    expect(classOf(s.ledger, s.plan[0]!.attempt_id)).toBe('failed');
    expect(s.report.trials.map((x) => x.label)).toEqual(Array(10).fill('incomplete'));
    expect(s.report.p3[0]!.p4).toMatchObject({ claim: 'incomplete', claim_basis: 'none' });
  }, 120_000);

  it('six classified 429s in a row stop the study on the outage limit; every trial is bounded, the claim is not decided', async () => {
    const s = await scenario('v55', Array(6).fill('http-429-shared-pool'));
    expect(s.result.stopped).toMatch(/outage stop: 6 consecutive classified 429s/);
    expect(s.requests).toBe(6);
    expect(s.posts).toEqual(s.plan.slice(0, 6).map((a) => a.attempt_id));
    expect(s.validator).toEqual([]);
    expect(s.report.trials.map((x) => x.label)).toEqual(Array(10).fill('bounded'));
    expect(s.report.p3[0]!.protocol).toMatchObject({ state: 'stopped', reason: 'throttle_outage' });
    expect(s.report.p3[0]!.p4.claim).toBe('incomplete');
    expect(spent(s.ledger.values())).toBeCloseTo(6 * RESERVATION, 10);
  }, 120_000);

  it('a truncation is imputed and never re-attempted; the next trial follows', async () => {
    const s = await scenario('v56', ['truncate']);
    expect(s.result.stopped).toBeNull();
    expect(s.posts[1]).toBe(s.plan[3]!.attempt_id);
    expect(classOf(s.ledger, s.plan[0]!.attempt_id)).toBe('truncated');
    expect(s.report.trials[0]).toMatchObject({ label: 'imputed' });
    expect(s.report.trial_rows[0]!.imputed).toMatchObject({ verdict: s.trials[0]!.condition === 'with' ? 'no' : 'yes' });
  }, 120_000);
});
