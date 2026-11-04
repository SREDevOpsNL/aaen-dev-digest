import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExperimentApi } from '../src/experiments/hw2/api.js';
import { authorize, main, studyFromFlags, type Stack } from '../src/experiments/hw2/cli.js';
import type { FrozenExpectations } from '../src/experiments/hw2/eligibility.js';
import { Ledger, type SlotRecord } from '../src/experiments/hw2/ledger.js';
import {
  STUDY_V4,
  V3_SEMANTICS,
  buildManifest,
  buildManifestV4,
  deriveSeed,
  manifestFingerprint,
  readFrozen,
  scheduleFor,
  seedProblems,
  studySemantics,
  verifyPreregistration,
  type ManifestInput,
  type ManifestV4,
} from '../src/experiments/hw2/manifest.js';
import { buildReport, renderReport, type SlotRunData } from '../src/experiments/hw2/report.js';
import { runSchedule, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';
import { TAGGED_SLOT_ID, UNTAGGED_SLOT_ID, buildSchedule, parseSlotId, slotId } from '../src/experiments/hw2/schedule.js';
import { repoRoot } from '../src/experiments/hw2/source.js';
import { canonicalJson, sha256 } from '../src/modules/_shared/experiment.js';

// Synthetic manifests, slots and runs only: nothing here dispatches or rescores a real slot.
const agent = (id: string, name: string) => ({ id, name, enabled: true, provider: 'openrouter', system_prompt: `${name} instructions`, output_schema: null, model: 'deepseek/deepseek-v4-flash', strategy: 'single-pass', repo_intel: false });
const skill = (id: string, name: string) => ({ id, name, body: `${name} body`, enabled: true, approval: { status: 'approved', approved_version: 1 } });

function v4Input(overrides: Partial<ManifestInput> = {}): Omit<ManifestInput, 'schedule'> & { study: typeof STUDY_V4 } {
  return {
    study: STUDY_V4,
    implementationFingerprint: 'impl',
    nonSkillFingerprints: { '17': 'n17', '18': 'n18' },
    stack: { database: 'devdigest_hw2f_test', provider: 'deepinfra/fp8', providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', servedModel: 'deepseek/deepseek-v4-flash-20260423', maxOutputTokens: 8000, prices: { input: 0.00000009, output: 0.00000018, request: 0 }, generationLookup: null },
    skills: [skill('s-2', 'breaking-change'), skill('s-1', 'Edge Cases and Error Paths')],
    agents: [agent('a-2', 'API Contract Reviewer'), agent('a-1', 'Test Quality Reviewer')],
    rules: { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 1, end_line: 8 }], keywords: ['expir'] }, '18': { anchors: [{ file: 'src/api/payments.ts', start_line: 18, end_line: 18 }], keywords: ['break'] } },
    perSlotReservationUsd: 0.005,
    ...overrides,
  };
}

const V3_FILE = 'docs/homework/L02/prereg/manifest-20261031-v3.json';
const v3Ids = buildSchedule({ seed: 20261030, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }).map((s) => s.slot_id);
const V4 = studySemantics({ version: 4, study: STUDY_V4 });

describe('v4 slot IDs', () => {
  it('are c-v4-<exp>-<cond>-<trial>, 5 with and 5 without for #17 only, and keep the c- phase prefix', () => {
    const slots = scheduleFor(V4, 12345);
    expect(slots).toHaveLength(10);
    expect(slots.every((s) => s.experiment === '17' && /^c-v4-17-(with|without)-[1-5]$/.test(s.slot_id))).toBe(true);
    expect(slots.filter((s) => s.condition === 'with')).toHaveLength(5);
    expect(slotId('confirmatory', '17', 'with', 1, 'v4')).toBe('c-v4-17-with-1');
  });

  it('leave v3 IDs and their parsing unchanged', () => {
    expect(slotId('confirmatory', '17', 'with', 1)).toBe('c-17-with-1');
    expect(slotId('exploration', '18', 'without', 2)).toBe('x-18-without-2');
    expect(parseSlotId('c-17-with-1')).toEqual({ phase: 'confirmatory', tag: null, experiment: '17', condition: 'with', trial: 1 });
    expect(parseSlotId('x-18-without-2')).toMatchObject({ phase: 'exploration', tag: null });
    expect(parseSlotId('c-v4-17-without-5')).toEqual({ phase: 'confirmatory', tag: 'v4', experiment: '17', condition: 'without', trial: 5 });
    expect(parseSlotId('c-17-other-1')).toBeNull();
    expect(scheduleFor(V3_SEMANTICS, 20261030).map((s) => s.slot_id)).toEqual(v3Ids);
  });

  it('never collide with a v3 ID, for any seed, and each form matches only its own pattern', () => {
    for (const seed of [0, 1, 20261030, 4294967295]) {
      const v4 = scheduleFor(V4, seed).map((s) => s.slot_id);
      const v3 = scheduleFor(V3_SEMANTICS, seed).map((s) => s.slot_id);
      expect(v4.filter((id) => v3.includes(id) || v3Ids.includes(id))).toEqual([]);
      expect(v4.every((id) => TAGGED_SLOT_ID.test(id) && !UNTAGGED_SLOT_ID.test(id))).toBe(true);
      expect(v3.every((id) => UNTAGGED_SLOT_ID.test(id) && !TAGGED_SLOT_ID.test(id))).toBe(true);
    }
  });

  it('refuses a tag on exploration slots and a malformed tag', () => {
    expect(() => slotId('exploration', '17', 'with', 1, 'v4')).toThrow(/confirmatory slots only/);
    expect(() => slotId('confirmatory', '17', 'with', 1, '17')).toThrow(/not v<number>/);
  });
});

describe('v4 manifest and its derived seed', () => {
  it('freezes the study block, the 8,000 output cap and only experiment 17', async () => {
    const m = await buildManifestV4(v4Input());
    expect(m.version).toBe(4);
    expect(m.study).toEqual(STUDY_V4);
    expect(m.stack.maxOutputTokens).toBe(8000);
    expect(m.fixtures.map((f) => f.number)).toEqual([501]);
    expect(m.skills.map((s) => s.name)).toEqual(['Edge Cases and Error Paths']);
    expect(m.agents.map((a) => a.name)).toEqual(['Test Quality Reviewer']);
    expect(Object.keys(m.rules)).toEqual(['17']);
    expect(m.non_skill_fingerprints).toEqual({ '17': 'n17' });
    expect(m.schedule.slots).toHaveLength(10);
  });

  it('derives the seed from the manifest without its schedule, stably, and records the derivation', async () => {
    const m = await buildManifestV4(v4Input());
    const { schedule: _schedule, ...body } = m;
    const basis = sha256(canonicalJson(body));
    expect(m.schedule.seed_derivation.basis_fingerprint).toBe(basis);
    expect(m.schedule.seed).toBe(Number.parseInt(sha256(`hw2-itemb-v4|${basis}`).slice(0, 8), 16));
    expect(m.schedule.seed).toBe(deriveSeed('itemb-v4', basis));
    expect(m.schedule.seed).not.toBe(20261030);
    expect(seedProblems(m)).toEqual([]);
    const reordered = await buildManifestV4(v4Input({ agents: [...v4Input().agents].reverse(), skills: [...v4Input().skills].reverse() }));
    expect(manifestFingerprint(reordered)).toBe(manifestFingerprint(m));
    expect(m.schedule.slots.map((s) => s.slot_id)).toEqual(scheduleFor(V4, m.schedule.seed).map((s) => s.slot_id));
  });

  it.each([
    ['the output cap', (i: ReturnType<typeof v4Input>) => ({ ...i, stack: { ...i.stack, maxOutputTokens: 4000 } })],
    ['the implementation', (i: ReturnType<typeof v4Input>) => ({ ...i, implementationFingerprint: 'other' })],
    ['the #17 rule', (i: ReturnType<typeof v4Input>) => ({ ...i, rules: { ...i.rules, '17': { ...i.rules['17']!, keywords: ['other'] } } })],
  ])('changes with %s', async (_label, change) => {
    const a = await buildManifestV4(v4Input());
    const b = await buildManifestV4(change(v4Input()));
    expect(b.schedule.seed_derivation.basis_fingerprint).not.toBe(a.schedule.seed_derivation.basis_fingerprint);
    expect(b.schedule.seed).not.toBe(a.schedule.seed);
  });

  it('is unchanged by experiment 18 inputs it does not freeze', async () => {
    const a = await buildManifestV4(v4Input());
    const b = await buildManifestV4(v4Input({ nonSkillFingerprints: { '17': 'n17', '18': 'changed' }, skills: [skill('s-2', 'breaking-change'), { ...skill('s-1', 'Edge Cases and Error Paths') }] }));
    expect(manifestFingerprint(b)).toBe(manifestFingerprint(a));
  });

  it('names a seed or schedule that was edited after the freeze', async () => {
    const m = await buildManifestV4(v4Input());
    expect(seedProblems({ ...m, schedule: { ...m.schedule, seed: 20261030 } })).toEqual(expect.arrayContaining(['the seed is not the one its basis derives']));
    const swapped = [...m.schedule.slots];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(seedProblems({ ...m, schedule: { ...m.schedule, slots: swapped } })).toEqual(['the schedule is not the one the derived seed builds']);
    expect(seedProblems({ ...m, per_slot_reservation_usd: 0.006 })).toEqual(expect.arrayContaining(['the seed basis is not the fingerprint of the manifest without its schedule']));
  });

  it('refuses inputs that do not cover experiment 17, and an unknown study block', async () => {
    await expect(buildManifestV4(v4Input({ rules: {} }))).rejects.toThrow(/No rule for experiment 17/);
    await expect(buildManifestV4(v4Input({ skills: [skill('s-2', 'breaking-change')] }))).rejects.toThrow(/Target Skill "Edge Cases and Error Paths" is missing/);
    await expect(buildManifestV4({ ...v4Input(), study: { ...STUDY_V4, per_condition: 4 } })).rejects.toThrow(/known study block exactly/);
  });
});

describe('the closed v3 pre-registration (regression)', () => {
  it(`${V3_FILE} still reads, with its seed, schedule, fingerprint and v3 semantics unchanged`, () => {
    const root = repoRoot(__dirname);
    const frozen = readFrozen(resolve(root, V3_FILE), root);
    expect(frozen.version).toBe(3);
    expect(frozen.schedule.seed).toBe(20261030);
    expect(frozen.schedule.slots.map((s) => s.slot_id)).toEqual(v3Ids);
    expect(frozen.schedule.slots.slice(0, 3).map((s) => s.slot_id)).toEqual(['c-18-with-5', 'c-18-without-5', 'c-17-with-1']);
    // The fingerprint published in PROSPECTIVE-STUDY.md, "Approval packet v3".
    expect(manifestFingerprint(frozen)).toBe('2f13ad1ce7f5ad5bfcf3b90d2ecd4cb0ba78cd3ad61eb4499da43627684d79d5');
    expect(studySemantics(frozen)).toEqual({ version: 3, slotTag: null, experiments: ['17', '18'], perCondition: 5, truncation: 'stop', truncationProvenance: 'strict', adjudicationPacket: 1, redaction: 'none' });
    expect('study' in frozen).toBe(false);
  });
});

describe('readFrozen and verifyPreregistration across versions (real git)', () => {
  let root: string;
  let v4: ManifestV4;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commitFile = (name: string, value: unknown) => {
    writeFileSync(join(root, 'prereg', name), `${JSON.stringify(value, null, 2)}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', name);
    return join(root, 'prereg', name);
  };
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'hw2-v4-prereg-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(root, 'prereg'));
    v4 = await buildManifestV4(v4Input());
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads version 3 and version 4, each with its own semantics', async () => {
    const { schedule: _s, study: _st, ...rest } = v4;
    const v3 = await buildManifest({ ...v4Input(), schedule: { seed: 20261030, slots: buildSchedule({ seed: 20261030, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }) } });
    expect(studySemantics(readFrozen(commitFile('v3.json', v3), root))).toBe(V3_SEMANTICS);
    const read = readFrozen(commitFile('v4.json', v4), root);
    expect(studySemantics(read)).toEqual({ version: 4, slotTag: 'v4', experiments: ['17'], perCondition: 5, truncation: 'continue-impute', truncationProvenance: 'single-router-attempt', adjudicationPacket: 2, redaction: 'r1' });
    expect(rest.version).toBe(4);
  });

  it.each([
    ['an unknown version', () => ({ ...v4, version: 6 }), /manifest version 6; this runner freezes versions 3, 4 and 5/],
    ['a version 5 file carrying the v4 study block', () => ({ ...v4, version: 5 }), /version 5 manifest must carry a known study block exactly/],
    ['a version 4 file without a study block', () => { const { study: _s, ...rest } = v4; return rest; }, /known study block exactly/],
    ['a version 4 file with an edited study block', () => ({ ...v4, study: { ...v4.study, truncation: 'stop' } }), /known study block exactly/],
    ['a version 4 file with an edited seed', () => ({ ...v4, schedule: { ...v4.schedule, seed: v4.schedule.seed + 1 } }), /inconsistent: .*seed/],
    ['a version 3 file carrying v4 slots? no: a version 4 file with v3 slots', () => ({ ...v4, schedule: { ...v4.schedule, slots: v3Ids.slice(0, 10).map((id) => ({ slot_id: id, experiment: id.split('-')[1]!, condition: id.split('-')[2] as 'with' })) } }), /schedule is not the one/],
  ])('refuses %s', (_label, make, error) => {
    expect(() => readFrozen(commitFile('bad.json', make()), root)).toThrow(error);
  });

  it('verifies a v4 pre-registration against a rebuilt manifest, and refuses one that differs (the authorize and run path)', async () => {
    const file = commitFile('v4.json', v4);
    const ok = await verifyPreregistration(file, root, async () => buildManifestV4(v4Input({ agents: [...v4Input().agents].reverse() })));
    expect(ok.fingerprint).toBe(manifestFingerprint(v4));
    await expect(verifyPreregistration(file, root, async () => buildManifestV4(v4Input({ stack: { ...v4Input().stack, maxOutputTokens: 4000 } }))))
      .rejects.toThrow(/differs in: schedule, stack/);
  });

  describe('authorize (confirmatory) with a stand-in stack and a v4 pre-registration', () => {
    let home: string;
    beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'hw2-v4-home-'))));
    afterEach(() => rmSync(home, { recursive: true, force: true }));
    const capability = () => join(home, '.devdigest', 'hw2-experiments', 'hw2f-standin4', 'capability.json');
    const stack = { stackId: 'hw2f-standin4' } as Stack;
    const flags = (prereg: string) => ({ prereg, budget: '0.05', ceiling: '0.2', hours: '1' });

    it('writes the capability only after a matching comparison', async () => {
      const order: string[] = [];
      await authorize(flags(commitFile('v4.json', v4)), 'confirmatory', { stack: async () => (order.push('stack'), stack), verify: async () => (order.push('verify'), { fingerprint: 'f' }), root, log: () => {}, home });
      expect(order).toEqual(['stack', 'verify']);
      expect(existsSync(capability())).toBe(true);
    });

    it('refuses an inconsistent v4 file before contacting the stack, and a mismatch before any capability', async () => {
      let contacted = false;
      const bad = commitFile('bad.json', { ...v4, schedule: { ...v4.schedule, seed: 1 } });
      await expect(authorize(flags(bad), 'confirmatory', { stack: async () => ((contacted = true), stack), verify: async () => ({ fingerprint: 'x' }), root, log: () => {}, home })).rejects.toThrow(/inconsistent/);
      expect(contacted).toBe(false);
      const good = commitFile('v4.json', v4);
      await expect(authorize(flags(good), 'confirmatory', { stack: async () => stack, verify: async () => Promise.reject(new Error('differs in: stack')), root, log: () => {}, home })).rejects.toThrow(/differs in: stack/);
      expect(existsSync(capability())).toBe(false);
    });
  });

  it('`plan --study v4 --experiments 17 --prereg` prints the frozen v4 schedule', async () => {
    const file = commitFile('v4.json', v4);
    const cwd = process.cwd();
    const logs: string[] = [];
    try {
      process.chdir(root);
      await main(['plan', '--study', 'v4', '--experiments', '17', '--prereg', file], (m) => logs.push(m));
    } finally {
      process.chdir(cwd);
    }
    expect((JSON.parse(logs[0]!) as Array<{ slot_id: string }>).map((s) => s.slot_id)).toEqual(v4.schedule.slots.map((s) => s.slot_id));
  });
});

describe('`--study v4 --experiments 17`', () => {
  it('selects exactly the frozen study, and nothing else', () => {
    expect(studyFromFlags({})).toBeNull();
    expect(studyFromFlags({ study: 'v4', experiments: '17' })).toBe(STUDY_V4);
    expect(() => studyFromFlags({ study: 'v6', experiments: '17' })).toThrow(/--study must be v4 or v5/);
    expect(() => studyFromFlags({ study: 'v4', experiments: '17,18' })).toThrow(/needs --experiments 17/);
    expect(() => studyFromFlags({ study: 'v4', experiments: '17', seed: '7' })).toThrow(/drop --seed/);
    expect(() => studyFromFlags({ experiments: '17' })).toThrow(/needs --study/);
  });
});

// ---------------------------------------------------------------- runner

const SERVED = 'deepseek/deepseek-v4-flash-20260423';
const expectations: FrozenExpectations = { providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', servedModel: SERVED, expectedDiffSha256: 'd'.repeat(64) };
const NON_SKILL = 'n'.repeat(64);
const attempt = (outcome: string, extra: Record<string, unknown> = {}) => ({
  dispatch: 'dispatched',
  outcome,
  servedModel: 'deepseek/deepseek-v4-flash',
  router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: 1 },
  generation: { status: 'found', providerName: 'DeepInfra', model: SERVED, providerResponses: [{ providerName: 'DeepInfra', modelPermaslug: SERVED, status: 200 }] },
  ...extra,
});
type Outcome = { dispatch_state: string; usage_known: boolean; cost: number | null; attempts: unknown[]; refusal_reason?: string; non_skill_fingerprint?: string };
const settled = (o: Outcome) => (slotId: string, runId: string) => ({
  runs: [{
    run_id: runId, status: o.dispatch_state === 'completed' ? 'done' : 'failed', cost_usd: o.cost,
    experiment: { slot_id: slotId, dispatch_state: o.dispatch_state, usage_known: o.usage_known, diff_sha256: 'd'.repeat(64), non_skill_fingerprint: o.non_skill_fingerprint ?? NON_SKILL, refusal_reason: o.refusal_reason ?? null, attempts: o.attempts },
  }],
});
const TRUNCATED: Outcome = { dispatch_state: 'failed', usage_known: true, cost: 0.0015, attempts: [attempt('truncated')], refusal_reason: 'output reached the max_tokens cap (finish_reason=length)' };
/** Shaped like v3 `c-17-with-2` (forensic slot view): router attempt 1, attempts absent, DeepInfra selected, generation not_found, cost known. */
const V3_SHAPED_ATTEMPT = attempt('truncated', {
  router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: null },
  generation: { status: 'not_found', providerName: null, model: null, providerResponses: [] },
});
const TRUNCATED_ROUTER_ONLY: Outcome = { ...TRUNCATED, cost: 0.00082278, attempts: [V3_SHAPED_ATTEMPT] };
const COMPLETED: Outcome = { dispatch_state: 'completed', usage_known: true, cost: 0.0004, attempts: [attempt('valid')] };

/** In-memory stand-in for the disposable API; `outcomes` settles each slot in turn. */
class FakeApi extends ExperimentApi {
  posts: string[] = [];
  slots = new Map<string, unknown>();
  outcomes = new Map<string, Outcome>();
  constructor() {
    super('http://127.0.0.1:1');
  }
  override async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    if (method === 'POST' && path === '/experiments/runs') {
      const id = (body as { slot_id: string }).slot_id;
      this.posts.push(id);
      this.slots.set(id, settled(this.outcomes.get(id) ?? COMPLETED)(id, `run-${id}`));
      return { run_id: `run-${id}`, slot_id: id } as T;
    }
    if (method === 'GET' && path.startsWith('/experiments/slots/')) return (this.slots.get(path.split('/').pop()!) ?? { runs: [] }) as T;
    if (method === 'GET' && path === '/agents/agent/skills') return [] as T;
    return {} as T;
  }
}

describe('runner: the frozen v4 truncation rule (fake API, no network)', () => {
  let dir: string;
  let ledger: Ledger;
  let api: FakeApi;
  let deps: RunnerDeps;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hw2-v4-run-'));
    ledger = new Ledger(dir);
    ledger.acquire({ pid: 1, stackId: 'hw2f-test' });
    api = new FakeApi();
    logs.length = 0;
    deps = { api, ledger, log: (m) => logs.push(m), capabilityToken: 'tok', sleep: async () => {}, pollIntervalMs: 0, pollTimeoutMs: 1_000 };
  });
  afterEach(() => {
    ledger.release();
    rmSync(dir, { recursive: true, force: true });
  });
  const ids = ['c-v4-17-with-1', 'c-v4-17-without-1', 'c-v4-17-with-2'];
  const runs = (semantics: typeof V4 | null = V4, withExpectations = true): SlotRun[] =>
    ids.map((id) => {
      const p = parseSlotId(id)!;
      return {
        slot: { slot_id: id, index: 0, phase: 'confirmatory', experiment: p.experiment, condition: p.condition, trial: p.trial },
        prId: 'pr', agentId: 'agent', skillIds: p.condition === 'with' ? ['skill'] : [], manifestFingerprint: 'f'.repeat(64),
        expectedDiffSha256: 'd'.repeat(64), reservationUsd: 0.005, expectedNonSkillFingerprint: NON_SKILL,
        ...(semantics ? { semantics } : {}),
        ...(withExpectations ? { expectations } : {}),
      };
    });

  it('a truncated slot is terminal, not retried, and the schedule continues', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED);
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toBeNull();
    expect(api.posts).toEqual(ids);
    expect(results[0]).toMatchObject({ state: 'failed', costUsd: 0.0015, truncation: { continue: true, problems: [] } });
    const terminal = ledger.slots().get(ids[0]!)!.events.at(-1)!;
    expect(terminal).toMatchObject({ state: 'failed', cost_usd: 0.0015, detail: { fingerprint_mismatch: false, attempt_outcome: 'truncated', truncation: 'continue', truncation_provenance: 'verified' } });
    expect(logs.join('\n')).toMatch(/c-v4-17-with-1: truncated; terminal, not retried/);
    // Resume: the accepted truncation is skipped, never replayed, and nothing else is sent.
    const resumed = await runSchedule(deps, runs());
    expect(resumed.stopped).toBeNull();
    expect(api.posts).toEqual(ids);
  });

  it('a truncation shaped like v3 c-17-with-2 (router attempt 1, generation not_found) continues at router_metadata_only', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED_ROUTER_ONLY);
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toBeNull();
    expect(api.posts).toEqual(ids);
    expect(results[0]).toMatchObject({ state: 'failed', costUsd: 0.00082278, truncation: { continue: true, problems: [], provenance: 'router_metadata_only' } });
    expect(ledger.slots().get(ids[0]!)!.events.at(-1)!.detail).toMatchObject({ truncation: 'continue', truncation_provenance: 'router_metadata_only' });
    expect(logs.join('\n')).toMatch(/provenance router_metadata_only/);
    expect((await runSchedule(deps, runs())).stopped).toBeNull();
    expect(api.posts).toEqual(ids);
  });

  it('the same v3-shaped truncation still stops under version 3 semantics', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED_ROUTER_ONLY);
    expect((await runSchedule(deps, runs(null))).stopped).toMatch(/is incomplete/);
    expect(api.posts).toEqual([ids[0]]);
  });

  it.each([
    ['a router record of 2 attempts (attempt 2)', { router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 2, attemptsCount: null } }, /router attempt is 2, not 1/],
    ['a router record of 2 attempts (attempts 2)', { router: { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: 2 } }, /router metadata shows 2 upstream attempts/],
    ['a different provider', { router: { selected: [{ provider: 'Novita', model: SERVED }], attempt: 1, attemptsCount: null } }, /router selected Novita/],
    ['a different served model', { router: { selected: [{ provider: 'DeepInfra', model: 'deepseek/other' }], attempt: 1, attemptsCount: null } }, /not DeepInfra \/ deepseek\/deepseek-v4-flash-20260423/],
    ['two selected endpoints', { router: { selected: [{ provider: 'DeepInfra', model: SERVED }, { provider: 'Novita', model: SERVED }], attempt: 1, attemptsCount: null } }, /selected 2 endpoints/],
    ['a found generation with two responses', { generation: { status: 'found', providerName: 'DeepInfra', model: SERVED, providerResponses: [{ providerName: 'DeepInfra', modelPermaslug: SERVED, status: 500 }, { providerName: 'DeepInfra', modelPermaslug: SERVED, status: 200 }] } }, /does not show exactly one response/],
    ['an unavailable generation lookup', { generation: { status: 'unavailable', providerResponses: [] } }, /generation lookup unavailable/],
  ])('a router-only truncation with %s stops the schedule', async (_label, patch, problem) => {
    api.outcomes.set(ids[0]!, { ...TRUNCATED_ROUTER_ONLY, attempts: [{ ...V3_SHAPED_ATTEMPT, ...patch }] });
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toMatch(/is incomplete/);
    expect(api.posts).toEqual([ids[0]]);
    expect(results[0]!.truncation).toMatchObject({ continue: false, provenance: null });
    expect(results[0]!.truncation!.problems.join('; ')).toMatch(problem);
  });

  it('a router-only truncation with unknown cost stops the schedule', async () => {
    api.outcomes.set(ids[0]!, { ...TRUNCATED_ROUTER_ONLY, usage_known: false, cost: null });
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toMatch(/is incomplete/);
    expect(results[0]!.truncation!.problems).toEqual(['unknown cost']);
  });

  it('a version 3 manifest (no v4 semantics) still stops on the truncation, also on resume', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED);
    const first = await runSchedule(deps, runs(null));
    expect(first.stopped).toMatch(/confirmatory slot c-v4-17-with-1 is incomplete/);
    expect(api.posts).toEqual([ids[0]]);
    expect(ledger.slots().get(ids[0]!)!.events.at(-1)!.detail).toEqual({ fingerprint_mismatch: false });
    expect((await runSchedule(deps, runs(null))).stopped).toMatch(/previously incomplete/);
  });

  it('v3 semantics passed explicitly stop too', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED);
    expect((await runSchedule(deps, runs(V3_SEMANTICS as typeof V4))).stopped).toMatch(/is incomplete/);
    expect(api.posts).toHaveLength(1);
  });

  it.each([
    ['unknown cost', { ...TRUNCATED, usage_known: false, cost: null }, /unknown cost/],
    ['a provenance gap (single attempt not proven)', { ...TRUNCATED, attempts: [attempt('truncated', { router: null, generation: { status: 'not_found' } })] }, /single upstream attempt is not proven/],
    ['another provider', { ...TRUNCATED, attempts: [attempt('truncated', { router: { selected: [{ provider: 'Novita', model: SERVED }], attempt: 1, attemptsCount: 1 }, generation: null })] }, /router selected Novita/],
    ['two attempts', { ...TRUNCATED, attempts: [attempt('truncated'), attempt('truncated')] }, null],
  ])('a truncation with %s still stops the schedule', async (_label, outcome, problem) => {
    api.outcomes.set(ids[0]!, outcome as Outcome);
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toMatch(/is incomplete/);
    expect(api.posts).toEqual([ids[0]]);
    if (problem) expect(results[0]!.truncation?.problems.join('; ')).toMatch(problem);
    expect((await runSchedule(deps, runs())).stopped).toMatch(/previously incomplete/);
  });

  it('a truncation without frozen provenance expectations stops (fail closed)', async () => {
    api.outcomes.set(ids[0]!, TRUNCATED);
    const { results, stopped } = await runSchedule(deps, runs(V4, false));
    expect(stopped).toMatch(/is incomplete/);
    expect(results[0]!.truncation).toEqual({ continue: false, problems: ['no frozen provenance expectations'], provenance: null });
  });

  it('a truncation that does not reproduce the frozen fingerprint stops', async () => {
    api.outcomes.set(ids[0]!, { ...TRUNCATED, non_skill_fingerprint: 'x'.repeat(64) });
    const { stopped } = await runSchedule(deps, runs());
    expect(stopped).toMatch(/did not reproduce the frozen non-Skill fingerprint/);
  });

  it.each([
    ['a 429', { dispatch_state: 'failed', usage_known: false, cost: null, attempts: [{ dispatch: 'dispatched', outcome: 'http_error' }], refusal_reason: '429 upstream rate limit' }],
    ['a schema-invalid answer', { dispatch_state: 'failed', usage_known: true, cost: 0.001, attempts: [attempt('schema_invalid')] }],
    ['a completed slot with unknown cost', { ...COMPLETED, usage_known: false, cost: null }],
  ])('every other failure still stops under v4: %s', async (_label, outcome) => {
    api.outcomes.set(ids[0]!, outcome as Outcome);
    const { results, stopped } = await runSchedule(deps, runs());
    expect(stopped).toMatch(/is incomplete/);
    expect(results[0]!.truncation).toBeUndefined();
    expect(api.posts).toEqual([ids[0]]);
  });

  it('a slot that never settles is ambiguous and stops under v4', async () => {
    api.slots.set('never', null);
    api.request = (async <T>(method: string, path: string, body?: unknown) => {
      if (method === 'POST' && path === '/experiments/runs') {
        api.posts.push((body as { slot_id: string }).slot_id);
        return { run_id: 'run-x' } as T;
      }
      return { runs: [] } as T;
    }) as typeof api.request;
    const { results, stopped } = await runSchedule({ ...deps, pollTimeoutMs: 20 }, runs());
    expect(results[0]).toMatchObject({ state: 'ambiguous' });
    expect(stopped).toMatch(/is incomplete/);
  });
});

// ---------------------------------------------------------------- report

describe('report: v4 imputation of truncated slots', () => {
  const seed = 99;
  const schedule = scheduleFor(V4, seed).map(({ slot_id, experiment, condition }) => ({ slot_id, experiment, condition }));
  const rules = { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 4, end_line: 8 }], keywords: ['expired'] } };
  const frozenNonSkill = { '17': NON_SKILL };
  const MANIFEST = 'm'.repeat(64);
  const block = '### Edge Cases and Error Paths\nthe rule';
  const execution = {
    manifestFingerprint: MANIFEST,
    phase: 'confirmatory' as const,
    fixture: () => ({ reviewer: 'Test Quality Reviewer', prNumber: 501, targetSkill: 'Edge Cases and Error Paths' }),
    skillFingerprint: (_e: string, condition: 'with' | 'without') => sha256(canonicalJson(condition === 'with' ? [block] : [])),
  };
  const runFor = (slot: (typeof schedule)[number], truncated: boolean, truncatedAttempt = attempt('truncated')): SlotRunData => ({
    run_id: `run-${slot.slot_id}`,
    cost_usd: truncated ? 0.0015 : 0.0004,
    experiment: {
      dispatch_state: truncated ? 'failed' : 'completed', diff_sha256: 'd'.repeat(64), attempts: [truncated ? truncatedAttempt : attempt('valid')],
      slot_id: slot.slot_id, experiment: '17', condition: slot.condition, phase: 'confirmatory', manifest_fingerprint: MANIFEST,
      non_skill_fingerprint: NON_SKILL, skill_fingerprint: execution.skillFingerprint('17', slot.condition),
    },
    config: { agent: 'Test Quality Reviewer', pr: 501 },
    skills_block: slot.condition === 'with' ? `<untrusted source="skill-0">\n${block}\n</untrusted>` : null,
    prompt_evidence: 'dispatched_request',
    findings: truncated ? [] : [{ file: 'src/billing/discount.test.ts', start_line: 5, end_line: 6, title: 'Expired coupon untested', rationale: 'expired' }],
  });
  const accepted = (provenance: string) => ({ fingerprint_mismatch: false, attempt_outcome: 'truncated', truncation: 'continue', truncation_provenance: provenance, truncation_problems: [] });
  const record = (slot_id: string, truncated: boolean, detail: Record<string, unknown> = truncated ? accepted('verified') : { fingerprint_mismatch: false }): SlotRecord => {
    const state = truncated ? 'failed' : 'completed';
    const cost = truncated ? 0.0015 : 0.0004;
    return { slot_id, state, phase: 'confirmatory', reservation_usd: 0.005, run_id: `run-${slot_id}`, cost_usd: cost, events: [{ at: 'now', slot_id, state, phase: 'confirmatory', reservation_usd: 0.005, cost_usd: cost, detail }] };
  };
  const truncatedIds = [schedule.find((s) => s.condition === 'with')!.slot_id, schedule.find((s) => s.condition === 'without')!.slot_id];
  const build = (semantics: typeof V4 | undefined, ledgerDetail?: Record<string, unknown>, truncatedAttempt?: ReturnType<typeof attempt>) => {
    const runs = new Map(schedule.map((s) => [s.slot_id, runFor(s, truncatedIds.includes(s.slot_id), truncatedAttempt)]));
    const ledger = new Map(schedule.map((s) => [s.slot_id, truncatedIds.includes(s.slot_id) && ledgerDetail ? record(s.slot_id, true, ledgerDetail) : record(s.slot_id, truncatedIds.includes(s.slot_id))]));
    return buildReport({ schedule, ledger, runs, rules, frozenNonSkill, expectations: () => expectations, execution, ...(semantics ? { semantics } : {}) });
  };

  it('imputes a truncated with slot as no and a truncated without slot as yes, never counted, labelled', () => {
    const report = build(V4);
    const [w, wo] = truncatedIds.map((id) => report.rows.find((r) => r.slot_id === id)!);
    expect(w).toMatchObject({ counted: false, imputed: { verdict: 'no', label: 'imputed (truncated)', provenance: 'verified' } });
    expect(wo).toMatchObject({ counted: false, imputed: { verdict: 'yes', label: 'imputed (truncated)' } });
    expect(report.rows.filter((r) => !truncatedIds.includes(r.slot_id)).every((r) => r.counted && r.imputed === null)).toBe(true);
    expect(report.summaries[0]).toMatchObject({ outcome: 'incomplete', with: { counted: 4 }, without: { counted: 4 }, imputed: { with: 1, without: 1 } });
    expect(report.summaries[0]!.note).toMatch(/imputed \(truncated\): 1 with as no, 1 without as yes/);
    expect(renderReport(report)).toContain('no; imputed (truncated): no');
    expect(renderReport(report)).toContain('no; imputed (truncated): yes');
  });

  it('imputes a v3-shaped router-only truncation and records its provenance level in the row', () => {
    const report = build(V4, accepted('router_metadata_only'), V3_SHAPED_ATTEMPT);
    const rows = truncatedIds.map((id) => report.rows.find((r) => r.slot_id === id)!);
    expect(rows.map((r) => r.imputed)).toEqual([
      { verdict: 'no', label: 'imputed (truncated)', provenance: 'router_metadata_only' },
      { verdict: 'yes', label: 'imputed (truncated)', provenance: 'router_metadata_only' },
    ]);
    expect(renderReport(report)).toContain('no; imputed (truncated): no [router_metadata_only]');
    // The trace must support the level the runner recorded.
    expect(build(V4, accepted('verified'), V3_SHAPED_ATTEMPT).rows.filter((r) => r.imputed)).toEqual([]);
    // Version 3 semantics do not impute it.
    expect(build(undefined, accepted('router_metadata_only'), V3_SHAPED_ATTEMPT).rows.some((r) => 'imputed' in r)).toBe(false);
  });

  it('a version 3 report of the same data imputes nothing and has no imputation fields', () => {
    const report = build(undefined);
    expect(report.rows.every((r) => !('imputed' in r))).toBe(true);
    expect(report.summaries.every((s) => !('imputed' in s))).toBe(true);
    expect(renderReport(report)).not.toContain('imputed');
  });

  it('imputes only a truncation the runner accepted under the frozen rule', () => {
    const report = build(V4, { fingerprint_mismatch: false, attempt_outcome: 'truncated', truncation: 'stop', truncation_problems: ['unknown cost'] });
    expect(report.rows.filter((r) => r.imputed)).toEqual([]);
  });
});
