import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, ExperimentApi } from '../src/experiments/hw2/api.js';
import { CAPS, charge, fits, scheduleFits, spent } from '../src/experiments/hw2/budget.js';
import {
  EMPTY_SKILL_FINGERPRINT,
  PHASE0_PAIRS,
  assertPaidAuthorization,
  conditionPreview,
  expectedSkillFingerprint,
  parseArgs,
  phase0Problems,
  writeCapability,
  type ConditionPreview,
} from '../src/experiments/hw2/cli.js';
import { toSkillPromptBlock } from '../src/modules/reviews/helpers.js';
import { buildReport, renderReport, type SlotRunData } from '../src/experiments/hw2/report.js';
import { evaluateSlot, fingerprintsAgree, type FrozenExpectations } from '../src/experiments/hw2/eligibility.js';
import { identityProblems, type StackIdentity } from '../src/experiments/hw2/identity.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { detection, experimentOutcome, matchesRule } from '../src/experiments/hw2/rules.js';
import { describeErrorDetail, reconcile, runSchedule, runSlot, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';
import { buildSchedule } from '../src/experiments/hw2/schedule.js';
import { canonicalJson, capabilityProblem, sha256 } from '../src/modules/_shared/experiment.js';
import { readFileSync, statSync } from 'node:fs';

describe('schedule', () => {
  it('builds 20 unique slots, 5 per experiment and condition, in a balanced interleave', () => {
    const slots = buildSchedule({ seed: 42, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 });
    expect(slots).toHaveLength(20);
    expect(new Set(slots.map((s) => s.slot_id)).size).toBe(20);
    for (const experiment of ['17', '18']) {
      for (const condition of ['with', 'without']) {
        expect(slots.filter((s) => s.experiment === experiment && s.condition === condition)).toHaveLength(5);
      }
    }
    for (let i = 0; i < 20; i += 2) {
      // each adjacent pair is one experiment and trial in both conditions
      expect(slots[i]!.experiment).toBe(slots[i + 1]!.experiment);
      expect(slots[i]!.trial).toBe(slots[i + 1]!.trial);
      expect(slots[i]!.condition).not.toBe(slots[i + 1]!.condition);
    }
  });

  it('is reproducible from its seed and differs between seeds', () => {
    const ids = (seed: number) => buildSchedule({ seed, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }).map((s) => s.slot_id);
    expect(ids(7)).toEqual(ids(7));
    expect(ids(7)).not.toEqual(ids(8));
  });
});

describe('ledger', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'hw2-ledger-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('allows one runner at a time and never steals a lock', () => {
    const first = new Ledger(dir);
    first.acquire({ pid: 1, stackId: 'hw2f-test' });
    expect(() => new Ledger(dir).acquire({ pid: 2, stackId: 'hw2f-test' })).toThrow(/Another runner holds/);
    first.release();
    expect(() => new Ledger(dir).acquire({ pid: 3, stackId: 'hw2f-test' })).not.toThrow();
  });

  it('refuses to append without the lock, and keeps terminal states final', () => {
    const ledger = new Ledger(dir);
    expect(() => ledger.append({ slot_id: 's', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' })).toThrow(/not locked/);
    ledger.acquire({ pid: 1, stackId: 'x' });
    ledger.append({ slot_id: 's', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' });
    expect(ledger.unresolved().map((s) => s.slot_id)).toEqual(['s']);
    ledger.append({ slot_id: 's', phase: 'exploration', reservation_usd: 0.01, state: 'ambiguous' });
    ledger.append({ slot_id: 's', phase: 'exploration', reservation_usd: 0.01, state: 'completed', cost_usd: 0.001 });
    const record = ledger.slots().get('s')!;
    expect(record.state).toBe('ambiguous'); // a later record cannot rewrite a terminal outcome
    expect(record.events).toHaveLength(3);
    expect(ledger.unresolved()).toEqual([]);
  });
});

describe('budget', () => {
  const slot = (state: string, cost: number | null, reservation = 0.05, phase: 'exploration' | 'confirmatory' = 'confirmatory') =>
    ({ slot_id: state, state, phase, reservation_usd: reservation, run_id: null, cost_usd: cost, events: [] }) as never;

  it('charges known costs, nothing for refusals, and the full reservation for anything unknown', () => {
    expect(charge(slot('completed', 0.002))).toBe(0.002);
    expect(charge(slot('failed', 0.001))).toBe(0.001);
    expect(charge(slot('refused', null))).toBe(0);
    expect(charge(slot('completed', null))).toBe(0.05);
    expect(charge(slot('ambiguous', null))).toBe(0.05);
    expect(charge(slot('reserved', null))).toBe(0.05);
    expect(charge(slot('dispatched', null))).toBe(0.05);
  });

  it('enforces the phase and total caps before a reservation', () => {
    const explored = [slot('ambiguous', null, 0.45, 'exploration')];
    expect(fits(explored, 'exploration', 0.05).ok).toBe(true);
    expect(fits(explored, 'exploration', 0.06)).toMatchObject({ ok: false, reason: expect.stringMatching(/exploration budget/) });
    const confirmed = [...Array.from({ length: 19 }, () => slot('ambiguous', null, 0.05)), slot('completed', 0.01)];
    expect(spent(confirmed, 'confirmatory')).toBeCloseTo(0.96);
    expect(fits(confirmed, 'confirmatory', 0.05)).toMatchObject({ ok: false });
    expect(CAPS).toEqual({ exploration: 0.5, confirmatory: 1, total: 1.5 });
  });

  it('requires the whole confirmatory schedule to fit at its worst case', () => {
    expect(scheduleFits(20, 0.05)).toBe(true);
    expect(scheduleFits(20, 0.0501)).toBe(false);
  });
});

const SERVED = 'deepseek/deepseek-v4-flash-20260423';
const frozen: FrozenExpectations = {
  providerName: 'DeepInfra',
  model: 'deepseek/deepseek-v4-flash',
  servedModel: SERVED,
  expectedDiffSha256: 'd'.repeat(64),
};
const okAttempt = {
  dispatch: 'dispatched',
  outcome: 'valid',
  servedModel: 'deepseek/deepseek-v4-flash',
  router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: 1 },
  generation: { status: 'found', providerName: 'DeepInfra', model: SERVED, providerResponses: [{ providerName: 'DeepInfra', modelPermaslug: SERVED, status: 200 }] },
};
const traceWith = (attempt: Record<string, unknown>, patch: Record<string, unknown> = {}) => ({
  experiment: { dispatch_state: 'completed', diff_sha256: 'd'.repeat(64), attempts: [attempt], ...patch },
});

describe('strict single-generation eligibility', () => {
  it('is eligible and verified from both sources when they agree', () => {
    expect(evaluateSlot(traceWith(okAttempt), frozen)).toEqual({ eligible: true, provenance: 'verified', sources: ['router_metadata', 'generation'], reasons: [] });
  });

  it('accepts either source alone, and treats a conflict between them as unverified', () => {
    expect(evaluateSlot(traceWith({ ...okAttempt, generation: { status: 'not_found' } }), frozen)).toMatchObject({ eligible: true, sources: ['router_metadata'] });
    expect(evaluateSlot(traceWith({ ...okAttempt, router: null }), frozen)).toMatchObject({ eligible: true, sources: ['generation'] });
    const conflict = evaluateSlot(traceWith({ ...okAttempt, generation: { ...okAttempt.generation, providerName: 'Novita' } }), frozen);
    expect(conflict).toMatchObject({ eligible: false, provenance: 'unverified' });
  });

  it.each([
    ['no provenance source at all', { ...okAttempt, router: null, generation: { status: 'unavailable' } }],
    ['two selected endpoints', { ...okAttempt, router: { ...okAttempt.router, selected: [okAttempt.router.selected[0], { provider: 'Novita', model: 'm' }] } }],
    ['another provider selected', { ...okAttempt, router: { ...okAttempt.router, selected: [{ provider: 'Novita', model: 'm' }] }, generation: { status: 'not_found' } }],
    ['two router attempts', { ...okAttempt, router: { ...okAttempt.router, attempt: 2 } }],
    ['fallback responses in generation metadata', { ...okAttempt, generation: { ...okAttempt.generation, providerResponses: [{ providerName: 'X' }, { providerName: 'DeepInfra' }] } }],
    ['another served model', { ...okAttempt, servedModel: 'other/model' }],
  ])('is ineligible and unverified with %s', (_label, attempt) => {
    expect(evaluateSlot(traceWith(attempt), frozen)).toMatchObject({ eligible: false, provenance: 'unverified' });
  });

  it('names a missing provenance source as the reason (the report shows reasons)', () => {
    const verdict = evaluateSlot(traceWith({ ...okAttempt, router: null, generation: { status: 'unavailable' } }), frozen);
    expect(verdict.reasons).toContain('no source established the serving provider');
    expect(verdict.sources).toEqual([]);
  });

  it('is ineligible when the diff or the outcome is not the frozen one', () => {
    expect(evaluateSlot(traceWith(okAttempt, { diff_sha256: 'e'.repeat(64) }), frozen).eligible).toBe(false);
    expect(evaluateSlot(traceWith({ ...okAttempt, outcome: 'schema_invalid' }), frozen).eligible).toBe(false);
    expect(evaluateSlot(traceWith(okAttempt, { attempts: [okAttempt, okAttempt] }), frozen).eligible).toBe(false);
  });

  it('requires one non-Skill fingerprint across a set', () => {
    expect(fingerprintsAgree([{ non_skill_fingerprint: 'a' }, { non_skill_fingerprint: 'a' }])).toBe(true);
    expect(fingerprintsAgree([{ non_skill_fingerprint: 'a' }, { non_skill_fingerprint: 'b' }])).toBe(false);
    expect(fingerprintsAgree([{ non_skill_fingerprint: null }])).toBe(false);
  });
});

describe('expected-finding rules', () => {
  const rule = { anchors: [{ file: 'src/api/payments.ts', start_line: 18, end_line: 18 }], keywords: ['breaking', 'backward[- ]?compat'] };
  const finding = (patch = {}) => ({ file: 'src/api/payments.ts', start_line: 17, end_line: 19, title: 'Breaking change to v1 response', rationale: 'Clients read amount_cents.', ...patch });

  it('needs the anchor and a keyword', () => {
    expect(matchesRule(finding(), rule)).toBe(true);
    expect(matchesRule(finding({ file: 'src/other.ts' }), rule)).toBe(false);
    expect(matchesRule(finding({ start_line: 30, end_line: 31 }), rule)).toBe(false);
    expect(matchesRule(finding({ title: 'Style nit', rationale: 'rename variable' }), rule)).toBe(false);
    expect(detection([finding(), finding({ title: 'nit', rationale: 'x' })], rule)).toEqual({ detected: true, matched: ['Breaking change to v1 response'] });
  });

  it('applies the pre-registered success rule', () => {
    expect(experimentOutcome(5, 5, 0, 5)).toBe('success');
    expect(experimentOutcome(4, 5, 1, 5)).toBe('success');
    expect(experimentOutcome(4, 5, 2, 5)).toBe('inconclusive');
    expect(experimentOutcome(3, 5, 3, 5)).toBe('negative');
    expect(experimentOutcome(5, 4, 0, 5)).toBe('incomplete');
  });
});

describe('stack identity', () => {
  const identity: StackIdentity = {
    stack_id: 'hw2f-abcd1234',
    database: 'devdigest_hw2f_abcd1234',
    database_is_disposable: true,
    repos: ['acme/payments-api'],
    fixture_pulls: [501, 502],
    demo_pr_3_present: false,
    fixture_clone_present: false,
    provider: 'deepinfra',
    provider_name: null,
    model: 'm',
    max_output_tokens: 4000,
    in_flight_slot: null,
    secrets_path: '/home/op/.devdigest/hw2-experiments/secrets.json',
    openrouter_key_configured: false,
  };
  const labels = { 'devdigest.disposable': 'true', 'devdigest.stack-id': 'hw2f-abcd1234', 'devdigest.database': 'devdigest_hw2f_abcd1234' };
  const expected = { stackId: 'hw2f-abcd1234', database: 'devdigest_hw2f_abcd1234', container: 'c', apiUrl: 'http://127.0.0.1:3251' };

  it('passes only when every identity fact agrees', () => {
    expect(identityProblems(identity, labels, expected)).toEqual([]);
  });

  it.each([
    ['another stack id', { ...identity, stack_id: 'hw2f-other' }, labels, expected],
    ['the dev database', { ...identity, database: 'devdigest', database_is_disposable: false }, labels, expected],
    ['another repository', { ...identity, repos: ['acme/payments-api', 'me/real'] }, labels, expected],
    ['demo PR #3', { ...identity, demo_pr_3_present: true }, labels, expected],
    ['a fixture clone', { ...identity, fixture_clone_present: true }, labels, expected],
    ['a missing fixture PR', { ...identity, fixture_pulls: [501] }, labels, expected],
    ['an unlabelled container', identity, {}, expected],
    ['a development API port', identity, labels, { ...expected, apiUrl: 'http://127.0.0.1:3001' }],
    ['a non-loopback API', identity, labels, { ...expected, apiUrl: 'http://10.0.0.5:3251' }],
    ['the everyday key file', { ...identity, secrets_path: '/home/op/.devdigest/secrets.json' }, labels, expected],
  ])('fails closed on %s', (_label, id, lbl, exp) => {
    expect(identityProblems(id as StackIdentity, lbl as Record<string, string>, exp).length).toBeGreaterThan(0);
  });
});

describe('paid-run authorization flags', () => {
  it('needs the phase gate and an explicit spend confirmation', () => {
    expect(() => assertPaidAuthorization(parseArgs(['run', '--phase', 'exploration']).flags)).toThrow(/authorized-gate/);
    expect(() => assertPaidAuthorization(parseArgs(['run', '--phase', 'confirmatory', '--authorized-gate', '3', '--confirm-spend']).flags)).toThrow(/needs Gate 4/);
    expect(() => assertPaidAuthorization(parseArgs(['run', '--phase', 'exploration', '--authorized-gate', '3']).flags)).toThrow(/confirm-spend/);
    expect(assertPaidAuthorization(parseArgs(['run', '--phase', 'exploration', '--authorized-gate', '3', '--confirm-spend']).flags)).toBe('exploration');
  });
});

/** In-memory stand-in for the disposable API. */
class FakeApi extends ExperimentApi {
  calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  slots = new Map<string, unknown>();
  postError: Error | null = null;
  settle: (slotId: string, runId: string) => unknown = (slotId, runId) => ({
    runs: [{ run_id: runId, status: 'done', cost_usd: 0.0003, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: true, attempts: [{ outcome: 'valid' }] } }],
  });
  constructor() {
    super('http://127.0.0.1:1');
  }
  override async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    this.calls.push({ method, path, body, headers });
    if (method === 'POST' && path === '/experiments/runs') {
      if (this.postError) throw this.postError;
      const slotId = (body as { slot_id: string }).slot_id;
      const runId = `run-${slotId}`;
      this.slots.set(slotId, this.settle(slotId, runId));
      return { run_id: runId, slot_id: slotId } as T;
    }
    if (method === 'GET' && path.startsWith('/experiments/slots/')) {
      return (this.slots.get(path.split('/').pop()!) ?? { runs: [] }) as T;
    }
    return {} as T;
  }
}

describe('runner orchestration (fake API, no network)', () => {
  let dir: string;
  let ledger: Ledger;
  let api: FakeApi;
  let deps: RunnerDeps;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hw2-run-'));
    ledger = new Ledger(dir);
    ledger.acquire({ pid: 1, stackId: 'hw2f-test' });
    api = new FakeApi();
    deps = { api, ledger, log: (m) => logs.push(m), capabilityToken: 'tok-123', sleep: async () => {}, pollIntervalMs: 0, pollTimeoutMs: 1_000 };
  });
  afterEach(() => {
    ledger.release();
    rmSync(dir, { recursive: true, force: true });
  });

  const slotRun = (id: string, phase: 'exploration' | 'confirmatory' = 'confirmatory', reservationUsd = 0.05, expected: string | null = null): SlotRun => ({
    slot: { slot_id: id, index: 0, phase, experiment: '18', condition: 'with', trial: 1 },
    prId: 'pr',
    agentId: 'agent',
    skillIds: ['skill'],
    manifestFingerprint: 'f'.repeat(64),
    expectedDiffSha256: 'd'.repeat(64),
    reservationUsd,
    expectedNonSkillFingerprint: expected,
  });

  it('reserves on disk before the request, sets the condition, posts once and records the known cost', async () => {
    const result = await runSlot(deps, slotRun('c-18-with-1'));
    expect(result).toMatchObject({ state: 'completed', costUsd: 0.0003, infraFailure: false });
    expect(ledger.slots().get('c-18-with-1')!.events.map((e) => e.state)).toEqual(['reserved', 'dispatched', 'completed']);
    const order = api.calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(order).toEqual(['/agents/agent/skills', '/experiments/runs']);
    expect(api.calls.find((c) => c.path === '/agents/agent/skills')!.body).toEqual({ skill_ids: ['skill'] });
  });

  it('never replays a slot already in the ledger', async () => {
    await runSlot(deps, slotRun('c-18-with-1'));
    await expect(runSlot(deps, slotRun('c-18-with-1'))).rejects.toThrow(/never replayed/);
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(1);
  });

  it('a 4xx refusal costs nothing; a network failure on the request is ambiguous and charged in full', async () => {
    api.postError = new ApiError(422, null, 'refused');
    expect(await runSlot(deps, slotRun('c-18-with-1'))).toMatchObject({ state: 'refused', costUsd: 0 });
    api.postError = new Error('ECONNRESET');
    expect(await runSlot(deps, slotRun('c-18-with-2'))).toMatchObject({ state: 'ambiguous', costUsd: null, infraFailure: true });
    expect(spent(ledger.slots().values())).toBeCloseTo(0.05);
  });

  it('a run that never settles (its terminal record was never persisted) is ambiguous at the runner deadline: full reservation, no replay, and a late record cannot rewrite it', async () => {
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'running', cost_usd: null, experiment: { slot_id: slotId, dispatch_state: 'dispatching' } }] });
    deps = { ...deps, pollTimeoutMs: 50 };
    expect(await runSlot(deps, slotRun('c-18-with-1'))).toMatchObject({ state: 'ambiguous', costUsd: null, reason: 'poll timeout', infraFailure: true });
    expect(spent(ledger.slots().values())).toBeCloseTo(0.05);
    await expect(runSlot(deps, slotRun('c-18-with-1'))).rejects.toThrow(/never replayed/);
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(1);
    api.slots.set('c-18-with-1', { runs: [{ run_id: 'run-c-18-with-1', status: 'done', cost_usd: 0.0002, experiment: { dispatch_state: 'completed', usage_known: true } }] });
    await reconcile(deps);
    expect(ledger.slots().get('c-18-with-1')).toMatchObject({ state: 'ambiguous' });
    expect(spent(ledger.slots().values())).toBeCloseTo(0.05);
  });

  it('a run that settles before the runner deadline is recorded with its outcome, however long it took', async () => {
    let polls = 0;
    api.settle = (slotId, runId) => ({ get runs() {
      polls++;
      return polls < 5
        ? [{ run_id: runId, status: 'running', cost_usd: null, experiment: { slot_id: slotId, dispatch_state: 'dispatching' } }]
        : [{ run_id: runId, status: 'done', cost_usd: 0.0004, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: true, attempts: [{ outcome: 'valid' }] } }];
    } });
    expect(await runSlot(deps, slotRun('c-18-with-1'))).toMatchObject({ state: 'completed', costUsd: 0.0004 });
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(1);
  });

  it('reconciles a crashed runner: a settled slot is recorded, an unknown one becomes ambiguous', async () => {
    ledger.append({ slot_id: 'c-18-with-1', phase: 'confirmatory', reservation_usd: 0.05, state: 'dispatched', run_id: 'run-a' });
    ledger.append({ slot_id: 'c-18-without-1', phase: 'confirmatory', reservation_usd: 0.05, state: 'reserved' });
    api.slots.set('c-18-with-1', { runs: [{ run_id: 'run-a', status: 'done', cost_usd: 0.0002, experiment: { dispatch_state: 'completed', usage_known: true } }] });
    await expect(runSchedule(deps, [slotRun('c-18-with-2')])).rejects.toThrow(/Reconcile first/);
    await reconcile(deps);
    expect(ledger.slots().get('c-18-with-1')).toMatchObject({ state: 'completed', cost_usd: 0.0002 });
    expect(ledger.slots().get('c-18-without-1')).toMatchObject({ state: 'ambiguous' });
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(0); // reconciliation never posts
  });

  it('stops after two consecutive slots with unknown cost', async () => {
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'done', cost_usd: null, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: false } }] });
    const { results, stopped } = await runSchedule(deps, [slotRun('a-1'), slotRun('a-2'), slotRun('a-3')]);
    expect(results).toHaveLength(2);
    expect(stopped).toMatch(/2 consecutive slots with unknown cost/);
  });

  it('stops before a reservation that does not fit the budget, without posting', async () => {
    // The first slot is charged its known cost ($0.25): $0.25 + a $0.30 reservation exceeds the $0.50 exploration cap.
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'done', cost_usd: 0.25, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: true } }] });
    const { results, stopped } = await runSchedule(deps, [slotRun('x-1', 'exploration', 0.3), slotRun('x-2', 'exploration', 0.3)]);
    expect(results.map((r) => r.state)).toEqual(['completed', 'refused']);
    expect(stopped).toMatch(/exploration budget/);
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(1);
  });

  it('a failed slot charges its reservation, is never retried, and the log line carries the sanitized diagnosis', async () => {
    const errorDetail = {
      origin: 'upstream_provider', code: 429, message: 'Provider returned error', errorType: 'rate_limit_exceeded',
      providerCode: 'rate_limited', providerName: 'DeepInfra', limitSource: null, upstreamRawPresent: true,
      requestId: 'req_1', retryAfter: '20', rateLimit: {}, redacted: false,
    };
    api.settle = (slotId, runId) => ({
      runs: [{ run_id: runId, status: 'failed', cost_usd: null, experiment: { slot_id: slotId, dispatch_state: 'failed', usage_known: false, refusal_reason: '429 Provider returned error', attempts: [{ outcome: 'http_error', errorDetail }] } }],
    });
    logs.length = 0;
    const { results, stopped } = await runSchedule(deps, [slotRun('x-18-without-1', 'exploration', 0.01)]);
    expect(results).toMatchObject([{ state: 'failed', costUsd: null, infraFailure: true }]);
    expect(stopped).toBeNull();
    expect(spent(ledger.slots().values(), 'exploration')).toBeCloseTo(0.01); // unknown cost: the full reservation
    expect(api.calls.filter((c) => c.path === '/experiments/runs')).toHaveLength(1);
    expect(logs).toContain(
      'x-18-without-1: failed — 429 Provider returned error (origin upstream_provider, provider DeepInfra, error_type rate_limit_exceeded, provider_code rate_limited, retry-after 20, request req_1)',
    );
    expect(describeErrorDetail(null)).toBeNull();
  });

  it('stops on a guard refusal in the confirmatory phase', async () => {
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'failed', cost_usd: 0, experiment: { slot_id: slotId, dispatch_state: 'refused', refusal_reason: 'diff mismatch' } }] });
    const { stopped } = await runSchedule(deps, [slotRun('c-1'), slotRun('c-2')]);
    expect(stopped).toMatch(/guard refusal on c-1: diff mismatch/);
  });
});

describe('runner: capability header and frozen fingerprint', () => {
  let dir: string;
  let ledger: Ledger;
  let api: FakeApi;
  let deps: RunnerDeps;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hw2-fp-'));
    ledger = new Ledger(dir);
    ledger.acquire({ pid: 1, stackId: 'hw2f-test' });
    api = new FakeApi();
    deps = { api, ledger, log: () => {}, capabilityToken: 'tok-123', sleep: async () => {}, pollIntervalMs: 0, pollTimeoutMs: 1_000 };
  });
  afterEach(() => {
    ledger.release();
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (id: string, expected: string | null): SlotRun => ({
    slot: { slot_id: id, index: 0, phase: 'confirmatory', experiment: '18', condition: 'with', trial: 1 },
    prId: 'pr', agentId: 'agent', skillIds: [], manifestFingerprint: 'f'.repeat(64), expectedDiffSha256: 'd'.repeat(64), reservationUsd: 0.05,
    expectedNonSkillFingerprint: expected,
  });

  it('sends the capability token, the phase and the frozen fingerprint with every slot', async () => {
    await runSlot(deps, run('c-1', 'a'.repeat(64)));
    const post = api.calls.find((c) => c.path === '/experiments/runs')!;
    expect(post.headers).toMatchObject({ 'x-hw2-capability': 'tok-123' });
    expect(post.body).toMatchObject({ phase: 'confirmatory', expected_non_skill_fingerprint: 'a'.repeat(64) });
  });

  it('stops when a settled run does not reproduce the frozen non-Skill fingerprint', async () => {
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'done', cost_usd: 0.0002, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: true, non_skill_fingerprint: 'b'.repeat(64) } }] });
    const { stopped, results } = await runSchedule(deps, [run('c-1', 'a'.repeat(64)), run('c-2', 'a'.repeat(64))]);
    expect(results).toHaveLength(1);
    expect(stopped).toMatch(/did not reproduce the frozen non-Skill fingerprint/);
  });
});

describe('strict single-attempt proof (negative cases)', () => {
  const routerOnly = (router: Record<string, unknown>) => ({ ...okAttempt, router, generation: { status: 'not_found' } });
  it.each([
    ['router attempt and attempts both missing', routerOnly({ selected: okAttempt.router.selected, attempt: null, attemptsCount: null })],
    ['router attempts count missing', routerOnly({ selected: okAttempt.router.selected, attempt: 1, attemptsCount: null })],
    ['router attempt number missing', routerOnly({ selected: okAttempt.router.selected, attempt: null, attemptsCount: 1 })],
    ['empty generation provider responses and no router metadata', { ...okAttempt, router: null, generation: { ...okAttempt.generation, providerResponses: [] } }],
    ['missing generation provider responses and no router metadata', { ...okAttempt, router: null, generation: { status: 'found', providerName: 'DeepInfra', model: SERVED } }],
  ])('is ineligible when %s', (_label, attempt) => {
    const verdict = evaluateSlot(traceWith(attempt), frozen);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/single upstream attempt is not proven/);
  });

  it('accepts a single attempt proven by either source alone', () => {
    expect(evaluateSlot(traceWith(routerOnly(okAttempt.router)), frozen).eligible).toBe(true);
    expect(evaluateSlot(traceWith({ ...okAttempt, router: null }), frozen).eligible).toBe(true);
  });
});

describe('experiment report', () => {
  const schedule = buildSchedule({ seed: 3, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }).map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  const rules = {
    '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 4, end_line: 8 }], keywords: ['edge|error|expired|unknown'] },
    '18': { anchors: [{ file: 'src/api/payments.ts', start_line: 18, end_line: 18 }], keywords: ['breaking'] },
  };
  const frozenNonSkill = { '17': 'f17'.padEnd(64, '0'), '18': 'f18'.padEnd(64, '0') };
  const fixtures = {
    '17': { reviewer: 'Test Quality Reviewer', prNumber: 501, targetSkill: 'Edge Cases and Error Paths' },
    '18': { reviewer: 'API Contract Reviewer', prNumber: 502, targetSkill: 'breaking-change' },
  } as const;
  const skillBlock = (experiment: '17' | '18') => `### ${fixtures[experiment].targetSkill}\nthe rule`;
  const MANIFEST = 'm'.repeat(64);
  const execution = {
    manifestFingerprint: MANIFEST,
    phase: 'confirmatory' as const,
    fixture: (experiment: string) => fixtures[experiment as '17' | '18'],
    skillFingerprint: (experiment: string, condition: 'with' | 'without') =>
      sha256(canonicalJson(condition === 'with' ? [skillBlock(experiment as '17' | '18')] : [])),
  };
  const hit = { '17': { file: 'src/billing/discount.test.ts', start_line: 5, end_line: 7, title: 'Unknown and expired coupons untested', rationale: 'error paths' }, '18': { file: 'src/api/payments.ts', start_line: 18, end_line: 18, title: 'Breaking change to v1 response', rationale: 'clients break' } };
  const nit = { file: 'x.ts', start_line: 1, end_line: 1, title: 'Style nit', rationale: 'naming' };

  /** What a correct run of `slot` persists. */
  const runFor = (slot: { slot_id: string; experiment: string; condition: 'with' | 'without' }, detected: boolean): SlotRunData => {
    const experiment = slot.experiment as '17' | '18';
    return {
      run_id: `run-${slot.slot_id}`,
      cost_usd: 0.0002,
      experiment: {
        ...traceWith(okAttempt).experiment,
        slot_id: slot.slot_id,
        experiment,
        condition: slot.condition,
        phase: 'confirmatory',
        manifest_fingerprint: MANIFEST,
        non_skill_fingerprint: frozenNonSkill[experiment],
        skill_fingerprint: execution.skillFingerprint(experiment, slot.condition),
      },
      config: { agent: fixtures[experiment].reviewer, pr: fixtures[experiment].prNumber },
      skills_block: slot.condition === 'with' ? `<untrusted source="skill-0">\n${skillBlock(experiment)}\n</untrusted>` : null,
      findings: detected ? [hit[experiment], nit] : [nit],
    };
  };
  const report = (runs: Map<string, SlotRunData | null>) =>
    buildReport({ schedule, ledger: new Map(), runs, rules, frozenNonSkill, expectations: () => frozen, execution });
  const allRuns = (detected: (slot: (typeof schedule)[number]) => boolean, tweak?: (slot: (typeof schedule)[number], run: SlotRunData) => SlotRunData) => {
    const runs = new Map<string, SlotRunData | null>();
    for (const slot of schedule) {
      const run = runFor(slot, detected(slot));
      runs.set(slot.slot_id, tweak ? tweak(slot, run) : run);
    }
    return runs;
  };

  it('lists every scheduled slot, including slots never dispatched', () => {
    const result = report(new Map());
    expect(result.rows).toHaveLength(20);
    expect(result.rows.every((r) => r.state === 'not dispatched' && !r.counted)).toBe(true);
    expect(result.summaries.map((s) => s.outcome)).toEqual(['incomplete', 'incomplete']);
    expect(renderReport(result)).toContain('not dispatched');
  });

  it('applies the frozen rules to the actual findings and the pre-registered success rule', () => {
    const result = report(allRuns((slot) => slot.condition === 'with' || slot.experiment === '18'));
    const byExp = Object.fromEntries(result.summaries.map((s) => [s.experiment, s]));
    expect(byExp['17']).toMatchObject({ with: { counted: 5, detected: 5 }, without: { counted: 5, detected: 0 }, outcome: 'success', fingerprints_agree: true });
    expect(byExp['18']).toMatchObject({ with: { detected: 5 }, without: { detected: 5 }, outcome: 'negative' });
    const row = result.rows.find((r) => r.experiment === '18')!;
    expect(row.finding_titles).toEqual(['Breaking change to v1 response', 'Style nit']);
    expect(row.matched).toEqual([{ title: 'Breaking change to v1 response', file: 'src/api/payments.ts', lines: '18-18' }]);
    expect(renderReport(result)).toContain('Breaking change to v1 response (src/api/payments.ts:18-18)');
  });

  it('marks an experiment invalid when an otherwise eligible slot does not reproduce the frozen fingerprint', () => {
    const first = schedule[0]!;
    const result = report(allRuns(() => true, (slot, run) => (slot === first ? { ...run, experiment: { ...run.experiment, non_skill_fingerprint: 'x'.repeat(64) } } : run)));
    expect(result.summaries.find((s) => s.experiment === first.experiment)).toMatchObject({ outcome: 'invalid', fingerprints_agree: false });
    expect(result.rows[0]).toMatchObject({ counted: false, fingerprint_ok: false });
  });

  it('does not count ineligible slots (e.g. unproven single attempt)', () => {
    const result = report(
      allRuns(() => true, (_slot, run) => ({ ...run, experiment: { ...run.experiment, attempts: [{ ...okAttempt, router: { ...okAttempt.router, attemptsCount: null }, generation: { status: 'not_found' } }] } })),
    );
    expect(result.rows.every((r) => !r.counted)).toBe(true);
    expect(result.summaries.every((s) => s.outcome === 'incomplete')).toBe(true);
  });

  describe('never infers what ran from the scheduled label', () => {
    const withSlot = schedule.find((s) => s.condition === 'with')!;
    const withoutSlot = schedule.find((s) => s.condition === 'without' && s.experiment === withSlot.experiment)!;
    const broken = (target: (typeof schedule)[number], change: (run: SlotRunData) => SlotRunData) => {
      const result = report(allRuns(() => true, (slot, run) => (slot === target ? change(run) : run)));
      const row = result.rows.find((r) => r.slot_id === target.slot_id)!;
      const summary = result.summaries.find((s) => s.experiment === target.experiment)!;
      return { row, summary, rendered: renderReport(result) };
    };

    it.each([
      ['a mislabeled condition', withSlot, (run: SlotRunData) => ({ ...run, experiment: { ...run.experiment, condition: 'without' } }), /trace condition is "without", expected "with"/],
      ['a mismatched manifest', withSlot, (run: SlotRunData) => ({ ...run, experiment: { ...run.experiment, manifest_fingerprint: 'z'.repeat(64) } }), /trace manifest_fingerprint/],
      ['a swapped slot (the trace belongs to another slot)', withSlot, (run: SlotRunData) => ({ ...run, experiment: { ...run.experiment, slot_id: withoutSlot.slot_id } }), /trace slot_id is ".*", expected/],
      ['the wrong phase', withSlot, (run: SlotRunData) => ({ ...run, experiment: { ...run.experiment, phase: 'exploration' } }), /trace phase/],
      ['the wrong reviewer', withSlot, (run: SlotRunData) => ({ ...run, config: { ...run.config, agent: 'General Reviewer' } }), /trace reviewer/],
      ['the wrong fixture PR', withSlot, (run: SlotRunData) => ({ ...run, config: { ...run.config, pr: 482 } }), /trace fixture PR/],
      ['a skill attached to a "without" slot', withoutSlot, (run: SlotRunData) => ({ ...run, skills_block: `<untrusted source="skill-0">\n### other\nx\n</untrusted>` }), /"without" slot sent 1 skill/],
      ['two skills on a "with" slot', withSlot, (run: SlotRunData) => ({ ...run, skills_block: `${run.skills_block}\n\n<untrusted source="skill-1">\n### Behavioral Coverage\nx\n</untrusted>` }), /sent 2 skills instead of exactly the target skill/],
      ['another skill instead of the target', withSlot, (run: SlotRunData) => ({ ...run, skills_block: `<untrusted source="skill-0">\n### Behavioral Coverage\nx\n</untrusted>` }), /not the target skill/],
      ['an unexpected Skill fingerprint', withSlot, (run: SlotRunData) => ({ ...run, experiment: { ...run.experiment, skill_fingerprint: 'q'.repeat(64) } }), /trace skill_fingerprint/],
    ])('%s makes the slot ineligible and the experiment invalid, with the reason', (_label, target, change, reason) => {
      const { row, summary, rendered } = broken(target, change);
      expect(row.counted).toBe(false);
      expect(row.execution_issues.join(' ')).toMatch(reason);
      expect(summary.outcome).toBe('invalid');
      expect(summary.note).toMatch(new RegExp(target.slot_id));
      expect(rendered).toMatch(reason);
    });
  });
});

describe('spending capability', () => {
  let home: string;
  beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'hw2-cap-'))));
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const now = new Date('2026-10-19T12:00:00Z');

  it('stores only the token hash, with 0600 files, and validates for its own stack and phase', () => {
    const capability = writeCapability({ stackId: 'hw2f-abcd', phase: 'exploration', budgetUsd: 0.5, hours: 2, home, now });
    const dir = join(home, '.devdigest', 'hw2-experiments', 'hw2f-abcd');
    const token = readFileSync(join(dir, 'capability.token'), 'utf8');
    expect(JSON.stringify(capability)).not.toContain(token);
    expect(statSync(join(dir, 'capability.token')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'capability.json')).mode & 0o777).toBe(0o600);
    const ok = { stackId: 'hw2f-abcd', phase: 'exploration' as const, token, now };
    expect(capabilityProblem(capability, ok)).toBeNull();
    expect(capabilityProblem(capability, { ...ok, phase: 'confirmatory' })).toMatch(/authorizes the exploration phase/);
    expect(capabilityProblem(capability, { ...ok, stackId: 'hw2f-other' })).toMatch(/is for stack/);
    expect(capabilityProblem(capability, { ...ok, token: 'wrong' })).toMatch(/does not match/);
    expect(capabilityProblem(capability, { ...ok, token: undefined })).toMatch(/no capability token/);
    expect(capabilityProblem(capability, { ...ok, now: new Date('2026-10-19T15:00:00Z') })).toMatch(/expired/);
    expect(capabilityProblem(null, ok)).toMatch(/no spending capability/);
    expect(capabilityProblem({ ...capability, gate: 4 }, ok)).toMatch(/needs Gate 3/);
    expect(capabilityProblem({ ...capability, budget_usd: 0.6 }, ok)).toMatch(/at most \$0.5/);
  });

  it('refuses a budget above the phase cap or an excessive lifetime', () => {
    expect(() => writeCapability({ stackId: 'hw2f-abcd', phase: 'confirmatory', budgetUsd: 1.01, hours: 2, home, now })).toThrow(/at most \$1/);
    expect(() => writeCapability({ stackId: 'hw2f-abcd', phase: 'exploration', budgetUsd: 0.1, hours: 100, home, now })).toThrow(/hours/);
  });
});

/** A stand-in for the stack's API: links per agent, and a preview whose Skill fingerprint follows the links, as the server's does. */
class FakePreviewApi extends ExperimentApi {
  links = new Map<string, string[]>([
    ['tqr', ['s-behavior', 's-edge']],
    ['api', ['s-break']],
  ]);
  previews: Array<{ condition: string; links: string[] }> = [];
  mode: 'faithful' | 'ignore-link-writes' | 'skill-always' | 'wrong-skill' | 'throw' = 'faithful';
  static readonly skills = [
    { id: 's-behavior', name: 'Behavioral Coverage', body: 'b' },
    { id: 's-edge', name: 'Edge Cases and Error Paths', body: 'e' },
    { id: 's-break', name: 'breaking-change', body: 'k' },
  ];
  constructor() {
    super('http://127.0.0.1:1');
  }
  override async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const reply = (value: unknown) => value as T;
    if (method === 'GET' && path === '/repos') return reply([{ id: 'repo', full_name: 'acme/payments-api' }]);
    if (method === 'GET' && path === '/repos/repo/pulls') return reply([{ id: 'pr501', number: 501 }, { id: 'pr502', number: 502 }]);
    if (method === 'GET' && path === '/agents') {
      return reply([
        { id: 'tqr', name: 'Test Quality Reviewer', system_prompt: 'p', model: 'm', strategy: 'single-pass', repo_intel: false },
        { id: 'api', name: 'API Contract Reviewer', system_prompt: 'p', model: 'm', strategy: 'single-pass', repo_intel: false },
      ]);
    }
    if (method === 'GET' && path === '/skills') return reply(FakePreviewApi.skills);
    const linksPath = /^\/agents\/([^/]+)\/skills$/.exec(path);
    if (linksPath && method === 'GET') return reply((this.links.get(linksPath[1]!) ?? []).map((id) => ({ skill_id: id })));
    if (linksPath && method === 'POST') {
      const ids = (body as { skill_ids: string[] }).skill_ids;
      const restoring = ids.length > 1 || this.previews.length > 0;
      if (this.mode !== 'ignore-link-writes' || restoring) this.links.set(linksPath[1]!, [...ids]);
      return reply([]);
    }
    if (method === 'POST' && path === '/experiments/preview') {
      const { agent_id, condition } = body as { agent_id: string; condition: string };
      const current = this.links.get(agent_id) ?? [];
      this.previews.push({ condition, links: current });
      if (this.mode === 'throw') throw new ApiError(500, null, 'preview failed');
      // The server hashes the linked skills' prompt blocks (requestFingerprints).
      const blocks = (this.mode === 'wrong-skill' ? ['s-behavior'] : current).map((id) => toSkillPromptBlock(FakePreviewApi.skills.find((s) => s.id === id)!));
      const skill = this.mode === 'skill-always' ? sha256('a forced skill') : sha256(canonicalJson(blocks));
      return reply({
        ok: true,
        reason: null,
        block: {
          non_skill_fingerprint: sha256(`non-Skill request of ${agent_id}`),
          skill_fingerprint: skill,
          preflight: { input_upper_bound: 9000 + 500 * current.length, output_cap: 16000, price_input_per_token: 9e-8, price_output_per_token: 1.8e-7, price_source: 'fake', worst_case_usd: 0.006 },
        },
      });
    }
    throw new Error(`unexpected ${method} ${path}`);
  }
}

describe('condition-faithful preview (runner `preview` command, fake API)', () => {
  it('previews "with" on exactly the target skill, then restores the original links', async () => {
    const api = new FakePreviewApi();
    const result = await conditionPreview(api, { experiment: '17', condition: 'with', reservationUsd: 0.02 });
    expect(api.previews).toEqual([{ condition: 'with', links: ['s-edge'] }]);
    expect(result).toMatchObject({ ok: true, problems: [], reviewer: 'Test Quality Reviewer', linked_skills: ['Edge Cases and Error Paths'], worst_case_usd: 0.006 });
    expect(result.skill_fingerprint).toBe(expectedSkillFingerprint('with', { name: 'Edge Cases and Error Paths', body: 'e' }));
    expect(result.skill_fingerprint).toBe(result.expected_skill_fingerprint);
    expect(api.links.get('tqr')).toEqual(['s-behavior', 's-edge']); // restored
  });

  it('previews "without" on no skills, then restores the original links', async () => {
    const api = new FakePreviewApi();
    const result = await conditionPreview(api, { experiment: '18', condition: 'without', reservationUsd: 0.02 });
    expect(api.previews).toEqual([{ condition: 'without', links: [] }]);
    expect(result).toMatchObject({ ok: true, linked_skills: [], skill_fingerprint: EMPTY_SKILL_FINGERPRINT });
    expect(api.links.get('api')).toEqual(['s-break']);
  });

  it('restores the original links even when the preview fails', async () => {
    const api = new FakePreviewApi();
    api.mode = 'throw';
    await expect(conditionPreview(api, { experiment: '17', condition: 'without', reservationUsd: 0.02 })).rejects.toThrow(/preview failed/);
    expect(api.links.get('tqr')).toEqual(['s-behavior', 's-edge']);
  });

  it('fails closed when the links did not take, or the Skill fingerprint contradicts the condition', async () => {
    const stuck = new FakePreviewApi();
    stuck.mode = 'ignore-link-writes';
    const notApplied = await conditionPreview(stuck, { experiment: '17', condition: 'with', reservationUsd: 0.02 });
    expect(notApplied.ok).toBe(false);
    expect(notApplied.problems.join(' ')).toMatch(/linked skills are \[Behavioral Coverage, Edge Cases and Error Paths\], expected \[Edge Cases and Error Paths\]/);

    const contradicting = new FakePreviewApi();
    contradicting.mode = 'skill-always';
    const wrong = await conditionPreview(contradicting, { experiment: '17', condition: 'without', reservationUsd: 0.02 });
    expect(wrong.ok).toBe(false);
    expect(wrong.problems).toContain('a without preview carried a Skill');
  });

  it('fails closed when a "with" preview carries a Skill, but not the target alone', async () => {
    // Non-empty is not enough: the fingerprint must be the target skill's block.
    const other = new FakePreviewApi();
    other.mode = 'wrong-skill';
    const wrong = await conditionPreview(other, { experiment: '17', condition: 'with', reservationUsd: 0.02 });
    expect(wrong.skill_fingerprint).not.toBe(EMPTY_SKILL_FINGERPRINT);
    expect(wrong.ok).toBe(false);
    expect(wrong.problems).toContain('the Skill fingerprint is not that of Edge Cases and Error Paths alone');

    const forced = new FakePreviewApi();
    forced.mode = 'skill-always';
    const arbitrary = await conditionPreview(forced, { experiment: '18', condition: 'with', reservationUsd: 0.02 });
    expect(arbitrary.ok).toBe(false);
    expect(arbitrary.problems).toContain('the Skill fingerprint is not that of breaking-change alone');
  });

  it('rejects an unknown condition or experiment before touching any link', async () => {
    const api = new FakePreviewApi();
    await expect(conditionPreview(api, { experiment: '17', condition: 'maybe', reservationUsd: 0.02 })).rejects.toThrow(/--condition/);
    await expect(conditionPreview(api, { experiment: '99', condition: 'with', reservationUsd: 0.02 })).rejects.toThrow(/--experiment/);
    expect(api.previews).toEqual([]);
  });
});

describe('Phase 0 check over the four saved previews (`phase0-check`)', () => {
  const approved = { reservationUsd: 0.01, outputCap: 16000 };
  const targets = {
    '17': { name: 'Edge Cases and Error Paths', body: 'e' },
    '18': { name: 'breaking-change', body: 'k' },
  };
  const fourPreviews = async (): Promise<Record<string, ConditionPreview>> => {
    const out: Record<string, ConditionPreview> = {};
    for (const pair of PHASE0_PAIRS) {
      const [experiment, condition] = pair.split('-') as [string, string];
      out[pair] = await conditionPreview(new FakePreviewApi(), { experiment, condition, reservationUsd: 0.01 });
    }
    return out;
  };

  it('passes four faithful previews at the approved reservation and cap', async () => {
    const previews = await fourPreviews();
    expect(phase0Problems(previews, { ...approved, targets })).toEqual([]);
  });

  type Mutation = (previews: Record<string, ConditionPreview>) => void;
  const otherSkill = expectedSkillFingerprint('with', { name: 'Behavioral Coverage', body: 'b' });
  it.each<[string, Mutation, RegExp]>([
    ['non-Skill fingerprints differ within an experiment', (p) => (p['17-without']!.non_skill_fingerprint = 'f'.repeat(64)), /experiment 17: non-Skill fingerprints differ between with/],
    ['a with preview carries another skill', (p) => (p['17-with']!.skill_fingerprint = otherSkill), /17-with: Skill fingerprint .* is not the expected Edge Cases and Error Paths alone/],
    ['a with preview carries an arbitrary non-empty fingerprint', (p) => (p['18-with']!.skill_fingerprint = 'a'.repeat(64)), /18-with: Skill fingerprint .* is not the expected breaking-change alone/],
    ['a without preview carries a Skill', (p) => (p['18-without']!.skill_fingerprint = p['18-with']!.skill_fingerprint), /18-without: Skill fingerprint .* is not the expected no Skills/],
    ['a with preview carries no Skill', (p) => (p['17-with']!.skill_fingerprint = EMPTY_SKILL_FINGERPRINT), /17-with: Skill fingerprint .* is not the expected/],
    ['a preview is missing', (p) => delete p['17-without'], /17-without: no saved preview/],
    ['a file holds another pair', (p) => (p['18-with'] = { ...p['17-with']! }), /18-with: holds the preview of 17 \/ with/],
    ['the links are not the condition\'s', (p) => (p['17-with']!.linked_skills = ['Behavioral Coverage', 'Edge Cases and Error Paths']), /17-with: linked skills/],
    ['a preview at another reservation', (p) => (p['18-with']!.reservation_usd = 0.05), /18-with: previewed at reservation 0.05, not 0.01/],
    ['a preview at another cap', (p) => (p['17-without']!.output_cap = 4000), /17-without: output cap 4000, not 16000/],
    ['a refused preview', (p) => Object.assign(p['18-without']!, { ok: false, problems: ['the preview was refused: x'] }), /18-without: not ok/],
    ['no non-Skill fingerprint, even when both are equal', (p) => { p['18-with']!.non_skill_fingerprint = null; p['18-without']!.non_skill_fingerprint = null; }, /18-with: no non-Skill fingerprint/],
    ['the worst case outgrows the reservation', (p) => (p['17-with']!.worst_case_usd = 0.009), /1\.2 × the largest worst case \(\$0\.010800\) exceeds the reservation \$0\.01/],
  ])('fails when %s', async (_label, mutate, problem) => {
    const previews = await fourPreviews();
    mutate(previews);
    const problems = phase0Problems(previews, { ...approved, targets });
    expect(problems.join('\n')).toMatch(problem);
  });

  it('fails when the target skill is missing on the stack or its body changed', async () => {
    const previews = await fourPreviews();
    expect(phase0Problems(previews, { ...approved, targets: { '18': targets['18'] } }).join('\n')).toMatch(/17-with: target skill Edge Cases and Error Paths not found/);
    const edited = { ...targets, '17': { name: 'Edge Cases and Error Paths', body: 'e, edited' } };
    expect(phase0Problems(previews, { ...approved, targets: edited }).join('\n')).toMatch(/17-with: Skill fingerprint .* is not the expected/);
  });
});
