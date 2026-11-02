import { describe, expect, it } from 'vitest';
import { CAPS } from '../src/experiments/hw2/budget.js';
import { buildSchedule, mulberry32, type Slot } from '../src/experiments/hw2/schedule.js';
import {
  ATTEMPT_ID,
  COST_INPUTS_20261102,
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

  it('every executed attempt waits exactly its planned delay, whatever earlier attempts returned', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const execution = execute(SCHEDULE, P3, randomOutcomes(seed));
      for (const step of execution.steps) {
        expect(step.attempt.delay_before_ms).toBe(delayBefore(PROPOSED_PACING, step.attempt.trial_index, step.attempt.attempt));
      }
    }
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
    for (const policy of [P1, P2, P3, P3_CAPPED]) {
      for (let seed = 1; seed <= 300; seed++) {
        const run = execute(SCHEDULE, policy, randomOutcomes(seed));
        expect(run.trials.map((t) => [t.trial_id, t.condition])).toEqual(SCHEDULE.map((s) => [s.slot_id, s.condition]));
        // The attempts used are a subsequence of the predeclared plan, in plan order.
        const used = run.steps.map((step) => plan.indexOf(step.attempt.attempt_id));
        expect(used.every((index) => index >= 0)).toBe(true);
        expect([...used].sort((a, b) => a - b)).toEqual(used);
        // Trials are entered strictly in schedule order, none skipped.
        const entered = run.steps.filter((step) => step.attempt.attempt === 1).map((step) => step.attempt.trial_index);
        expect(entered).toEqual(entered.map((_, i) => i));
        expect(traceProblems(SCHEDULE, policy, toTrace(run))).toEqual([]);
      }
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
    expect(s).toEqual({ strict: 'undecidable', worst_case_pass: true, best_case_pass: true, bounded: 'pass' });
    // 3/4 with, 1 missing: passes only if the missing with trial would have detected.
    const t = sensitivity({ with: tally({ observed: 4, detected: 3, throttled: 1 }), without: tally({ observed: 5 }) });
    expect(t).toEqual({ strict: 'undecidable', worst_case_pass: false, best_case_pass: true, bounded: 'undecided' });
    // 2 missing without trials and 1 observed detection: worst case 3/5 without, fails.
    const u = sensitivity({ with: tally({ observed: 5, detected: 5 }), without: tally({ observed: 3, detected: 1, throttled: 2 }) });
    expect(u).toMatchObject({ worst_case_pass: false, best_case_pass: true, bounded: 'undecided' });
  });

  it('keeps a v4-imputed truncation conservative in both bounds and decides fully observed tallies strictly', () => {
    const s = sensitivity({ with: tally({ observed: 5, detected: 4 }), without: tally({ observed: 4, imputed: 1, detected: 1 }) });
    // The imputed without truncation counts as a detection: 2/5 without fails, in every bound.
    expect(s).toEqual({ strict: 'fail', worst_case_pass: false, best_case_pass: false, bounded: 'fail' });
    expect(sensitivity({ with: tally({ observed: 5, detected: 4 }), without: tally({ observed: 5, detected: 1 }) }).strict).toBe('pass');
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
    ];
    let seed = 1;
    for (const model of models) {
      for (const policy of [P1, P2, P3, P3_CAPPED]) {
        const exact = exactMetrics(SCHEDULE, policy, model);
        const sim = simulate(SCHEDULE, policy, model, runs, seed++);
        const tol = (x: number) => 4.5 * Math.sqrt((x * (1 - x)) / runs) + 1e-3;
        for (const key of ['all_observed', 'strict_pass', 'worst_case_pass', 'best_case_pass', 'bounded_decided'] as const) {
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
    expect(costCeiling(P3, 10)).toMatchObject({ max_attempts: 30, new_reservations_usd: 0.15, cumulative_ceiling_usd: 0.17174118 });
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
