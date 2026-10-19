import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, ExperimentApi } from '../src/experiments/hw2/api.js';
import { CAPS, charge, fits, scheduleFits, spent } from '../src/experiments/hw2/budget.js';
import { assertPaidAuthorization, parseArgs } from '../src/experiments/hw2/cli.js';
import { evaluateSlot, fingerprintsAgree, type FrozenExpectations } from '../src/experiments/hw2/eligibility.js';
import { identityProblems, type StackIdentity } from '../src/experiments/hw2/identity.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { detection, experimentOutcome, matchesRule } from '../src/experiments/hw2/rules.js';
import { reconcile, runSchedule, runSlot, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';
import { buildSchedule } from '../src/experiments/hw2/schedule.js';
import { canonicalJson, sha256 } from '../src/modules/_shared/experiment.js';

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

const analysis = { claimed_purpose: 'x' };
const frozen: FrozenExpectations = {
  providerName: 'DeepInfra',
  model: 'deepseek/deepseek-v4-flash',
  intent: { derivation_id: null, head_sha: 'b502', prompt_version: 3, analysis_sha: sha256(canonicalJson(analysis)) },
  expectedDiffSha256: 'd'.repeat(64),
};
const okAttempt = {
  dispatch: 'dispatched',
  outcome: 'valid',
  servedModel: 'deepseek/deepseek-v4-flash',
  router: { selected: [{ provider: 'DeepInfra', model: 'deepseek/deepseek-v4-flash' }], attempt: 1, attemptsCount: 1 },
  generation: { status: 'found', providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', providerResponses: [{ providerName: 'DeepInfra' }] },
};
const traceWith = (attempt: Record<string, unknown>, patch: Record<string, unknown> = {}, intentPatch: Record<string, unknown> = {}) => ({
  experiment: { dispatch_state: 'completed', diff_sha256: 'd'.repeat(64), attempts: [attempt], ...patch },
  intent: { source: 'cache', status: 'used', derivation_id: null, head_sha: 'b502', prompt_version: 3, analysis, ...intentPatch },
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

  it('is ineligible when the intent, the diff or the outcome is not the frozen one', () => {
    expect(evaluateSlot(traceWith(okAttempt, {}, { source: 'derived' }), frozen).eligible).toBe(false);
    expect(evaluateSlot(traceWith(okAttempt, {}, { analysis: { claimed_purpose: 'other' } }), frozen).eligible).toBe(false);
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
  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  slots = new Map<string, unknown>();
  postError: Error | null = null;
  settle: (slotId: string, runId: string) => unknown = (slotId, runId) => ({
    runs: [{ run_id: runId, status: 'done', cost_usd: 0.0003, experiment: { slot_id: slotId, dispatch_state: 'completed', usage_known: true, attempts: [{ outcome: 'valid' }] } }],
  });
  constructor() {
    super('http://127.0.0.1:1');
  }
  override async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
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
    deps = { api, ledger, log: (m) => logs.push(m), sleep: async () => {}, pollIntervalMs: 0, pollTimeoutMs: 1_000 };
  });
  afterEach(() => {
    ledger.release();
    rmSync(dir, { recursive: true, force: true });
  });

  const slotRun = (id: string, phase: 'exploration' | 'confirmatory' = 'confirmatory', reservationUsd = 0.05): SlotRun => ({
    slot: { slot_id: id, index: 0, phase, experiment: '18', condition: 'with', trial: 1 },
    prId: 'pr',
    agentId: 'agent',
    skillIds: ['skill'],
    manifestFingerprint: 'f'.repeat(64),
    expectedDiffSha256: 'd'.repeat(64),
    reservationUsd,
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

  it('stops on a guard refusal in the confirmatory phase', async () => {
    api.settle = (slotId, runId) => ({ runs: [{ run_id: runId, status: 'failed', cost_usd: 0, experiment: { slot_id: slotId, dispatch_state: 'refused', refusal_reason: 'diff mismatch' } }] });
    const { stopped } = await runSchedule(deps, [slotRun('c-1'), slotRun('c-2')]);
    expect(stopped).toMatch(/guard refusal on c-1: diff mismatch/);
  });
});
