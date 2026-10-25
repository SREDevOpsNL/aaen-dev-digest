import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, ExperimentApi } from '../src/experiments/hw2/api.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { runSlot, type RunnerDeps, type SlotRun } from '../src/experiments/hw2/runner.js';

/**
 * Run Review mode (criteria 17–18, "PR page → Run Review"): the runner arms a
 * slot and the operator clicks Run Review. A fake stack API stands in for the
 * server; `clickAfterPolls` simulates the click. No network, no model.
 */
type ArmState = 'armed' | 'consumed' | 'expired' | 'disarmed';
class FakeRunReviewApi extends ExperimentApi {
  calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  arm: ArmState | null = null;
  runs: unknown[] = [];
  armError: Error | null = null;
  /** Number of slot lookups before the simulated click; null = never clicked. */
  clickAfterPolls: number | null = 1;
  /** Expire the arm server-side after this many lookups. */
  expireAfterPolls: number | null = null;
  /** The click lands while the runner disarms (a last-moment click). */
  clickOnDisarm = false;
  lookupFails = false;
  private polls = 0;
  constructor() {
    super('http://127.0.0.1:1');
  }
  private click() {
    this.arm = 'consumed';
    this.runs = [{ run_id: 'run-ui', status: 'done', cost_usd: 0.0003, experiment: { dispatch_state: 'completed', usage_known: true, attempts: [{ outcome: 'valid' }] } }];
  }
  override async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    this.calls.push({ method, path, body, headers });
    if (method === 'POST' && path.endsWith('/arm')) {
      if (this.armError) throw this.armError;
      this.arm = 'armed';
      return { slot_id: 'x', armed_until: '2026-10-25T10:10:00.000Z' } as T;
    }
    if (method === 'DELETE' && path.endsWith('/arm')) {
      if (this.clickOnDisarm && this.arm === 'armed') this.click();
      if (this.arm === 'armed') this.arm = 'disarmed';
      return { state: this.arm } as T;
    }
    if (method === 'GET' && path.startsWith('/experiments/slots/')) {
      if (this.lookupFails) throw new Error('connection refused');
      this.polls++;
      if (this.arm === 'armed' && this.clickAfterPolls !== null && this.polls >= this.clickAfterPolls) this.click();
      if (this.arm === 'armed' && this.expireAfterPolls !== null && this.polls >= this.expireAfterPolls) this.arm = 'expired';
      return { arm: this.arm ? { state: this.arm, expires_at: '2026-10-25T10:10:00.000Z' } : null, runs: this.runs } as T;
    }
    if (method === 'POST' && path === '/experiments/runs') throw new Error('Run Review mode must never POST /experiments/runs');
    return {} as T;
  }
}

describe('runner: Run Review mode (fake stack API, no network)', () => {
  let dir: string;
  let ledger: Ledger;
  let api: FakeRunReviewApi;
  let prompts: string[];
  let deps: RunnerDeps;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hw2-ui-'));
    ledger = new Ledger(dir);
    ledger.acquire({ pid: 1, stackId: 'hw2f-ui' });
    api = new FakeRunReviewApi();
    prompts = [];
    deps = {
      api,
      ledger,
      log: () => {},
      capabilityToken: 'tok-ui',
      sleep: async () => {},
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
      stackId: 'hw2f-ui',
      viaUi: { prompt: (m) => prompts.push(m), clickTimeoutMs: 40 },
    };
  });
  afterEach(() => {
    ledger.release();
    rmSync(dir, { recursive: true, force: true });
  });

  const slotRun = (id = 'x-18-with-1'): SlotRun => ({
    slot: { slot_id: id, index: 0, phase: 'exploration', experiment: '18', condition: 'with', trial: 1 },
    prId: 'pr-502',
    agentId: 'agent-api',
    agentName: 'API Contract Reviewer',
    prNumber: 502,
    skillIds: ['skill-breaking'],
    manifestFingerprint: 'f'.repeat(64),
    expectedDiffSha256: 'd'.repeat(64),
    reservationUsd: 0.01,
    expectedNonSkillFingerprint: null,
  });
  const states = (id = 'x-18-with-1') => ledger.slots().get(id)!.events.map((e) => e.state);

  it('arms after the reservation, switches the target skill on, and follows the clicked run to its cost', async () => {
    const result = await runSlot(deps, slotRun());
    expect(result).toMatchObject({ state: 'completed', runId: 'run-ui', costUsd: 0.0003 });
    expect(states()).toEqual(['reserved', 'dispatched', 'completed']);
    expect(api.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /agents/agent-api/skills',
      'PATCH /agents/agent-api/skills/skill-breaking',
      'POST /experiments/slots/x-18-with-1/arm',
    ]);
    expect(api.calls.find((c) => c.path.endsWith('/arm'))!.headers).toMatchObject({ 'x-hw2-capability': 'tok-ui' });
    expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ enabled: true });
    expect(prompts[0]).toMatch(/PR #502.*Run Review for "API Contract Reviewer"/);
    expect(ledger.slots().get('x-18-with-1')!.events.every((e) => e.stack_id === 'hw2f-ui')).toBe(true);
  });

  it('without a click before its deadline it disarms and records the slot refused at zero cost', async () => {
    api.clickAfterPolls = null;
    const result = await runSlot(deps, slotRun());
    expect(result).toMatchObject({ state: 'refused', costUsd: 0, runId: null });
    expect(states()).toEqual(['reserved', 'refused']);
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/arm'))).toBe(true);
  });

  it('records a server-side expiry as refused', async () => {
    api.clickAfterPolls = null;
    api.expireAfterPolls = 1;
    expect((await runSlot(deps, slotRun())).state).toBe('refused');
    expect(ledger.slots().get('x-18-with-1')!.events.at(-1)!.detail).toMatchObject({ reason: 'arm expired without a Run Review click' });
  });

  it('a 4xx on arm is refused: the server armed nothing', async () => {
    api.armError = new ApiError(409, null, 'POST arm → 409: still in flight');
    expect((await runSlot(deps, slotRun())).state).toBe('refused');
    expect(states()).toEqual(['reserved', 'refused']);
  });

  it('a transport error on arm is refused only when the server shows no arm and no run', async () => {
    api.armError = new Error('socket hang up');
    expect((await runSlot(deps, slotRun('x-18-with-2'))).state).toBe('refused');
    expect(states('x-18-with-2')).toEqual(['reserved', 'refused']);
  });

  it('is ambiguous, charged at its reservation, when the server cannot be asked', async () => {
    api.clickAfterPolls = null;
    api.lookupFails = true;
    const result = await runSlot(deps, slotRun());
    expect(result).toMatchObject({ state: 'ambiguous', costUsd: null, infraFailure: true });
    expect(states()).toEqual(['reserved', 'ambiguous']);
  });

  it('a click that lands while the runner disarms is followed, never left uncounted', async () => {
    api.clickAfterPolls = null;
    api.clickOnDisarm = true;
    const result = await runSlot(deps, slotRun());
    expect(result).toMatchObject({ state: 'completed', runId: 'run-ui', costUsd: 0.0003 });
    expect(states()).toEqual(['reserved', 'dispatched', 'completed']);
  });

  it('reconciliation disarms a slot a dead runner left armed, then charges it in full', async () => {
    const { reconcile } = await import('../src/experiments/hw2/runner.js');
    ledger.append({ slot_id: 'x-18-with-9', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' });
    api.arm = 'armed';
    api.clickAfterPolls = null;
    await reconcile(deps);
    expect(api.calls.find((c) => c.method === 'DELETE')).toMatchObject({ path: '/experiments/slots/x-18-with-9/arm', headers: { 'x-hw2-capability': 'tok-ui' } });
    expect(api.arm).toBe('disarmed');
    expect(ledger.slots().get('x-18-with-9')!.state).toBe('ambiguous');
  });

  it('never arms a slot that is already in the ledger', async () => {
    await runSlot(deps, slotRun());
    await expect(runSlot(deps, slotRun())).rejects.toThrow(/never replayed/);
    expect(api.calls.filter((c) => c.path.endsWith('/arm') && c.method === 'POST')).toHaveLength(1);
  });
});
