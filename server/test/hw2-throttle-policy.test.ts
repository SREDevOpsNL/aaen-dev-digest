/**
 * Mutation record (rerun by hand: apply one change to throttle-policy.ts, run
 * this file, expect at least one failure, revert). Each was checked on
 * 2026-11-02:
 *   1. drop the P1 stop on a 429 (`if (policy.id === 'P1') stopped = …`);
 *   2. cap off by one (`steps.length >= cap` → `>`);
 *   3. validator: allow a re-attempt after a non-429 (`previous.outcome.kind !== 'throttled'` → false);
 *   4. worst case without the missing *without* trials (`withoutDetected + missing(wo)` → `withoutDetected`);
 *   5. validator: drop the pacing check;
 *   6. validator: drop the fixed-order check (`planned.trial_index !== expectedTrial` → false);
 *   7. validator: drop the end-of-trace completeness check;
 *   8. claim: ignore non-429 failures (`onlyThrottled = …` → true);
 *   9. DP: ignore the burst state (`throttleProbability(model, index, streak > 0)` → `(model, index, false)`);
 *  10. execute: never reset the 429 streak (drop `streak = 0;` after a response).
 */
import { describe, expect, it } from 'vitest';
import { CAPS } from '../src/experiments/hw2/budget.js';
import { buildSchedule, mulberry32, type Slot } from '../src/experiments/hw2/schedule.js';
import {
  ATTEMPT_ID,
  COST_INPUTS_20261102,
  EMPIRICAL_THROTTLE_RATE,
  MAX_SIMULATION_RUNS,
  PROPOSED_PACING,
  PROPOSED_POLICIES,
  THROTTLE_SCENARIOS,
  closedFormCompletion,
  costCeiling,
  delayBefore,
  drawOutcome,
  exactMetrics,
  execute,
  expectedSpend,
  fisherTwoSided,
  fromSequence,
  maxAttempts,
  missingnessBalance,
  planAttempts,
  seedFromHex,
  sensitivity,
  simulate,
  traceProblems,
  type AttemptOutcome,
  type Execution,
  type OutcomeModel,
  type PlannedAttempt,
  type Policy,
  type Tally,
  type TraceStep,
} from '../src/experiments/hw2/throttle-policy.js';

// An illustrative schedule only: a real study derives its seed from its frozen manifest.
const SCHEDULE = buildSchedule({ seed: seedFromHex('11a2b5e0'), phase: 'confirmatory', experiments: ['17'], trials: 5, tag: 'v5' });
const P1: Policy = { id: 'P1' };
const P2: Policy = { id: 'P2' };
const P3: Policy = { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30 };
const P3_CAPPED: Policy = { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 12 };
const P3_OUTAGE: Policy = { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30, maxConsecutiveThrottles: 6 };
const H1: OutcomeModel['detect'] = { with: 0.8, without: 0.2 };

const OBS = (detected = true): AttemptOutcome => ({ kind: 'observed', detected });
const THR: AttemptOutcome = { kind: 'throttled' };
const FAIL: AttemptOutcome = { kind: 'failed' };
const TRUNC = (eligible: boolean): AttemptOutcome => ({ kind: 'truncated', eligible });

const toTrace = (execution: Execution): TraceStep[] =>
  execution.steps.map((step) => ({ attempt_id: step.attempt.attempt_id, outcome: step.outcome, delay_before_ms: step.attempt.delay_before_ms }));

/** Random outcome sequences (including detections, failures and truncations) for property checks. */
function randomOutcomes(seed: number): (attempt: PlannedAttempt) => AttemptOutcome {
  const random = mulberry32(seed);
  return (attempt) => drawOutcome(random, { throttle: 0.45, detect: H1, truncate: 0.05, truncationEligible: 0.7, fail: 0.03 }, attempt.condition);
}

const tally = (over: Partial<Tally>): Tally => ({ scheduled: 5, observed: 0, detected: 0, imputed: 0, throttled: 0, failed: 0, not_dispatched: 0, ...over });

describe('HW2 429 policy: the predeclared plan', () => {
  it('uses the seeded trial order and a1…aK inside each trial, with IDs no v3/v4 slot can equal', () => {
    const plan = planAttempts(SCHEDULE, P3);
    expect(plan).toHaveLength(30);
    expect(plan.filter((a) => a.attempt === 1).map((a) => a.trial_id)).toEqual(SCHEDULE.map((s) => s.slot_id));
    expect(plan.slice(0, 3).map((a) => a.attempt_id)).toEqual([`${SCHEDULE[0]!.slot_id}-a1`, `${SCHEDULE[0]!.slot_id}-a2`, `${SCHEDULE[0]!.slot_id}-a3`]);
    for (const attempt of plan) expect(attempt.attempt_id).toMatch(ATTEMPT_ID);
    expect(ATTEMPT_ID.test('c-v4-17-with-2')).toBe(false);
    expect(planAttempts(SCHEDULE, P2)).toHaveLength(10);
  });

  it('pacing depends only on the attempt index, and rejects a plan with too few declared backoffs', () => {
    expect(delayBefore(PROPOSED_PACING, 0, 1)).toBe(0);
    expect(delayBefore(PROPOSED_PACING, 4, 1)).toBe(30_000);
    expect(delayBefore(PROPOSED_PACING, 4, 2)).toBe(60_000);
    expect(delayBefore(PROPOSED_PACING, 4, 3)).toBe(180_000);
    expect(() => planAttempts(SCHEDULE, { id: 'P3', attemptsPerTrial: 4, maxTotalAttempts: 40 })).toThrow(/backoff/);
    expect(() => planAttempts(SCHEDULE, { id: 'P3', attemptsPerTrial: 0, maxTotalAttempts: 10 })).toThrow(/attemptsPerTrial/);
  });

  it('gives an attempt the same delay in every outcome sequence, and the same delay to both conditions at equal index', () => {
    // An all-429 run dispatches every planned attempt: its delays are the reference.
    const reference = new Map(execute(SCHEDULE, P3, () => THR).steps.map((step) => [step.attempt.attempt_id, step.attempt.delay_before_ms]));
    expect(reference.size).toBe(30);
    for (let seed = 1; seed <= 200; seed++) {
      for (const step of execute(SCHEDULE, P3, randomOutcomes(seed)).steps) {
        expect(step.attempt.delay_before_ms).toBe(reference.get(step.attempt.attempt_id));
      }
    }
    const byIndex = new Map<string, Set<number>>();
    for (const attempt of planAttempts(SCHEDULE, P3)) {
      const k = `${attempt.trial_index === 0 ? 'first' : 'later'}-${attempt.attempt}`;
      byIndex.set(k, (byIndex.get(k) ?? new Set()).add(attempt.delay_before_ms));
    }
    for (const delays of byIndex.values()) expect(delays.size).toBe(1);
    // A different schedule (different conditions per position) gets the same delays per position.
    const other = buildSchedule({ seed: 7, phase: 'confirmatory', experiments: ['17'], trials: 5, tag: 'v5' });
    expect(planAttempts(other, P3).map((a) => a.delay_before_ms)).toEqual(planAttempts(SCHEDULE, P3).map((a) => a.delay_before_ms));
  });
});

describe('HW2 429 policy: protocol state machines', () => {
  it('P1 stops at the first 429 and dispatches nothing after it', () => {
    const run = execute(SCHEDULE, P1, fromSequence([OBS(), OBS(false), THR, OBS(), OBS()]));
    expect(run.steps).toHaveLength(3);
    expect(run.stopped).toEqual({ reason: 'throttle', attempt_id: `${SCHEDULE[2]!.slot_id}-a1` });
    expect(run.trials.filter((t) => t.status === 'not_dispatched')).toHaveLength(7);
    expect(run.trials[2]!.status).toBe('throttled');
  });

  it('P2 never consumes a replacement: one attempt per trial, a 429 leaves the trial missing and the schedule goes on', () => {
    const outcomes = [THR, OBS(), THR, THR, OBS(false), OBS(), THR, OBS(), OBS(), OBS()];
    const run = execute(SCHEDULE, P2, fromSequence(outcomes));
    expect(run.steps).toHaveLength(10);
    expect(run.steps.every((step) => step.attempt.attempt === 1)).toBe(true);
    expect(run.trials.map((t) => t.status)).toEqual(outcomes.map((o) => (o.kind === 'throttled' ? 'throttled' : 'observed')));
    expect(run.stopped).toBeNull();
    for (let seed = 1; seed <= 300; seed++) expect(execute(SCHEDULE, P2, randomOutcomes(seed)).steps.length).toBeLessThanOrEqual(10);
  });

  it('P3 opens the next attempt ID of a trial only after a 429 on the previous one', () => {
    const run = execute(SCHEDULE, P3, fromSequence([THR, THR, OBS(), OBS(false), THR, THR, THR, OBS(), ...Array(7).fill(OBS())]));
    expect(run.trials[0]).toMatchObject({ status: 'observed', attempts: 3 });
    expect(run.trials[1]).toMatchObject({ status: 'observed', attempts: 1, detected: false });
    expect(run.trials[2]).toMatchObject({ status: 'throttled', attempts: 3 });
    expect(run.trials[3]).toMatchObject({ status: 'observed', attempts: 1 });
    expect(run.trials.every((t) => t.status !== 'not_dispatched')).toBe(true);
  });

  it('P3 never triggers a new attempt on a detection outcome, positive or negative', () => {
    for (const outcome of [OBS(true), OBS(false)]) {
      const run = execute(SCHEDULE, P3, () => outcome);
      expect(run.steps).toHaveLength(10);
      expect(run.steps.every((step) => step.attempt.attempt === 1)).toBe(true);
    }
  });

  it('P3 never exceeds its per-trial or total attempt cap, and stops when the cap would be passed', () => {
    const all429 = execute(SCHEDULE, P3, () => THR);
    expect(all429.steps).toHaveLength(30);
    expect(all429.trials.every((t) => t.status === 'throttled' && t.attempts === 3)).toBe(true);
    const capped = execute(SCHEDULE, P3_CAPPED, () => THR);
    expect(capped.steps).toHaveLength(12);
    expect(capped.stopped?.reason).toBe('attempt_cap');
    expect(capped.trials.filter((t) => t.status === 'not_dispatched')).toHaveLength(6);
    for (let seed = 1; seed <= 500; seed++) {
      const run = execute(SCHEDULE, P3_CAPPED, randomOutcomes(seed));
      expect(run.steps.length).toBeLessThanOrEqual(maxAttempts(P3_CAPPED, 10));
      for (const trial of run.trials) expect(trial.attempts).toBeLessThanOrEqual(3);
    }
  });

  it('keeps condition allocation and trial order unchanged whatever the outcomes (randomization invariance)', () => {
    const plan = planAttempts(SCHEDULE, P3).map((a) => a.attempt_id);
    for (const policy of [P1, P2, P3, P3_CAPPED, P3_OUTAGE]) {
      const planBefore = planAttempts(SCHEDULE, policy);
      // Reference allocation from a run where nothing goes wrong; every other outcome sequence must match it.
      const allocation = execute(SCHEDULE, policy, () => OBS()).trials.map((t) => [t.trial_id, t.condition]);
      for (let seed = 1; seed <= 300; seed++) {
        const run = execute(SCHEDULE, policy, randomOutcomes(seed));
        expect(run.trials.map((t) => [t.trial_id, t.condition])).toEqual(allocation);
        // The trials actually entered are a prefix of that allocation, in the same order.
        const enteredIds = run.trials.filter((t) => t.attempts > 0).map((t) => t.trial_id);
        expect(enteredIds).toEqual(allocation.slice(0, enteredIds.length).map(([id]) => id));
        // The attempts used are a subsequence of the predeclared plan, in plan order.
        const used = run.steps.map((step) => plan.indexOf(step.attempt.attempt_id));
        expect(used.every((index) => index >= 0)).toBe(true);
        expect([...used].sort((a, b) => a - b)).toEqual(used);
        // Trials are entered strictly in schedule order, none skipped.
        const entered = run.steps.filter((step) => step.attempt.attempt === 1).map((step) => step.attempt.trial_index);
        expect(entered).toEqual(entered.map((_, i) => i));
        expect(traceProblems(SCHEDULE, policy, toTrace(run))).toEqual([]);
      }
      expect(planAttempts(SCHEDULE, policy)).toEqual(planBefore);
    }
  });

  it('treats a truncation by the v4 rule: no new attempt; eligible is imputed against the hypothesis, ineligible stops', () => {
    const withIndex = SCHEDULE.findIndex((s) => s.condition === 'with');
    const withoutIndex = SCHEDULE.findIndex((s) => s.condition === 'without');
    const eligible = execute(SCHEDULE, P3, (attempt) => (attempt.trial_index === withIndex || attempt.trial_index === withoutIndex ? TRUNC(true) : OBS()));
    expect(eligible.steps).toHaveLength(10);
    expect(eligible.trials[withIndex]).toMatchObject({ status: 'imputed', detected: false, attempts: 1 });
    expect(eligible.trials[withoutIndex]).toMatchObject({ status: 'imputed', detected: true, attempts: 1 });
    expect(eligible.tallies.with.imputed + eligible.tallies.without.imputed).toBe(2);

    const ineligible = execute(SCHEDULE, P3, fromSequence([OBS(), TRUNC(false), OBS()]));
    expect(ineligible.steps).toHaveLength(2);
    expect(ineligible.stopped?.reason).toBe('ineligible_truncation');
    expect(ineligible.trials.slice(2).every((t) => t.status === 'not_dispatched')).toBe(true);
  });

  it('the outage stop ends the study after the declared number of consecutive 429s, counted across trials and reset by any response', () => {
    const outage = execute(SCHEDULE, P3_OUTAGE, () => THR);
    expect(outage.steps).toHaveLength(6);
    expect(outage.stopped).toEqual({ reason: 'throttle_outage', attempt_id: `${SCHEDULE[1]!.slot_id}-a3` });
    expect(outage.trials.slice(0, 2).every((t) => t.status === 'throttled')).toBe(true);
    expect(outage.trials.slice(2).every((t) => t.status === 'not_dispatched')).toBe(true);
    expect(sensitivity(outage.tallies)).toMatchObject({ missing_only_throttled: true, claim: 'incomplete' });
    // Five 429s, a response, five more: never six in a row.
    const pattern = [THR, THR, THR, THR, THR, OBS(), THR, THR, THR, THR, THR, OBS(), ...Array(20).fill(OBS())];
    expect(execute(SCHEDULE, P3_OUTAGE, fromSequence(pattern)).stopped).toBeNull();
    // Under P2 the streak runs across trials.
    const p2 = execute(SCHEDULE, { id: 'P2', maxConsecutiveThrottles: 3 }, fromSequence([OBS(), THR, THR, THR, OBS()]));
    expect(p2.steps).toHaveLength(4);
    expect(p2.stopped?.reason).toBe('throttle_outage');
    expect(traceProblems(SCHEDULE, P3_OUTAGE, toTrace(outage))).toEqual([]);
    const overrun = [...toTrace(outage), { attempt_id: `${SCHEDULE[2]!.slot_id}-a1`, outcome: OBS() }];
    expect(traceProblems(SCHEDULE, P3_OUTAGE, overrun).join()).toMatch(/after the protocol stopped/);
    expect(() => planAttempts(SCHEDULE, { id: 'P2', maxConsecutiveThrottles: 0 })).toThrow(/maxConsecutiveThrottles/);
  });

  it('a non-429 failure stops every policy without a new attempt', () => {
    for (const policy of [P1, P2, P3]) {
      const run = execute(SCHEDULE, policy, fromSequence([OBS(), FAIL, OBS()]));
      expect(run.steps).toHaveLength(2);
      expect(run.stopped?.reason).toBe('failure');
    }
  });
});

describe('HW2 429 policy: trace validator rejects protocol mutations', () => {
  const reference = (outcomes: AttemptOutcome[], policy: Policy = P3) => toTrace(execute(SCHEDULE, policy, fromSequence(outcomes)));
  const id = (trial: number, attempt: number) => `${SCHEDULE[trial]!.slot_id}-a${attempt}`;

  it('accepts the reference executions', () => {
    expect(traceProblems(SCHEDULE, P3, reference([THR, OBS(), ...Array(9).fill(OBS())]))).toEqual([]);
    expect(traceProblems(SCHEDULE, P1, reference([OBS(), THR], P1))).toEqual([]);
  });

  it('rejects a re-attempt after a non-429 failure', () => {
    const trace: TraceStep[] = [{ attempt_id: id(0, 1), outcome: FAIL }, { attempt_id: id(0, 2), outcome: OBS() }];
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/after the protocol stopped/);
  });

  it('rejects a re-attempt after an observed non-detection (outcome-driven retry)', () => {
    const trace: TraceStep[] = [{ attempt_id: id(0, 1), outcome: OBS(false) }, { attempt_id: id(0, 2), outcome: OBS(true) }];
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/observed, not a 429/);
  });

  it('rejects a re-attempt after an eligible truncation', () => {
    const trace: TraceStep[] = [{ attempt_id: id(0, 1), outcome: TRUNC(true) }, { attempt_id: id(0, 2), outcome: OBS() }];
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/truncated, not a 429/);
  });

  it('rejects catching up a lagging arm by jumping ahead to its next trial', () => {
    const behind = SCHEDULE.findIndex((s, i) => i > 1 && s.condition === SCHEDULE[0]!.condition);
    const trace: TraceStep[] = [{ attempt_id: id(0, 1), outcome: OBS() }, { attempt_id: id(behind, 1), outcome: OBS() }];
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/fixed order/);
  });

  it('rejects skipping the remaining attempts of a throttled trial, and anything after a P1 stop', () => {
    expect(traceProblems(SCHEDULE, P3, [{ attempt_id: id(0, 1), outcome: THR }, { attempt_id: id(1, 1), outcome: OBS() }]).join()).toMatch(/skips/);
    expect(traceProblems(SCHEDULE, P1, [{ attempt_id: id(0, 1), outcome: THR }, { attempt_id: id(1, 1), outcome: OBS() }]).join()).toMatch(/stopped/);
  });

  it('rejects a replacement under P2, an attempt ID beyond the pool, and an extra attempt over the cap', () => {
    expect(traceProblems(SCHEDULE, P2, [{ attempt_id: id(0, 1), outcome: THR }, { attempt_id: id(0, 2), outcome: OBS() }]).join()).toMatch(/not a predeclared/);
    expect(traceProblems(SCHEDULE, P3, [{ attempt_id: `${SCHEDULE[0]!.slot_id}-a4`, outcome: OBS() }]).join()).toMatch(/not a predeclared/);
    const overCap = toTrace(execute(SCHEDULE, P3_CAPPED, () => THR));
    overCap.push({ attempt_id: id(4, 1), outcome: OBS() });
    expect(traceProblems(SCHEDULE, P3_CAPPED, overCap).join()).toMatch(/exceed the cap/);
  });

  it('rejects a trace that stops early (optional stopping) after six observed trials', () => {
    const early = reference(Array(10).fill(OBS())).slice(0, 6);
    expect(traceProblems(SCHEDULE, P3, early).join()).toMatch(/ends before the protocol terminates: after trial 6 of 10/);
    expect(traceProblems(SCHEDULE, P2, reference(Array(10).fill(OBS()), P2).slice(0, 6)).join()).toMatch(/ends before/);
    expect(traceProblems(SCHEDULE, P3, []).join()).toMatch(/no attempt was dispatched/);
  });

  it('rejects abandoning the last trial after a 429 on a1, with a2 and a3 never sent', () => {
    const trace = reference([...Array(9).fill(OBS()), THR, OBS()]).slice(0, 10);
    expect(trace[9]!.attempt_id).toBe(id(9, 1));
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/still owes attempt a2/);
    // The same ending is complete under P2, where a 429 resolves the trial.
    expect(traceProblems(SCHEDULE, P2, reference([...Array(9).fill(OBS()), THR], P2))).toEqual([]);
    // And a trace that ends at the attempt cap is complete.
    expect(traceProblems(SCHEDULE, P3_CAPPED, toTrace(execute(SCHEDULE, P3_CAPPED, () => THR)))).toEqual([]);
  });

  it('rejects pacing that shortens or lengthens a delay in reaction to an outcome', () => {
    const trace = reference([OBS(true), ...Array(9).fill(OBS())]);
    trace[1] = { ...trace[1]!, delay_before_ms: 0 };
    expect(traceProblems(SCHEDULE, P3, trace).join()).toMatch(/waited 0 ms/);
  });
});

describe('HW2 429 policy: P4 sensitivity', () => {
  it('imputes missing with → no and missing without → yes in the worst case, the opposite in the best', () => {
    // 4/4 observed with detected, 1 missing; 0/4 observed without detected, 1 missing.
    const s = sensitivity({ with: tally({ observed: 4, detected: 4, throttled: 1 }), without: tally({ observed: 4, throttled: 1 }) });
    expect(s).toMatchObject({ strict: 'incomplete', worst_case: 'success', best_case: 'success', bounded: 'success', missing_only_throttled: true, claim: 'detected' });
    // 3/4 with, 1 missing: succeeds only if the missing with trial would have detected.
    const t = sensitivity({ with: tally({ observed: 4, detected: 3, throttled: 1 }), without: tally({ observed: 5 }) });
    expect(t).toMatchObject({ strict: 'incomplete', worst_case: 'inconclusive', best_case: 'success', bounded: 'undecided', claim: 'incomplete' });
    // 2 missing without trials and 1 observed detection: worst case 3/5 without.
    const u = sensitivity({ with: tally({ observed: 5, detected: 5 }), without: tally({ observed: 3, detected: 1, throttled: 2 }) });
    expect(u).toMatchObject({ worst_case: 'inconclusive', best_case: 'success', bounded: 'undecided', claim: 'incomplete' });
    // Even the best case fails: not detected, whatever the missing trials were.
    const v = sensitivity({ with: tally({ observed: 3, detected: 1, throttled: 2 }), without: tally({ observed: 5, detected: 1 }) });
    expect(v).toMatchObject({ worst_case: 'negative', best_case: 'inconclusive', bounded: 'undecided', claim: 'not_detected' });
  });

  it('licenses no claim when a trial is missing because of a non-429 failure stop (v4: incomplete)', () => {
    const tallies = { with: tally({ observed: 4, detected: 4, failed: 1 }), without: tally({ observed: 5 }) };
    expect(sensitivity(tallies)).toMatchObject({ worst_case: 'success', missing_only_throttled: false, claim: 'incomplete' });
    // Through the state machine: nine clean trials, then a provenance failure on the last one.
    const run = execute(SCHEDULE, P3, fromSequence([...SCHEDULE.slice(0, 9).map((slot) => OBS(slot.condition === 'with')), FAIL]));
    expect(run.stopped?.reason).toBe('failure');
    expect(sensitivity(run.tallies).claim).toBe('incomplete');
    // A model with failures: the claim probability never exceeds that of the same study without the failure branch.
    const withFail = exactMetrics(SCHEDULE, P3, { throttle: 0.2, detect: H1, fail: 0.05 });
    expect(withFail.worst_case_pass).toBeLessThan(exactMetrics(SCHEDULE, P3, { throttle: 0.2, detect: H1 }).worst_case_pass);
  });

  it('is monotone: a worst-case success implies success, and a best-case non-success implies non-success, for every value of the missing trials', () => {
    for (let wo = 0; wo <= 5; wo++) for (let wd = 0; wd <= wo; wd++) for (let oo = 0; oo <= 5; oo++) for (let od = 0; od <= oo; od++) {
      const tallies = { with: tally({ observed: wo, detected: wd, throttled: 5 - wo }), without: tally({ observed: oo, detected: od, throttled: 5 - oo }) };
      const s = sensitivity(tallies);
      for (let x = 0; x <= 5 - wo; x++) for (let y = 0; y <= 5 - oo; y++) {
        const full = sensitivity({ with: tally({ observed: 5, detected: wd + x }), without: tally({ observed: 5, detected: od + y }) }).strict;
        if (s.claim === 'detected') expect(full).toBe('success');
        if (s.claim === 'not_detected') expect(full).not.toBe('success');
      }
    }
  });

  it('keeps a v4-imputed truncation conservative in both bounds and decides fully observed tallies strictly', () => {
    const s = sensitivity({ with: tally({ observed: 5, detected: 4 }), without: tally({ observed: 4, imputed: 1, detected: 1 }) });
    // The imputed without truncation counts as a detection: 2/5 without fails, in every bound.
    expect(s).toMatchObject({ strict: 'inconclusive', worst_case: 'inconclusive', best_case: 'inconclusive', bounded: 'inconclusive', claim: 'not_detected' });
    expect(sensitivity({ with: tally({ observed: 5, detected: 4 }), without: tally({ observed: 5, detected: 1 }) }).strict).toBe('success');
    expect(sensitivity({ with: tally({ observed: 5, detected: 1 }), without: tally({ observed: 5, detected: 3 }) }).strict).toBe('negative');
  });

  it('reports missingness per condition with a Fisher exact p-value', () => {
    const balance = missingnessBalance({ with: tally({ observed: 2, throttled: 3 }), without: tally({ observed: 5 }) });
    expect(balance).toMatchObject({ missing_with: 3, missing_without: 0, scheduled_with: 5, scheduled_without: 5 });
    expect(balance.fisher_two_sided_p).toBeCloseTo(0.16667, 5);
    expect(fisherTwoSided(0, 5, 0, 5)).toBe(1);
    expect(fisherTwoSided(5, 0, 0, 5)).toBeCloseTo(2 / 252, 10);
  });
});

describe('HW2 429 policy: exact probabilities and seeded simulation', () => {
  it('matches the closed forms for P1, P2 and uncapped P3', () => {
    for (const p of THROTTLE_SCENARIOS) {
      for (const policy of [P1, P2, P3, { id: 'P3', attemptsPerTrial: 2, maxTotalAttempts: 20 } as Policy]) {
        const exact = exactMetrics(SCHEDULE, policy, { throttle: p, detect: H1 });
        const closed = closedFormCompletion(policy, p, 10);
        expect(exact.all_observed).toBeCloseTo(closed.all_observed, 12);
        closed.counted_distribution.forEach((mass, k) => expect(exact.counted_distribution[k]).toBeCloseTo(mass, 12));
        expect(exact.counted_distribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it('reproduces the known pass probability ≈ 0.5436 at 0.8 / 0.2 with no 429s, and the headline completion values', () => {
    expect(exactMetrics(SCHEDULE, P1, { throttle: 0, detect: H1 }).strict_pass).toBeCloseTo(0.73728 ** 2, 10);
    expect(exactMetrics(SCHEDULE, P1, { throttle: 0.2, detect: H1 }).all_observed).toBeCloseTo(0.8 ** 10, 12);
    expect(exactMetrics(SCHEDULE, P3, { throttle: 0.2, detect: H1 }).all_observed).toBeCloseTo((1 - 0.008) ** 10, 12);
    expect(exactMetrics(SCHEDULE, P3, { throttle: 0.4, detect: H1 }).all_observed).toBeCloseTo(0.5161, 4);
  });

  it('gives the proposal values at Agent R empirical rates (4/19 overall, 3/9 for #17)', () => {
    expect(exactMetrics(SCHEDULE, P1, { throttle: EMPIRICAL_THROTTLE_RATE.overall, detect: H1 }).all_observed).toBeCloseTo(0.0941, 4);
    expect(exactMetrics(SCHEDULE, P3, { throttle: EMPIRICAL_THROTTLE_RATE.overall, detect: H1 }).all_observed).toBeCloseTo(0.9105, 4);
    expect(exactMetrics(SCHEDULE, P3, { throttle: EMPIRICAL_THROTTLE_RATE.experiment17, detect: H1 }).all_observed).toBeCloseTo(0.6856, 4);
  });

  it('bounds false positives under every equal-rate null: 0.0352 at q = 0.5, never raised by P4', () => {
    let peak = 0;
    for (let i = 0; i <= 10; i++) {
      const q = i / 10;
      const full = exactMetrics(SCHEDULE, P1, { throttle: 0, detect: { with: q, without: q } }).strict_pass;
      peak = Math.max(peak, full);
      for (const policy of [P1, P2, P3]) {
        for (const p of [0.02, 0.2, 0.4]) expect(exactMetrics(SCHEDULE, policy, { throttle: p, detect: { with: q, without: q } }).worst_case_pass).toBeLessThanOrEqual(full + 1e-12);
      }
    }
    expect(peak).toBeCloseTo(0.0352, 4);
    expect(exactMetrics(SCHEDULE, P3, { throttle: 0.2, detect: { with: 0.5, without: 0.5 } }).worst_case_pass).toBeCloseTo(0.0333, 4);
    expect(exactMetrics(SCHEDULE, P3, { throttle: 0.02, detect: { with: 0.2, without: 0.2 } }).worst_case_pass).toBeLessThanOrEqual(0.005);
  });

  it('models a position hazard (0.6 at schedule position 2, 0.15 elsewhere) and a burst carried across trials', () => {
    const position = Array(10).fill(0.15);
    position[1] = 0.6;
    expect(SCHEDULE[1]!.condition).toBe('with');
    const p3 = exactMetrics(SCHEDULE, P3, { throttle: 0.15, throttleByPosition: position, detect: H1 });
    expect(p3.expected_missing.with).toBeCloseTo(0.229, 3);
    expect(p3.expected_missing.without).toBeCloseTo(0.017, 3);
    const p2 = exactMetrics(SCHEDULE, P2, { throttle: 0.15, throttleByPosition: position, detect: H1 });
    expect(p2.expected_missing.with).toBeCloseTo(1.2, 3);
    expect(p2.expected_missing.without).toBeCloseTo(0.75, 3);
    for (const [rho, all, decided] of [[0.5, 0.5987, 0.8464], [0.8, 0.2542, 0.5641]] as const) {
      const m = exactMetrics(SCHEDULE, P3, { throttle: 0.2, burst: rho, detect: H1 });
      expect(m.all_observed).toBeCloseTo(all, 4);
      expect(m.bounded_decided).toBeCloseTo(decided, 4);
    }
  });

  it('matches every published table cell of the proposal', () => {
    const policies = [P1, P2, { id: 'P3', attemptsPerTrial: 2, maxTotalAttempts: 20 } as Policy, P3];
    const rates = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 4 / 19, 3 / 9, 4 / 11];
    // P(all observed) (P1 = P2), 4 decimals.
    const all = [[0.8171, 0.996, 0.9999], [0.5987, 0.9753, 0.9988], [0.3487, 0.9044, 0.99], [0.1074, 0.6648, 0.9228], [0.0282, 0.3894, 0.7606], [0.006, 0.1749, 0.5161], [0.0941, 0.6355, 0.9105], [0.0173, 0.3079, 0.6856], [0.0109, 0.2421, 0.6109]];
    // P(claim decided), H1 / H0, 3 decimals.
    const decided = [
      [[0.85, 0.923], [0.94, 0.998], [0.999, 1], [1, 1]],
      [[0.664, 0.818], [0.854, 0.993], [0.992, 1], [1, 1]],
      [[0.437, 0.666], [0.72, 0.984], [0.97, 0.999], [0.997, 1]],
      [[0.184, 0.433], [0.501, 0.952], [0.882, 0.995], [0.976, 0.999]],
      [[0.076, 0.272], [0.345, 0.897], [0.745, 0.986], [0.92, 0.997]],
      [[0.031, 0.162], [0.239, 0.811], [0.58, 0.967], [0.815, 0.991]],
      [[0.168, 0.413], [0.482, 0.948], [0.87, 0.994], [0.972, 0.999]],
      [[0.056, 0.23], [0.305, 0.872], [0.692, 0.981], [0.891, 0.995]],
      [[0.043, 0.197], [0.273, 0.846], [0.642, 0.976], [0.859, 0.994]],
    ];
    // Pass probability under H1, strict / claim (worst case), 3 decimals, for the rows the proposal prints.
    const pass: Record<number, number[][]> = {
      0: [[0.444, 0.452], [0.444, 0.496], [0.541, 0.543], [0.544, 0.544]],
      2: [[0.19, 0.208], [0.19, 0.325], [0.492, 0.52], [0.538, 0.541]],
      3: [[0.058, 0.072], [0.058, 0.168], [0.361, 0.45], [0.502, 0.524]],
      5: [[0.003, 0.006], [0.003, 0.027], [0.095, 0.222], [0.281, 0.397]],
      6: [[0.051, 0.064], [0.051, 0.155], [0.345, 0.44], [0.495, 0.521]],
      7: [[0.009, 0.014], [0.009, 0.054], [0.167, 0.304], [0.373, 0.457]],
      8: [[0.006, 0.009], [0.006, 0.04], [0.132, 0.267], [0.332, 0.432]],
    };
    rates.forEach((p, row) => {
      const h1 = policies.map((policy) => exactMetrics(SCHEDULE, policy, { throttle: p, detect: H1 }));
      const h0 = policies.map((policy) => exactMetrics(SCHEDULE, policy, { throttle: p, detect: { with: 0.2, without: 0.2 } }));
      expect([h1[1]!, h1[2]!, h1[3]!].map((m) => Number(m.all_observed.toFixed(4)))).toEqual(all[row]);
      expect(h1.map((m, i) => [Number(m.bounded_decided.toFixed(3)), Number(h0[i]!.bounded_decided.toFixed(3))])).toEqual(decided[row]);
      if (pass[row]) expect(h1.map((m) => [Number(m.strict_pass.toFixed(3)), Number(m.worst_case_pass.toFixed(3))])).toEqual(pass[row]);
    });
  });

  it('matches the recommendation numbers for P3 K=3, M=30 with the outage stop at 6', () => {
    const at = (model: OutcomeModel) => exactMetrics(SCHEDULE, P3_OUTAGE, model);
    for (const [p, all, decided, detected] of [[3 / 9, 0.6856, 0.887, 0.456], [4 / 11, 0.6109, 0.853, 0.43], [4 / 19, 0.9105, 0.972, 0.521], [0.2, 0.9228, 0.976, 0.524]] as const) {
      const m = at({ throttle: p, detect: H1 });
      expect(Number(m.all_observed.toFixed(4))).toBe(all);
      expect(Number(m.bounded_decided.toFixed(3))).toBe(decided);
      expect(Number(m.worst_case_pass.toFixed(3))).toBe(detected);
    }
    expect(Number(at({ throttle: 0.4, detect: H1 }).bounded_decided.toFixed(3))).toBe(0.805);
    for (const [rho, decided, detected] of [[0.5, 0.832, 0.419], [0.8, 0.487, 0.216]] as const) {
      const m = at({ throttle: 0.2, burst: rho, detect: H1 });
      expect([Number(m.bounded_decided.toFixed(3)), Number(m.worst_case_pass.toFixed(3))]).toEqual([decided, detected]);
    }
    expect(at({ throttle: 1, detect: H1 }).expected_attempts).toBe(6);
  });

  it('a fixed seed gives a fixed simulation result', () => {
    const a = simulate(SCHEDULE, P3, { throttle: 0.3, detect: H1 }, 2_000, seedFromHex('5eed0001'));
    const b = simulate(SCHEDULE, P3, { throttle: 0.3, detect: H1 }, 2_000, seedFromHex('5eed0001'));
    expect(a).toEqual(b);
    expect(Math.round(a.all_observed * 2_000)).toBe(SNAPSHOT.allObserved);
    expect(Math.round(a.strict_pass * 2_000)).toBe(SNAPSHOT.strictPass);
    expect(Math.round(a.expected_attempts * 2_000)).toBe(SNAPSHOT.attempts);
  });

  it('agrees with the exact values within sampling tolerance, for every policy, including a binding cap and failures', () => {
    const runs = 20_000;
    const models: OutcomeModel[] = [
      { throttle: 0.2, detect: H1 },
      { throttle: 0.4, detect: { with: 0.2, without: 0.2 } },
      { throttle: 0.3, detect: H1, truncate: 0.05, truncationEligible: 0.5, fail: 0.02 },
      { throttle: 0.2, burst: 0.6, detect: H1 },
      { throttle: 0.15, throttleByPosition: [0.15, 0.6, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15], detect: H1 },
    ];
    let seed = 1;
    for (const model of models) {
      for (const policy of [P1, P2, P3, P3_CAPPED, { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30, maxConsecutiveThrottles: 4 } as Policy]) {
        const exact = exactMetrics(SCHEDULE, policy, model);
        const sim = simulate(SCHEDULE, policy, model, runs, seed++);
        const tol = (x: number) => 4.5 * Math.sqrt((x * (1 - x)) / runs) + 1e-3;
        for (const key of ['all_observed', 'strict_pass', 'worst_case_pass', 'best_case_pass', 'bounded_decided', 'bounded_same_outcome'] as const) {
          expect(Math.abs(sim[key] - exact[key])).toBeLessThan(tol(exact[key]));
        }
        exact.counted_distribution.forEach((mass, k) => expect(Math.abs(sim.counted_distribution[k]! - mass)).toBeLessThan(tol(mass)));
        expect(Math.abs(sim.expected_attempts - exact.expected_attempts)).toBeLessThan(0.15);
        expect(sim.max_attempts).toBeLessThanOrEqual(exact.max_attempts);
      }
    }
  });
});

describe('HW2 429 policy: cost ceilings', () => {
  it('declares max attempts × $0.005 as the capability budget on top of the $0.02174118 ledger', () => {
    expect(costCeiling(P1, 10)).toMatchObject({ max_attempts: 10, new_reservations_usd: 0.05, cumulative_ceiling_usd: 0.07174118 });
    expect(costCeiling(P2, 10)).toMatchObject({ max_attempts: 10, new_reservations_usd: 0.05 });
    expect(costCeiling(P3, 10)).toMatchObject({ max_attempts: 30, new_reservations_usd: 0.15, cumulative_ceiling_usd: 0.17174118, billed_worst_case_usd: 0.1031697 });
    expect(costCeiling(P3_CAPPED, 10)).toMatchObject({ max_attempts: 12, new_reservations_usd: 0.06 });
    for (const policy of Object.values(PROPOSED_POLICIES)) {
      const ceiling = costCeiling(policy, 10);
      expect(ceiling.reservation_covers_worst_case).toBe(true);
      expect(ceiling.fits_caps).toBe(true);
      expect(COST_INPUTS_20261102.ledgerConfirmatoryUsd + ceiling.new_reservations_usd).toBeLessThanOrEqual(CAPS.confirmatory);
    }
    expect(costCeiling({ id: 'P3', attemptsPerTrial: 9, maxTotalAttempts: 1_000 }, 30, { ...COST_INPUTS_20261102, reservationUsd: 0.005 }).max_attempts).toBe(270);
    expect(costCeiling({ id: 'P3', attemptsPerTrial: 9, maxTotalAttempts: 250 }, 30).fits_caps).toBe(false);
  });

  it('refuses an invalid policy, an invalid model or an unbounded simulation', () => {
    const bad = { id: 'P3', attemptsPerTrial: 0, maxTotalAttempts: 10 } as Policy;
    expect(() => costCeiling(bad, 10)).toThrow(/attemptsPerTrial/);
    expect(() => costCeiling({ id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 1.5 }, 10)).toThrow(/maxTotalAttempts/);
    expect(() => exactMetrics(SCHEDULE, bad, { throttle: 0.1, detect: H1 })).toThrow(/attemptsPerTrial/);
    expect(() => exactMetrics(SCHEDULE, P3, { throttle: 1.2, detect: H1 })).toThrow(/\[0, 1\]/);
    expect(() => simulate(SCHEDULE, P3, { throttle: 0.1, detect: H1 }, 0, 1)).toThrow(/runs/);
    expect(() => simulate(SCHEDULE, P3, { throttle: 0.1, detect: H1 }, 1.5, 1)).toThrow(/runs/);
    expect(() => simulate(SCHEDULE, P3, { throttle: 0.1, detect: H1 }, MAX_SIMULATION_RUNS + 1, 1)).toThrow(/runs/);
  });

  it('no execution, whatever the outcomes, reserves more than the declared budget', () => {
    for (const policy of [P1, P2, P3, P3_CAPPED]) {
      const budget = costCeiling(policy, 10).new_reservations_usd;
      for (let seed = 1; seed <= 300; seed++) {
        const run = execute(SCHEDULE, policy, randomOutcomes(seed));
        expect(run.steps.length * COST_INPUTS_20261102.reservationUsd).toBeLessThanOrEqual(budget + 1e-12);
      }
      expect(execute(SCHEDULE, policy, () => THR).steps.length * COST_INPUTS_20261102.reservationUsd).toBeLessThanOrEqual(budget + 1e-12);
    }
  });

  it('holds each 429 at its reservation in the expected conservative ledger growth', () => {
    const m = exactMetrics(SCHEDULE, P2, { throttle: 0.2, detect: H1 });
    const spend = expectedSpend(m);
    expect(m.expected_throttled_attempts).toBeCloseTo(2, 12);
    expect(spend.actual_low_usd).toBeCloseTo(8 * 0.00035, 12);
    expect(spend.conservative_ledger_growth_low_usd).toBeCloseTo(8 * 0.00035 + 2 * 0.005, 12);
  });
});

/** Recorded from the first run of the seeded simulation; a change means the PRNG or the protocol changed. */
const SNAPSHOT = { allObserved: 1_490, strictPass: 827, attempts: 27_907 };
