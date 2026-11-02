/**
 * Study v5 (#17): the P3 attempt pool in the manifest, the runner, the report
 * and the adjudication. Hermetic: a fake API, temporary ledgers and a fake
 * clock; nothing is dispatched to any provider.
 *
 * Mutation record (rerun by hand: apply one change, run this file, expect at
 * least one failure, revert). Each was checked on 2026-11-02:
 *   1. classification allowlist: accept any limit_source
 *      (`!classification.limit_sources.includes(detail.limitSource)` → false), attempt-policy.ts;
 *   2. response-ID check dropped (`if (present(a.responseId)) …` removed);
 *   3. usage check dropped (`present(a.tokensIn) || present(a.tokensOut) || present(a.costUsd)` → false);
 *   4. pool cap K: `attempt.attempt < per` → `attempt.attempt < per - 1` in `protocolNext`
 *      (`<= per` is an equivalent mutation: after aK, `plan_index + 1` is the next trial's a1);
 *   5. total cap M: drop `if (steps.length >= cap) return { … 'attempt_cap' … }` in `protocolNext`;
 *   6. outage stop: drop the `streak >= limit` stop in `protocolNext`;
 *   7. pacing: never call `pace(planned.delay_before_ms)` in `runAttemptPool`;
 *   8. unknown-cost exception scoping: `exemptFromUnknownCostStop` → `() => true`
 *      (exempts every attempt) and, separately, → `() => false` (counts 429s too);
 *   9. restart consistency: the `traceProblems(…, { prefix: true })` result in
 *      `attemptHistory` → `[]` (accept any recorded history);
 *  10. restart: drop the "trial ID is in the ledger" refusal in `attemptHistory`;
 *  11. classification: drop the frozen-provider check on a 429's `providerName`;
 *  12. P4: ignore blockers (`const blocked = blockers.length > 0` → false).
 * The DB-backed hw2-study-v5-runner.it.test.ts also fails on 1, 2, 4, 6, 7 and 8b.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExperimentApi } from '../src/experiments/hw2/api.js';
import {
  P3_ATTEMPT_POLICY_V5,
  attemptPlan,
  maxStudyAttempts,
  modelPacing,
  modelPolicy,
  p4Result,
  parseAttemptId,
  protocolNext,
  throttleProblems,
  type AttemptPolicyP3,
  type AttemptRunView,
} from '../src/experiments/hw2/attempt-policy.js';
import { preparePacketV2, reveal, sealJudgment, TECHNICAL_RULES, type Judgment, type P3TrialEntry } from '../src/experiments/hw2/adjudication.js';
import { main as adjudicationMain } from '../src/experiments/hw2/adjudication-cli.js';
import { attemptReservationTotal, authorize, main, studyFromFlags, type Stack } from '../src/experiments/hw2/cli.js';
import type { FrozenExpectations } from '../src/experiments/hw2/eligibility.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import {
  STUDY_V4,
  STUDY_V5,
  buildManifestV4,
  buildManifestV5,
  deriveSeed,
  manifestFingerprint,
  readFrozen,
  scheduleFor,
  seedProblems,
  studySemantics,
  type ManifestInput,
  type ManifestV5,
  type StudySemantics,
} from '../src/experiments/hw2/manifest.js';
import { buildP3Report, renderP3Report } from '../src/experiments/hw2/report-p3.js';
import type { SlotRunData } from '../src/experiments/hw2/report.js';
import { exemptFromUnknownCostStop, reconcile, runAttemptPool, runSchedule, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';
import { mulberry32, type Slot } from '../src/experiments/hw2/schedule.js';
import { repoRoot } from '../src/experiments/hw2/source.js';
import { execute, fromSequence, traceProblems, type AttemptOutcome } from '../src/experiments/hw2/throttle-policy.js';
import { canonicalJson, sha256 } from '../src/modules/_shared/experiment.js';

// ------------------------------------------------------------------ fixtures

const agent = (id: string, name: string) => ({ id, name, enabled: true, provider: 'openrouter', system_prompt: `${name} instructions`, output_schema: null, model: 'deepseek/deepseek-v4-flash', strategy: 'single-pass', repo_intel: false });
const skill = (id: string, name: string) => ({ id, name, body: `${name} body`, enabled: true, approval: { status: 'approved', approved_version: 1 } });
function input<S>(study: S): Omit<ManifestInput, 'schedule'> & { study: S } {
  return {
    study,
    implementationFingerprint: 'impl',
    nonSkillFingerprints: { '17': 'n17', '18': 'n18' },
    stack: { database: 'devdigest_hw2f_test', provider: 'deepinfra/fp8', providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', servedModel: 'deepseek/deepseek-v4-flash-20260423', maxOutputTokens: 8000, prices: { input: 0.00000009, output: 0.00000018, request: 0 }, generationLookup: null },
    skills: [skill('s-2', 'breaking-change'), skill('s-1', 'Edge Cases and Error Paths')],
    agents: [agent('a-2', 'API Contract Reviewer'), agent('a-1', 'Test Quality Reviewer')],
    rules: { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 1, end_line: 8 }], keywords: ['expir'] }, '18': { anchors: [{ file: 'src/api/payments.ts', start_line: 18, end_line: 18 }], keywords: ['break'] } },
    perSlotReservationUsd: 0.005,
  };
}

const V5 = studySemantics({ version: 5, study: STUDY_V5 });
const V4 = studySemantics({ version: 4, study: STUDY_V4 });
const SERVED = 'deepseek/deepseek-v4-flash-20260423';
const EXPECT: FrozenExpectations = { providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', servedModel: SERVED, expectedDiffSha256: 'd'.repeat(64) };
const NON_SKILL = 'n'.repeat(64);
const MANIFEST = 'f'.repeat(64);
const BLOCK = '### Edge Cases and Error Paths\nthe rule';
const skillFingerprint = (condition: 'with' | 'without') => sha256(canonicalJson(condition === 'with' ? [BLOCK] : []));
const RULES = { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 4, end_line: 8 }], keywords: ['expired'] } };

const valid = (extra: Record<string, unknown> = {}) => ({
  dispatch: 'dispatched', outcome: 'valid', httpStatus: 200, servedModel: 'deepseek/deepseek-v4-flash', responseId: 'gen-1', tokensIn: 1000, tokensOut: 1400, costUsd: 0.0004,
  router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: 1 },
  generation: { status: 'found', providerName: 'DeepInfra', model: SERVED, providerResponses: [{ providerName: 'DeepInfra', modelPermaslug: SERVED, status: 200 }] },
  ...extra,
});
/** The v4 `c-v4-17-with-2` 429, as its trace recorded it (structured fields only). */
const http429 = (detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  dispatch: 'dispatched', outcome: 'http_error', httpStatus: 429, servedModel: null, responseId: null, generationIdHeader: null,
  tokensIn: null, tokensOut: null, costUsd: null, router: null, generation: null, startedAt: '2026-11-03T00:00:00.000Z',
  errorDetail: { origin: 'upstream_provider', code: 429, message: 'Provider returned error', errorType: null, providerCode: null, providerName: 'DeepInfra', limitSource: 'upstream_provider_shared_pool', upstreamRawPresent: true, requestId: null, retryAfter: null, rateLimit: {}, redacted: false, ...detail },
  ...extra,
});

interface Outcome {
  dispatch_state: 'completed' | 'failed';
  usage_known: boolean;
  cost: number | null;
  attempts: unknown[];
  detected?: boolean;
  non_skill_fingerprint?: string;
}
const OBS: Outcome = { dispatch_state: 'completed', usage_known: true, cost: 0.0004, attempts: [valid()], detected: false };
const HIT: Outcome = { ...OBS, detected: true };
const T429: Outcome = { dispatch_state: 'failed', usage_known: false, cost: null, attempts: [http429()] };
const TRUNC: Outcome = { dispatch_state: 'failed', usage_known: true, cost: 0.0015, attempts: [valid({ outcome: 'truncated' })] };
const FAIL500: Outcome = { dispatch_state: 'failed', usage_known: false, cost: null, attempts: [http429({ origin: 'unattributed', providerName: null, limitSource: null }, { httpStatus: 500 })] };
const NO_PROVENANCE: Outcome = { ...OBS, attempts: [valid({ router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: null }, generation: { status: 'not_found', providerResponses: [] } })] };
const WITH_ID: Outcome = { ...T429, attempts: [http429({}, { responseId: 'gen-429' })] };
const OPENROUTER_429: Outcome = { ...T429, attempts: [http429({ origin: 'openrouter', providerName: null, limitSource: 'openrouter_key_limit' })] };

/** The slot view the fake stack returns for one attempt: the runner's lookup and the report's run data. */
function lookup(slotId: string, condition: 'with' | 'without', o: Outcome) {
  return {
    runs: [{
      run_id: `run-${slotId}`, status: o.dispatch_state === 'completed' ? 'done' : 'failed', cost_usd: o.cost,
      experiment: {
        slot_id: slotId, experiment: '17', condition, phase: 'confirmatory', manifest_fingerprint: MANIFEST,
        dispatch_state: o.dispatch_state, usage_known: o.usage_known, diff_sha256: 'd'.repeat(64),
        non_skill_fingerprint: o.non_skill_fingerprint ?? NON_SKILL, skill_fingerprint: skillFingerprint(condition), refusal_reason: null, attempts: o.attempts,
      },
      config: { agent: 'Test Quality Reviewer', pr: 501 },
      skills_block: condition === 'with' ? `<untrusted source="skill-0">\n${BLOCK}\n</untrusted>` : null,
      prompt_evidence: 'dispatched_request',
      findings: o.dispatch_state === 'completed'
        ? [{ file: 'src/billing/discount.test.ts', start_line: 5, end_line: 6, title: o.detected ? 'Expired coupon untested' : 'Naming', rationale: o.detected ? 'expired' : 'style' }]
        : [],
    }],
  };
}

/** In-memory stand-in for the disposable API: each POST takes the next scripted outcome. */
class FakeApi extends ExperimentApi {
  posts: string[] = [];
  slots = new Map<string, ReturnType<typeof lookup>>();
  script: Outcome[] = [];
  constructor() {
    super('http://127.0.0.1:1');
  }
  override async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method === 'POST' && path === '/experiments/runs') {
      const b = body as { slot_id: string; condition: 'with' | 'without' };
      this.posts.push(b.slot_id);
      const next = this.script.shift();
      if (!next) throw new Error(`script exhausted at ${b.slot_id}`);
      this.slots.set(b.slot_id, lookup(b.slot_id, b.condition, next));
      return { run_id: `run-${b.slot_id}`, slot_id: b.slot_id } as T;
    }
    if (method === 'GET' && path.startsWith('/experiments/slots/')) return (this.slots.get(path.split('/').pop()!) ?? { runs: [] }) as T;
    if (method === 'GET' && path === '/agents/agent/skills') return [] as T;
    return {} as T;
  }
}

const SEED = 4242;
const TRIALS = scheduleFor(V5, SEED);
const trialRuns = (semantics: StudySemantics = V5, trials: Slot[] = TRIALS): SlotRun[] =>
  trials.map((slot) => ({
    slot, prId: 'pr', agentId: 'agent', skillIds: slot.condition === 'with' ? ['skill'] : [], manifestFingerprint: MANIFEST,
    expectedDiffSha256: 'd'.repeat(64), reservationUsd: 0.005, expectedNonSkillFingerprint: NON_SKILL, semantics, expectations: EXPECT,
  }));
const withPolicy = (policy: AttemptPolicyP3): StudySemantics => ({ ...V5, attemptPolicy: policy });

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'hw2-v5-run-'));
  let tick = Date.parse('2026-11-03T00:00:00.000Z');
  const ledger = new Ledger(dir, () => new Date((tick += 1000)));
  ledger.acquire({ pid: 1, stackId: 'hw2f-test' });
  const api = new FakeApi();
  const paced: number[] = [];
  const logs: string[] = [];
  const deps: RunnerDeps = {
    api, ledger, log: (m) => logs.push(m), capabilityToken: 'tok', sleep: async () => {}, pollIntervalMs: 0, pollTimeoutMs: 1_000,
    pacingSleep: async (ms) => { paced.push(ms); },
  };
  return { dir, ledger, api, paced, logs, deps, done: () => { ledger.release(); rmSync(dir, { recursive: true, force: true }); } };
}
type Harness = ReturnType<typeof harness>;

// ------------------------------------------------------------------ manifest

describe('v5 manifest: the P3 policy frozen into the fingerprint', () => {
  it('freezes the owner-approved policy, zero warm-ups, P4, and all 30 attempt IDs with their delays', async () => {
    const m = await buildManifestV5(input(STUDY_V5));
    expect(m.version).toBe(5);
    expect(m.study).toEqual({
      id: 'itemb-v5', slot_tag: 'v5', experiments: ['17'], per_condition: 5, truncation: 'continue-impute', truncation_provenance: 'single-router-attempt',
      adjudication_packet: 2, redaction: 'r1', reporting: 'p4', warmups: 0,
      attempt_policy: {
        kind: 'p3', attempts_per_trial: 3, max_total_attempts: 30, outage_consecutive_429: 6,
        pacing_s: { between_trials: 30, before_a2: 60, before_a3: 180 },
        throttle_classification: { http_status: 429, origin: 'upstream_provider', limit_sources: ['upstream_provider_shared_pool'] },
      },
    });
    expect(m.fixtures.map((f) => f.number)).toEqual([501]);
    expect(m.schedule.slots).toHaveLength(10);
    expect(m.schedule.attempts).toHaveLength(30);
    expect(m.schedule.attempts.every((a) => /^c-v5-17-(with|without)-[1-5]-a[1-3]$/.test(a.attempt_id))).toBe(true);
    expect(m.schedule.attempts.slice(0, 6).map((a) => [a.attempt_id.slice(-2), a.delay_before_s])).toEqual([['a1', 0], ['a2', 60], ['a3', 180], ['a1', 30], ['a2', 60], ['a3', 180]]);
    expect(m.schedule.attempts.map((a) => a.trial_id)).toEqual(m.schedule.slots.flatMap((s) => [s.slot_id, s.slot_id, s.slot_id]));
    expect(new Set(m.schedule.attempts.map((a) => a.attempt_id)).size).toBe(30);
  });

  it('derives a fresh seed the v4 way, from the study ID and the manifest without its schedule', async () => {
    const m = await buildManifestV5(input(STUDY_V5));
    const { schedule: _s, ...body } = m;
    const basis = sha256(canonicalJson(body));
    expect(m.schedule.seed_derivation.basis_fingerprint).toBe(basis);
    expect(m.schedule.seed).toBe(deriveSeed('itemb-v5', basis));
    const v4 = await buildManifestV4(input(STUDY_V4));
    expect(m.schedule.seed).not.toBe(v4.schedule.seed);
    expect(seedProblems(m)).toEqual([]);
    expect(m.schedule.slots.map((s) => s.slot_id)).toEqual(scheduleFor(V5, m.schedule.seed).map((s) => s.slot_id));
  });

  it('names an edited attempt plan, and refuses an edited policy block', async () => {
    const m = await buildManifestV5(input(STUDY_V5));
    const swapped = [...m.schedule.attempts];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(seedProblems({ ...m, schedule: { ...m.schedule, attempts: swapped } })).toEqual(['the attempt plan is not the one the frozen policy and the derived schedule build']);
    expect(seedProblems({ ...m, schedule: { ...m.schedule, attempts: m.schedule.attempts.slice(0, 29) } })).toHaveLength(1);
    const edited = { ...STUDY_V5, attempt_policy: { ...STUDY_V5.attempt_policy, max_total_attempts: 31 } };
    await expect(buildManifestV5(input(edited))).rejects.toThrow(/version 5 manifest must carry a known study block exactly/);
    const allowAny = { ...STUDY_V5, attempt_policy: { ...STUDY_V5.attempt_policy, throttle_classification: { ...STUDY_V5.attempt_policy.throttle_classification, limit_sources: ['upstream_provider_shared_pool', 'openrouter_key_limit'] } } };
    await expect(buildManifestV5(input(allowAny))).rejects.toThrow(/known study block exactly/);
    await expect(buildManifestV5(input(STUDY_V4 as never))).rejects.toThrow(/version 5 manifest must carry a known study block/);
    await expect(buildManifestV4(input(STUDY_V5))).rejects.toThrow(/version 4 manifest must carry a known study block/);
  });

  it('version 5 semantics carry the policy; version 4 semantics are exactly as before', () => {
    expect(V5).toMatchObject({ version: 5, slotTag: 'v5', experiments: ['17'], truncation: 'continue-impute', adjudicationPacket: 2, reporting: 'p4' });
    expect(V5.attemptPolicy).toBe(P3_ATTEMPT_POLICY_V5);
    expect(V4).toEqual({ version: 4, slotTag: 'v4', experiments: ['17'], perCondition: 5, truncation: 'continue-impute', truncationProvenance: 'single-router-attempt', adjudicationPacket: 2, redaction: 'r1' });
    expect('attemptPolicy' in V4).toBe(false);
  });

  it('`--study v5 --experiments 17` selects exactly the v5 block', () => {
    expect(studyFromFlags({ study: 'v5', experiments: '17' })).toBe(STUDY_V5);
    expect(studyFromFlags({ study: 'v4', experiments: '17' })).toBe(STUDY_V4);
    expect(() => studyFromFlags({ study: 'v5', experiments: '17', seed: '1' })).toThrow(/drop --seed/);
  });
});

describe('v3 and v4 are unchanged (regression)', () => {
  it('the committed v4 pre-registration still reads, with its fingerprint, seed, schedule and semantics', () => {
    const root = repoRoot(__dirname);
    const frozen = readFrozen(resolve(root, 'docs/homework/L02/prereg/manifest-20261101-v4.json'), root);
    expect(frozen.version).toBe(4);
    // The fingerprint and seed recorded in evidence/item-b-v4-confirmatory/README.md.
    expect(manifestFingerprint(frozen)).toBe('3ab26d81c66e0776620a1f7bef1263ae843c12d45d7fb89d7e5a26ade363a60a');
    expect(frozen.schedule.seed).toBe(4284451045);
    expect(frozen.schedule.slots).toHaveLength(10);
    expect('attempts' in frozen.schedule).toBe(false);
    if (frozen.version === 4) expect(seedProblems(frozen)).toEqual([]);
    expect(studySemantics(frozen)).toEqual(V4);
  });

  it('buildManifestV4 output is byte-identical to the pre-v5 implementation (fingerprint pinned at 2ddc8bb)', async () => {
    expect(manifestFingerprint(await buildManifestV4(input(STUDY_V4)))).toBe('37ae9d59f751287bc650cab69df62abeb8bde18ed17cf92c1d647ab3fe3933d4');
  });

  it('runSchedule refuses v5 trials; a v4 run of a fully classified shared-pool 429 still stops with no p3 record', async () => {
    const h = harness();
    try {
      await expect(runSchedule(h.deps, trialRuns())).rejects.toThrow(/runs only through runAttemptPool/);
      const v4Runs = trialRuns(V4).map((r, i) => ({ ...r, slot: { ...r.slot, slot_id: `c-v4-17-${r.slot.condition}-${i + 1}` } }));
      h.api.script = [T429, OBS];
      const { stopped } = await runSchedule(h.deps, v4Runs);
      expect(stopped).toMatch(/is incomplete/);
      expect(h.api.posts).toHaveLength(1);
      const record = h.ledger.slots().get(h.api.posts[0]!)!;
      expect(record.events.at(-1)!.detail).toEqual({ fingerprint_mismatch: false });
      expect(record.events[0]!.detail).not.toHaveProperty('p3_attempt');
      expect(h.paced).toEqual([]);
    } finally {
      h.done();
    }
  });
});

// ------------------------------------------------------------------ classification

describe('strict 429 classification (structured fields only)', () => {
  const cls = P3_ATTEMPT_POLICY_V5.throttle_classification;
  const view = (attempt: Record<string, unknown>, patch: Record<string, unknown> = {}, cost: number | null = null): AttemptRunView =>
    ({ status: 'failed', cost_usd: cost, experiment: { dispatch_state: 'failed', usage_known: false, attempts: [attempt], ...patch } }) as AttemptRunView;

  it('accepts the recorded v4 shared-pool 429 shape', () => {
    expect(throttleProblems(view(http429()), cls, EXPECT)).toEqual([]);
  });

  it.each([
    ['another HTTP status', http429({}, { httpStatus: 503 }), /HTTP status 503/],
    ['a status given as text', http429({}, { httpStatus: '429' }), /HTTP status 429, not 429/],
    ['a response ID', http429({}, { responseId: 'gen-x' }), /response ID/],
    ['a generation ID header', http429({}, { generationIdHeader: 'gen-x' }), /generation ID/],
    ['reported input tokens', http429({}, { tokensIn: 900 }), /usage or cost/],
    ['a reported cost', http429({}, { costUsd: 0.0001 }), /usage or cost/],
    ['a found generation record', http429({}, { generation: { status: 'found', totalCost: 0.0001 } }), /generation record/],
    ['an OpenRouter-side limit', http429({ origin: 'openrouter', providerName: null, limitSource: 'openrouter_key_limit' }), /error origin openrouter.*limit_source openrouter_key_limit is not in the allowlist/],
    ['another upstream limit_source', http429({ limitSource: 'upstream_provider_rate_limit' }), /not in the allowlist/],
    ['no limit_source', http429({ limitSource: null }), /limit_source missing/],
    ['an unattributed body', http429({ origin: 'unattributed', providerName: null }), /error origin unattributed/],
    ['another provider', http429({ providerName: 'Novita' }), /names provider Novita/],
    ['a local refusal', http429({}, { dispatch: 'refused' }), /did not reach the provider/],
    ['a network error', http429({}, { outcome: 'network_error', httpStatus: null }), /network_error/],
    ['no error detail', http429({}, { errorDetail: null }), /no structured error detail/],
    // Only structured fields count: the allowlisted text in the message is ignored.
    ['the allowlisted words only in the message', http429({ limitSource: null, message: 'limit_source upstream_provider_shared_pool' }), /limit_source missing/],
  ])('refuses %s', (_label, attempt, problem) => {
    const problems = throttleProblems(view(attempt), cls, EXPECT);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('; ')).toMatch(problem);
  });

  it('refuses a run that reports usage, a cost, two attempts, or a completed state', () => {
    expect(throttleProblems(view(http429(), { usage_known: true }), cls, EXPECT).join()).toMatch(/usage is reported as known/);
    expect(throttleProblems(view(http429(), {}, 0.0001), cls, EXPECT).join()).toMatch(/reports a cost/);
    expect(throttleProblems({ cost_usd: null, experiment: { dispatch_state: 'failed', attempts: [http429(), http429()] } } as AttemptRunView, cls, EXPECT).join()).toMatch(/exactly one attempt/);
    expect(throttleProblems(view(http429(), { dispatch_state: 'completed' }), cls, EXPECT).join()).toMatch(/dispatch_state completed/);
    expect(throttleProblems(view(http429()), cls, null).join()).toMatch(/no frozen provider/);
    expect(throttleProblems(null, cls, EXPECT)).toEqual(['no experiment block']);
  });

  it('the unknown-cost exception covers classified 429s only', () => {
    expect(exemptFromUnknownCostStop({ p3: { class: 'throttled', reasons: [] } })).toBe(true);
    for (const c of ['observed', 'truncated', 'failed'] as const) expect(exemptFromUnknownCostStop({ p3: { class: c, reasons: [] } })).toBe(false);
    expect(exemptFromUnknownCostStop({})).toBe(false);
  });

  it('parses attempt IDs; a trial ID is not one', () => {
    expect(parseAttemptId('c-v5-17-with-3-a2')).toEqual({ tag: 'v5', experiment: '17', condition: 'with', trial: 3, attempt: 2, trial_id: 'c-v5-17-with-3' });
    expect(parseAttemptId('c-v5-17-with-3')).toBeNull();
    expect(parseAttemptId('c-v4-17-with-3')).toBeNull();
  });
});

// ------------------------------------------------------------------ runner

/** Run the pool over a script; returns the harness for assertions (caller cleans up). */
async function pool(script: Outcome[], semantics: StudySemantics = V5, h: Harness = harness()) {
  h.api.script = [...script];
  const result = await runAttemptPool(h.deps, STUDY_V5, trialRuns(semantics));
  return { h, result };
}
const plan = attemptPlan(TRIALS, P3_ATTEMPT_POLICY_V5);
const ids = (trial: number, ...attempts: number[]) => attempts.map((k) => plan[trial * 3 + k - 1]!.attempt_id);

describe('runAttemptPool: the P3 protocol on a fake stack', () => {
  let h: Harness | null = null;
  afterEach(() => { h?.done(); h = null; });

  it('ten observations: ten a1 attempts, 30 s between trials, each with its own reservation and recorded times', async () => {
    const run = await pool(Array(10).fill(OBS));
    h = run.h;
    expect(run.result.stopped).toBeNull();
    expect(run.result.state).toEqual({ kind: 'done' });
    expect(h.api.posts).toEqual(TRIALS.map((t) => `${t.slot_id}-a1`));
    expect(h.paced).toEqual(Array(9).fill(30_000));
    const record = h.ledger.slots().get(h.api.posts[0]!)!;
    expect(record.events.map((e) => e.state)).toEqual(['reserved', 'dispatched', 'completed']);
    expect(record.events[0]!.reservation_usd).toBe(0.005);
    expect(record.events[0]!.detail).toMatchObject({ p3_attempt: { study_id: 'itemb-v5', trial_id: TRIALS[0]!.slot_id, attempt: 1, plan_index: 0, delay_before_ms: 0 } });
    expect(record.events[2]!.detail).toMatchObject({ fingerprint_mismatch: false, p3: { class: 'observed', reasons: [] } });
    expect(record.events.map((e) => e.at)).toEqual(['2026-11-03T00:00:01.000Z', '2026-11-03T00:00:02.000Z', '2026-11-03T00:00:03.000Z']);
  });

  it('a classified 429 arms the same trial\'s next attempt after its predeclared delay; observation ends the trial', async () => {
    const run = await pool([T429, T429, OBS, ...Array(9).fill(OBS)]);
    h = run.h;
    expect(run.result.stopped).toBeNull();
    expect(h.api.posts.slice(0, 4)).toEqual([...ids(0, 1, 2, 3), ...ids(1, 1)]);
    expect(h.paced.slice(0, 3)).toEqual([60_000, 180_000, 30_000]);
    expect(h.api.posts).toHaveLength(12);
    // Two classified 429s in a row did not trip the consecutive unknown-cost (2) or infrastructure (3) stops.
    expect(h.ledger.slots().get(ids(0, 1)[0]!)!.events.at(-1)!.detail).toMatchObject({ p3: { class: 'throttled' } });
  });

  it('pool exhaustion: three classified 429s leave the trial missing and the next trial follows', async () => {
    const run = await pool([OBS, T429, T429, T429, ...Array(8).fill(OBS)]);
    h = run.h;
    expect(run.result.stopped).toBeNull();
    expect(h.api.posts).toEqual([...ids(0, 1), ...ids(1, 1, 2, 3), ...[2, 3, 4, 5, 6, 7, 8, 9].flatMap((t) => ids(t, 1))]);
    expect(h.api.posts).not.toContain(`${TRIALS[1]!.slot_id}-a4`);
    expect(h.paced.slice(0, 4)).toEqual([30_000, 60_000, 180_000, 30_000]);
    expect(h.logs.join('\n')).toMatch(new RegExp(`${TRIALS[1]!.slot_id}: pool exhausted`));
  });

  it('outage stop: six classified 429s in a row, across trials, stop the study', async () => {
    const run = await pool(Array(7).fill(T429));
    h = run.h;
    expect(h.api.posts).toEqual([...ids(0, 1, 2, 3), ...ids(1, 1, 2, 3)]);
    expect(run.result.stopped).toMatch(/outage stop: 6 consecutive classified 429s/);
    expect(run.result.state).toMatchObject({ kind: 'stopped', reason: 'throttle_outage', attempt_id: ids(1, 3)[0] });
    expect(h.api.script).toHaveLength(1); // the seventh was never requested
  });

  it('any response resets the outage streak', async () => {
    const run = await pool([T429, T429, OBS, T429, T429, T429, T429, T429, OBS, ...Array(7).fill(OBS)]);
    h = run.h;
    expect(run.result.stopped).toBeNull();
    expect(h.api.posts).toHaveLength(16);
  });

  it.each([
    ['a truncation (imputed, never re-attempted)', TRUNC, null],
    ['an observation', OBS, null],
  ])('no re-attempt after %s', async (_label, first) => {
    const run = await pool([first, ...Array(9).fill(OBS)]);
    h = run.h;
    expect(h.api.posts[1]).toBe(ids(1, 1)[0]);
    expect(h.api.posts.filter((id) => id.startsWith(TRIALS[0]!.slot_id))).toEqual(ids(0, 1));
  });

  it.each([
    ['an HTTP 500', FAIL500, /not a classified 429: HTTP status 500/],
    ['a 429 with a response ID', WITH_ID, /response ID/],
    ['an OpenRouter-side 429', OPENROUTER_429, /error origin openrouter/],
    ['a provenance gap on a completed attempt', NO_PROVENANCE, /single upstream attempt is not proven/],
    ['a 429 on a2 that carries usage', null, /usage or cost/],
  ])('stops, with no re-attempt, on %s', async (_label, outcome, reason) => {
    const script = outcome ? [outcome, OBS] : [T429, { ...T429, attempts: [http429({}, { tokensIn: 10 })] }, OBS];
    const run = await pool(script);
    h = run.h;
    expect(run.result.stopped).toMatch(/confirmatory attempt .* is incomplete/);
    expect(run.result.stopped).toMatch(reason);
    expect(h.api.posts).toHaveLength(outcome ? 1 : 2);
    expect(h.api.script).toHaveLength(1);
  });

  it('a fingerprint mismatch stops the study', async () => {
    const run = await pool([{ ...T429, non_skill_fingerprint: 'x'.repeat(64) }, OBS]);
    h = run.h;
    expect(run.result.stopped).toMatch(/did not reproduce the frozen non-Skill fingerprint/);
  });

  it('the total cap M stops the study when it binds (a test-only policy with M = 4)', async () => {
    const run = await pool([OBS, T429, T429, OBS, OBS], withPolicy({ ...P3_ATTEMPT_POLICY_V5, max_total_attempts: 4 }));
    h = run.h;
    expect(h.api.posts).toHaveLength(4);
    expect(run.result.stopped).toMatch(/attempt cap: 4 attempts used/);
  });

  it('pacing depends only on the plan: both conditions get the same delays at the same places', async () => {
    const run = await pool([T429, OBS, T429, OBS, ...Array(8).fill(OBS)]);
    h = run.h;
    const expected = h.api.posts.map((id) => plan.find((a) => a.attempt_id === id)!.delay_before_ms).filter((ms) => ms > 0);
    expect(h.paced).toEqual(expected);
    expect(h.paced.slice(0, 4)).toEqual([60_000, 30_000, 60_000, 30_000]);
    expect(new Set([TRIALS[0]!.condition, TRIALS[1]!.condition])).toEqual(new Set(['with', 'without']));
  });

  it('matches the pure model (`execute`) and passes its validator, over 40 seeded outcome sequences', async () => {
    const kinds = (r: () => number): Outcome => {
      const x = r();
      return x < 0.4 ? T429 : x < 0.45 ? TRUNC : x < 0.48 ? FAIL500 : OBS;
    };
    for (let seed = 1; seed <= 40; seed++) {
      const random = mulberry32(seed);
      const script = Array.from({ length: 30 }, () => kinds(random));
      const asModel = script.map((o): AttemptOutcome => (o === T429 ? { kind: 'throttled' } : o === TRUNC ? { kind: 'truncated', eligible: true } : o === FAIL500 ? { kind: 'failed' } : { kind: 'observed', detected: false }));
      const model = execute(TRIALS, modelPolicy(P3_ATTEMPT_POLICY_V5), fromSequence(asModel), modelPacing(P3_ATTEMPT_POLICY_V5));
      const run = await pool(script);
      try {
        expect(run.h.api.posts).toEqual(model.steps.map((s) => s.attempt.attempt_id));
        const delayOf = (id: string) => (run.h.ledger.slots().get(id)!.events[0]!.detail!.p3_attempt as { delay_before_ms: number }).delay_before_ms;
        const trace = run.h.api.posts.map((id, i) => ({ attempt_id: id, outcome: asModel[i]!, delay_before_ms: delayOf(id) }));
        expect(traceProblems(TRIALS, modelPolicy(P3_ATTEMPT_POLICY_V5), trace, modelPacing(P3_ATTEMPT_POLICY_V5))).toEqual([]);
        expect(run.result.state?.kind === 'done').toBe(model.stopped === null);
      } finally {
        run.h.done();
      }
    }
  }, 60_000);
});

describe('runAttemptPool: restart and reconciliation', () => {
  let h: Harness;
  beforeEach(() => (h = harness()));
  afterEach(() => h.done());

  it('a runner stopped between attempts continues deterministically, never reusing an attempt ID', async () => {
    h.api.script = [OBS, T429, T429, OBS, ...Array(8).fill(OBS)];
    let calls = 0;
    const crashing = { ...h.deps, pacingSleep: async (ms: number) => { h.paced.push(ms); if (++calls === 3) throw new Error('process killed'); } };
    await expect(runAttemptPool(crashing, STUDY_V5, trialRuns())).rejects.toThrow(/process killed/);
    expect(h.api.posts).toEqual([...ids(0, 1), ...ids(1, 1, 2)]);
    const resumed = await runAttemptPool(h.deps, STUDY_V5, trialRuns());
    expect(resumed.stopped).toBeNull();
    expect(h.api.posts).toEqual([...ids(0, 1), ...ids(1, 1, 2, 3), ...[2, 3, 4, 5, 6, 7, 8, 9].flatMap((t) => ids(t, 1))]);
    expect(new Set(h.api.posts).size).toBe(h.api.posts.length);
    // The interrupted wait is taken again in full before a3.
    expect(h.paced.slice(0, 4)).toEqual([30_000, 60_000, 180_000, 180_000]);
    expect((await runAttemptPool(h.deps, STUDY_V5, trialRuns())).state).toEqual({ kind: 'done' });
    expect(h.api.posts).toHaveLength(12);
  });

  it('an attempt reconciled after a crash is classified again from the stack, and the protocol continues', async () => {
    const id = ids(0, 1)[0]!;
    h.ledger.append({ slot_id: id, phase: 'confirmatory', reservation_usd: 0.005, state: 'reserved', detail: { expected_non_skill_fingerprint: NON_SKILL, p3_attempt: { study_id: 'itemb-v5', trial_id: TRIALS[0]!.slot_id, attempt: 1, plan_index: 0, delay_before_ms: 0 } } });
    h.ledger.append({ slot_id: id, phase: 'confirmatory', reservation_usd: 0.005, state: 'dispatched', run_id: `run-${id}` });
    h.api.slots.set(id, lookup(id, TRIALS[0]!.condition, T429));
    await expect(runAttemptPool(h.deps, STUDY_V5, trialRuns())).rejects.toThrow(/Reconcile first/);
    await reconcile(h.deps);
    expect(h.ledger.slots().get(id)!.events.at(-1)!.detail).toEqual({ reconciled: true, fingerprint_mismatch: false });
    h.api.script = [OBS, ...Array(9).fill(OBS)];
    const result = await runAttemptPool(h.deps, STUDY_V5, trialRuns());
    expect(result.stopped).toBeNull();
    expect(h.api.posts[0]).toBe(ids(0, 2)[0]);
    expect(h.logs.join('\n')).toMatch(/reconciled attempt classified throttled/);
  });

  const reserve = (id: string, marker: Record<string, unknown> | null, state: 'completed' | 'failed' = 'completed', p3: string | null = 'observed') => {
    h.ledger.append({ slot_id: id, phase: 'confirmatory', reservation_usd: 0.005, state: 'reserved', detail: marker ? { p3_attempt: marker } : {} });
    h.ledger.append({ slot_id: id, phase: 'confirmatory', reservation_usd: 0.005, state, run_id: `run-${id}`, cost_usd: state === 'completed' ? 0.0004 : null, detail: { fingerprint_mismatch: false, ...(p3 ? { p3: { class: p3, reasons: [] } } : {}) } });
  };
  const marker = (k: number, trial = 0, delay?: number) => ({ study_id: 'itemb-v5', trial_id: TRIALS[trial]!.slot_id, attempt: k, plan_index: trial * 3 + k - 1, delay_before_ms: delay ?? plan[trial * 3 + k - 1]!.delay_before_ms });

  it.each([
    ['a trial ID dispatched on its own', () => reserve(TRIALS[0]!.slot_id, null), /trial ID .* is in the ledger/],
    ['an attempt outside the plan', () => reserve(`${TRIALS[0]!.slot_id}-a4`, marker(1)), /not in the frozen attempt plan/],
    ['a2 without a1', () => reserve(ids(0, 2)[0]!, marker(2), 'failed', 'throttled'), /does not follow attempt 1/],
    ['a2 after an observed a1', () => { reserve(ids(0, 1)[0]!, marker(1)); reserve(ids(0, 2)[0]!, marker(2)); }, /re-attempts a trial whose previous attempt was observed/],
    ['a skipped trial', () => reserve(ids(1, 1)[0]!, marker(1, 1)), /fixed order requires trial 1/],
    ['a reservation naming another place in the plan', () => reserve(ids(0, 1)[0]!, marker(2)), /does not record its place/],
    ['a wait that differs from the plan', () => { reserve(ids(0, 1)[0]!, marker(1)); reserve(ids(1, 1)[0]!, marker(1, 1, 5_000)); }, /waited 5000 ms; the plan declares 30000 ms/],
  ])('refuses to continue a history with %s, before any request', async (_label, setup, problem) => {
    setup();
    h.api.script = Array(10).fill(OBS);
    const result = await runAttemptPool(h.deps, STUDY_V5, trialRuns());
    expect(result.stopped).toMatch(/refusing to continue the frozen attempt plan/);
    expect(result.stopped).toMatch(problem);
    expect(h.api.posts).toEqual([]);
  });

  it('refuses to continue after a recorded failure', async () => {
    reserve(ids(0, 1)[0]!, marker(1), 'failed', 'failed');
    h.api.script = Array(10).fill(OBS);
    expect((await runAttemptPool(h.deps, STUDY_V5, trialRuns())).stopped).toMatch(/previously incomplete/);
    expect(h.api.posts).toEqual([]);
  });

  it('a study that ended on its outage stop dispatches nothing more', async () => {
    h.api.script = Array(6).fill(T429);
    expect((await runAttemptPool(h.deps, STUDY_V5, trialRuns())).stopped).toMatch(/outage stop/);
    h.api.script = Array(10).fill(OBS);
    const again = await runAttemptPool(h.deps, STUDY_V5, trialRuns());
    expect(again.stopped).toMatch(/outage stop/);
    expect(h.api.posts).toHaveLength(6);
  });

  it('refuses trials without frozen expectations, or a mixed schedule', async () => {
    await expect(runAttemptPool(h.deps, STUDY_V5, trialRuns().map(({ expectations: _e, ...r }) => r))).rejects.toThrow(/frozen provenance expectations/);
    await expect(runAttemptPool(h.deps, STUDY_V5, trialRuns(V4))).rejects.toThrow(/one frozen version 5 schedule/);
  });
});

describe('protocolNext mirrors the model', () => {
  it('is done, stopped or next exactly where `execute` is', () => {
    const p = modelPolicy(P3_ATTEMPT_POLICY_V5);
    expect(protocolNext(plan, p, [])).toEqual({ kind: 'next', attempt: plan[0] });
    const steps = plan.filter((a) => a.attempt === 1).map((attempt) => ({ attempt, outcome: { kind: 'observed', detected: false } as AttemptOutcome }));
    expect(protocolNext(plan, p, steps)).toEqual({ kind: 'done' });
    expect(protocolNext(plan, p, [{ attempt: plan[0]!, outcome: { kind: 'truncated', eligible: false } }])).toMatchObject({ kind: 'stopped', reason: 'ineligible_truncation' });
    expect(maxStudyAttempts(10, P3_ATTEMPT_POLICY_V5)).toBe(30);
  });
});

// ------------------------------------------------------------------ report

function reportOf(h: Harness, semantics: StudySemantics = V5) {
  const runs = new Map<string, SlotRunData | null>();
  for (const a of plan) runs.set(a.attempt_id, (h.api.slots.get(a.attempt_id)?.runs[0] as unknown as SlotRunData) ?? null);
  return buildP3Report({
    trials: TRIALS.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })),
    ledger: h.ledger.slots(), runs, rules: RULES, frozenNonSkill: { '17': NON_SKILL }, expectations: () => EXPECT, semantics,
    execution: { manifestFingerprint: MANIFEST, phase: 'confirmatory', fixture: () => ({ reviewer: 'Test Quality Reviewer', prNumber: 501, targetSkill: 'Edge Cases and Error Paths' }), skillFingerprint: (_e, c) => skillFingerprint(c) },
  });
}
const detectingScript = () => TRIALS.map((t) => (t.condition === 'with' ? HIT : OBS));

describe('report: labels, P4 bounds and missingness', () => {
  let h: Harness | null = null;
  afterEach(() => { h?.done(); h = null; });

  it('a fully observed study: every trial observed, strict success, claim detected (strict)', async () => {
    h = (await pool(detectingScript())).h;
    const r = reportOf(h);
    expect(r.trials.map((t) => t.label)).toEqual(Array(10).fill('observed'));
    expect(r.p3[0]!.p4).toMatchObject({ strict: 'success', claim: 'detected', claim_basis: 'strict' });
    expect(r.p3[0]!.protocol.state).toBe('done');
    expect(r.trial_rows.every((row) => row.counted && TRIALS.some((t) => t.slot_id === row.slot_id))).toBe(true);
  });

  it('an exhausted pool is bounded; a worst-case success is a conditional bound, never verified', async () => {
    // Trial 1 is lost to three classified 429s; every other trial observed, with trials detecting.
    const script = detectingScript();
    h = (await pool([T429, T429, T429, ...script.slice(1)])).h;
    const r = reportOf(h);
    const first = r.trials[0]!;
    expect(first).toMatchObject({ label: 'bounded', pool_exhausted: true, scoring_attempt_id: null });
    expect(first.attempts.map((a) => [a.attempt_id, a.class])).toEqual(ids(0, 1, 2, 3).map((id) => [id, 'throttled']));
    expect(first.attempts[0]!.armed_at).toBe('2026-11-03T00:00:01.000Z');
    expect(first.attempts[0]!.submitted_at).toBe('2026-11-03T00:00:02.000Z');
    expect(first.attempts[0]!.finished_at).toBe('2026-11-03T00:00:03.000Z');
    expect(first.attempts[1]!.delay_before_ms).toBe(60_000);
    const s = r.p3[0]!;
    expect(s.throttles.map((x) => [x.position, x.condition, x.attempt])).toEqual([[1, TRIALS[0]!.condition, 1], [1, TRIALS[0]!.condition, 2], [1, TRIALS[0]!.condition, 3]]);
    expect(s.exhausted_pools).toEqual([TRIALS[0]!.slot_id]);
    expect(s.p4.strict).toBe('incomplete');
    const lost = TRIALS[0]!.condition;
    expect(s.p4.tallies[lost]).toMatchObject({ scheduled: 5, observed: 4, bounded: 1, incomplete: 0 });
    // With 4/4 with-detections and 0/5 without (or 5/5 and 0/4), the worst case still succeeds.
    expect(s.p4).toMatchObject({ worst_case: 'success', best_case: 'success', claim: 'detected', claim_basis: 'conditional_bound' });
    expect(s.p4.claim_label).toMatch(/conditional bound.*not a verified or accepted result/);
    const md = renderP3Report(r, V5);
    expect(md).toMatch(/A worst-case success is a conditional bound\. It is never a Verified or accepted result\./);
    expect(md).toMatch(/Exhausted pools: c-v5-17-/);
    expect(md).not.toMatch(/\bVerified\b(?!.*accepted)/);
    // For the adjudication: one row per trial; the bounded one is not counted and carries its label.
    const row = r.trial_rows.find((x) => x.slot_id === TRIALS[0]!.slot_id)!;
    expect(row).toMatchObject({ counted: false, imputed: null });
    expect(row.state).toMatch(/^bounded: pool exhausted/);
    expect(r.trial_runs.get(TRIALS[0]!.slot_id)).toBeNull();
  });

  it('an observation on a2 is scored from a2 under the trial ID', async () => {
    h = (await pool([T429, ...detectingScript()])).h;
    const r = reportOf(h);
    expect(r.trials[0]).toMatchObject({ label: 'observed', scoring_attempt_id: ids(0, 2)[0] });
    expect(r.trials[0]!.label_reason).toMatch(/observed on a2 after 1 classified 429/);
    expect(r.trial_runs.get(TRIALS[0]!.slot_id)!.run_id).toBe(`run-${ids(0, 2)[0]}`);
  });

  it('an outage stop leaves the undispatched trials bounded; a failure stop leaves them incomplete', async () => {
    h = (await pool([OBS, ...Array(6).fill(T429)])).h;
    let r = reportOf(h);
    expect(r.trials.map((t) => t.label)).toEqual(['observed', 'bounded', 'bounded', ...Array(7).fill('bounded')]);
    expect(r.p3[0]!.protocol).toMatchObject({ state: 'stopped', reason: 'throttle_outage' });
    expect(r.p3[0]!.p4.claim).not.toBe('detected');
    h.done();
    h = (await pool([OBS, FAIL500])).h;
    r = reportOf(h);
    expect(r.trials.map((t) => t.label)).toEqual(['observed', 'incomplete', ...Array(8).fill('incomplete')]);
    expect(r.p3[0]!.p4).toMatchObject({ claim: 'incomplete', claim_basis: 'none' });
  });

  it('a truncation is imputed (not bounded) and never re-attempted', async () => {
    h = (await pool([TRUNC, ...detectingScript().slice(1)])).h;
    const r = reportOf(h);
    expect(r.trials[0]).toMatchObject({ label: 'imputed', attempts: [expect.objectContaining({ class: 'truncated' })] });
    expect(r.trial_rows[0]!.imputed).toMatchObject({ label: 'imputed (truncated)' });
  });

  it('a study still owing an attempt is incomplete, and a ledger class the trace contradicts blocks the claim', async () => {
    // A runner stopped after a 429 on trial 2 a1 (killed during the wait): a2 is still owed.
    const run = harness();
    h = run;
    run.api.script = [...detectingScript().slice(0, 1), T429];
    let calls = 0;
    await expect(runAttemptPool({ ...run.deps, pacingSleep: async () => { if (++calls === 2) throw new Error('killed'); } }, STUDY_V5, trialRuns())).rejects.toThrow(/killed/);
    const r = reportOf(run);
    expect(r.p3[0]!.protocol).toMatchObject({ state: 'in_progress', attempt_id: ids(1, 2)[0] });
    expect(r.trials[1]).toMatchObject({ label: 'incomplete' });
    expect(r.trials[1]!.label_reason).toMatch(/attempt still owed/);
    expect(r.p3[0]!.p4.claim).toBe('incomplete');
    // The trace of the first attempt now says 429; its ledger record says observed.
    const id = run.api.posts[0]!;
    run.api.slots.set(id, lookup(id, TRIALS[0]!.condition, T429));
    const contradicted = reportOf(run);
    expect(contradicted.p3[0]!.inconsistencies.join()).toMatch(/the runner recorded observed, the trace shows throttled/);
    expect(contradicted.trials[0]!.label).toBe('incomplete');
  });
});

describe('p4Result', () => {
  const t = (observed: number, detected: number, bounded = 0, incomplete = 0, imputed = 0) => ({ scheduled: observed + bounded + incomplete + imputed, observed, detected, imputed, bounded, incomplete });
  it('separates the strict result, the bounds and the claim', () => {
    expect(p4Result({ with: t(5, 4), without: t(5, 1) })).toMatchObject({ strict: 'success', claim: 'detected', claim_basis: 'strict' });
    expect(p4Result({ with: t(5, 2), without: t(5, 2) })).toMatchObject({ strict: 'negative', claim: 'not_detected', claim_basis: 'strict' });
    expect(p4Result({ with: t(4, 4, 1), without: t(5, 0) })).toMatchObject({ strict: 'incomplete', worst_case: 'success', claim: 'detected', claim_basis: 'conditional_bound' });
    expect(p4Result({ with: t(4, 1, 1), without: t(5, 3) })).toMatchObject({ best_case: 'negative', claim: 'not_detected', claim_basis: 'bound' });
    expect(p4Result({ with: t(4, 4, 0, 1), without: t(5, 0) })).toMatchObject({ worst_case: 'success', claim: 'incomplete', claim_basis: 'none' });
    expect(p4Result({ with: t(5, 4), without: t(5, 1) }, ['protocol: x'])).toMatchObject({ claim: 'incomplete', claim_label: 'incomplete (protocol: x)' });
    expect(() => p4Result({ with: { ...t(5, 4), scheduled: 6 }, without: t(5, 1) })).toThrow(/inconsistent P4 tally/);
  });
});

// ------------------------------------------------------------------ adjudication

describe('adjudication: condition-blinded packet, P4 at the reveal', () => {
  it('keeps attempt pools in the private mapping only, and reveals P4 over adjudicated verdicts', async () => {
    const h = (await pool([T429, T429, T429, ...detectingScript().slice(1)])).h;
    try {
      const r = reportOf(h);
      const trials: Record<string, P3TrialEntry> = Object.fromEntries(r.trials.map((x) => [x.trial_id, { label: x.label, label_reason: x.label_reason, scoring_attempt_id: x.scoring_attempt_id, attempt_ids: x.attempts.map((a) => a.attempt_id) }]));
      const design = { manifest_fingerprint: MANIFEST, experiments: ['17'], per_condition: 5, slots: TRIALS.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })) };
      let n = 0;
      const prepared = preparePacketV2({ design, rows: r.trial_rows, runs: r.trial_runs, rules: { '17': TECHNICAL_RULES['17']! }, screenRules: RULES, skillNames: ['Edge Cases and Error Paths'], trials, newCaseId: () => `case-${String(50 - n++).padStart(3, '0')}` });
      expect(prepared.packet.cases).toHaveLength(9);
      const packetText = JSON.stringify(prepared.packet);
      for (const leak of ['c-v5-', '-a1', 'with', 'without', 'run-']) expect(packetText).not.toContain(leak);
      expect(prepared.mapping.attempt_policy).toBe('p3');
      expect(prepared.mapping.entries.find((e) => e.slot_id === TRIALS[0]!.slot_id)!.p3).toMatchObject({ label: 'bounded', attempt_ids: ids(0, 1, 2, 3) });
      const verdict = (caseId: string) => {
        const entry = prepared.mapping.entries.find((e) => e.case_id === caseId)!;
        return entry.condition === 'with' ? 'yes' as const : 'no' as const;
      };
      const judge = (name: string) => {
        const judgment: Judgment = { adjudicator: name, packet_sha256: prepared.packet_sha256, verdicts: prepared.packet.cases.map((c) => ({ case_id: c.case_id, detected: verdict(c.case_id), finding_refs: verdict(c.case_id) === 'yes' ? ['f1'] : [], reason: 'rule' })) };
        return { judgment, seal: sealJudgment(judgment) };
      };
      const result = reveal({ ...prepared, judgments: [judge('A'), judge('B')] });
      if (result.status !== 'revealed') throw new Error(result.errors.join('; '));
      const x = result.experiments[0]!;
      expect(x.outcome).toBe('incomplete'); // the strict, fully observed rule
      expect(x.p4).toMatchObject({ strict: 'incomplete', worst_case: 'success', claim: 'detected', claim_basis: 'conditional_bound' });
      expect(x.p4!.tallies[TRIALS[0]!.condition].bounded).toBe(1);
      // An ambiguous final verdict is missing for a non-429 reason: no claim.
      const ambiguous = (name: string) => {
        const judgment: Judgment = { adjudicator: name, packet_sha256: prepared.packet_sha256, verdicts: prepared.packet.cases.map((c, i) => ({ case_id: c.case_id, detected: i === 0 ? 'ambiguous' : verdict(c.case_id), finding_refs: verdict(c.case_id) === 'yes' && i !== 0 ? ['f1'] : [], reason: 'rule' })) };
        return { judgment, seal: sealJudgment(judgment) };
      };
      const blocked = reveal({ ...prepared, judgments: [ambiguous('A'), ambiguous('B')] });
      if (blocked.status !== 'revealed') throw new Error('invalid');
      expect(blocked.experiments[0]!.p4).toMatchObject({ claim: 'incomplete' });
    } finally {
      h.done();
    }
  });

  it('`adjudication-cli prepare` takes packet v2 and the attempt pools from a version 5 input, and refuses one without them', async () => {
    const h = (await pool([T429, ...detectingScript()])).h;
    const base = mkdtempSync(join(tmpdir(), 'hw2-v5-adj-'));
    try {
      const r = reportOf(h);
      const trials = Object.fromEntries(r.trials.map((x) => [x.trial_id, { label: x.label, label_reason: x.label_reason, scoring_attempt_id: x.scoring_attempt_id, attempt_ids: x.attempts.map((a) => a.attempt_id) }]));
      const input = {
        design: { manifest_fingerprint: MANIFEST, experiments: ['17'], per_condition: 5, slots: TRIALS.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })) },
        rows: r.trial_rows, runs: Object.fromEntries(r.trial_runs), skill_names: ['Edge Cases and Error Paths'],
        manifest_version: 5, study: STUDY_V5, screen_rules: RULES, trials,
      };
      const file = join(base, 'input.json');
      writeFileSync(file, JSON.stringify(input));
      await adjudicationMain(['prepare', '--dir', join(base, 'record'), '--input', file], () => new Date('2026-11-03T00:00:00Z'), () => {});
      const mapping = JSON.parse(readFileSync(join(base, 'record', 'private', 'mapping.json'), 'utf8'));
      const packet = JSON.parse(readFileSync(join(base, 'record', 'packet.json'), 'utf8'));
      expect(packet.version).toBe(2);
      expect(packet.cases).toHaveLength(10);
      expect(JSON.stringify(packet)).not.toContain('c-v5-');
      expect(mapping.attempt_policy).toBe('p3');
      expect(mapping.entries.find((e: { slot_id: string }) => e.slot_id === TRIALS[0]!.slot_id).p3).toMatchObject({ label: 'observed', scoring_attempt_id: ids(0, 2)[0] });
      const bare = join(base, 'bare.json');
      writeFileSync(bare, JSON.stringify({ ...input, trials: undefined }));
      await expect(adjudicationMain(['prepare', '--dir', join(base, 'record2'), '--input', bare], () => new Date(), () => {})).rejects.toThrow(/needs every trial's attempt-pool entry/);
    } finally {
      h.done();
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses trial entries that disagree with the rows', async () => {
    const h = (await pool(detectingScript())).h;
    try {
      const r = reportOf(h);
      const trials: Record<string, P3TrialEntry> = Object.fromEntries(r.trials.map((x) => [x.trial_id, { label: 'bounded' as const, label_reason: 'x', scoring_attempt_id: null, attempt_ids: [] }]));
      const design = { manifest_fingerprint: MANIFEST, experiments: ['17'], per_condition: 5, slots: TRIALS.map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition })) };
      expect(() => preparePacketV2({ design, rows: r.trial_rows, runs: r.trial_runs, rules: { '17': 'rule' }, screenRules: RULES, skillNames: [], trials })).toThrow(/labelled bounded but is counted/);
    } finally {
      h.done();
    }
  });
});

// ------------------------------------------------------------------ budget and CLI

describe('budget: the capability and the reservations cover M attempts', () => {
  let root: string;
  let home: string;
  let v5: ManifestV5;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commitFile = (name: string, value: unknown) => {
    writeFileSync(join(root, 'prereg', name), `${JSON.stringify(value, null, 2)}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', name);
    return join(root, 'prereg', name);
  };
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'hw2-v5-prereg-'));
    home = mkdtempSync(join(tmpdir(), 'hw2-v5-home-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(root, 'prereg'));
    v5 = await buildManifestV5(input(STUDY_V5));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('reads a committed v5 pre-registration and refuses an edited attempt plan', () => {
    expect(readFrozen(commitFile('v5.json', v5), root).version).toBe(5);
    const edited = { ...v5, schedule: { ...v5.schedule, attempts: v5.schedule.attempts.slice(0, 20) } };
    expect(() => readFrozen(commitFile('bad.json', edited), root)).toThrow(/version 5 pre-registration is inconsistent: the attempt plan/);
  });

  it('M × the reservation is the reservation total; authorize refuses a smaller budget before contacting the stack', async () => {
    expect(attemptReservationTotal(v5)).toBeCloseTo(0.15, 12);
    const file = commitFile('v5.json', v5);
    let contacted = false;
    const stack = { stackId: 'hw2f-standin5' } as Stack;
    const deps = { stack: async () => ((contacted = true), stack), verify: async () => ({ fingerprint: 'f' }), root, log: () => {}, home };
    await expect(authorize({ prereg: file, budget: '0.1', ceiling: '1', hours: '1' }, 'confirmatory', deps)).rejects.toThrow(/does not cover 30 attempts × \$0.005 = \$0.15000000/);
    expect(contacted).toBe(false);
    expect(existsSync(join(home, '.devdigest', 'hw2-experiments', 'hw2f-standin5', 'capability.json'))).toBe(false);
    await authorize({ prereg: file, budget: '0.15', ceiling: '1', hours: '1' }, 'confirmatory', deps);
    expect(existsSync(join(home, '.devdigest', 'hw2-experiments', 'hw2f-standin5', 'capability.json'))).toBe(true);
  });

  it('`plan --study v5` prints the trials, every attempt ID, the max attempts and the reservation total', async () => {
    const file = commitFile('v5.json', v5);
    const cwd = process.cwd();
    const logs: string[] = [];
    try {
      process.chdir(root);
      await main(['plan', '--study', 'v5', '--experiments', '17', '--prereg', file], (m) => logs.push(m));
    } finally {
      process.chdir(cwd);
    }
    const printed = JSON.parse(logs[0]!) as { trials: Array<{ slot_id: string }>; attempts: Array<{ attempt_id: string }> };
    expect(printed.trials.map((s) => s.slot_id)).toEqual(v5.schedule.slots.map((s) => s.slot_id));
    expect(printed.attempts.map((a) => a.attempt_id)).toEqual(v5.schedule.attempts.map((a) => a.attempt_id));
    expect(logs[1]).toMatch(/max attempts 30 .*per-attempt reservation \$0.005; reservation total \$0.15000000/);
  });

  it('`plan --study v4` refuses a v5 pre-registration and vice versa', async () => {
    const file = commitFile('v5.json', v5);
    const cwd = process.cwd();
    try {
      process.chdir(root);
      await expect(main(['plan', '--study', 'v4', '--experiments', '17', '--prereg', file], () => {})).rejects.toThrow(/is not the itemb-v4 pre-registration/);
    } finally {
      process.chdir(cwd);
    }
  });
});
