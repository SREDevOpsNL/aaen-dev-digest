/**
 * HW2 upstream-429 policy model (unapproved proposal, unpaid). A pure,
 * deterministic model of four ways a future #17 confirmatory study could
 * treat an HTTP 429 from a shared upstream pool, so the policies can be
 * compared before any freeze:
 *
 * - P1 stop on the first 429 (the v4 status quo);
 * - P2 a 429 makes its trial an unobserved outcome; no re-attempt, no
 *   replacement, the schedule continues;
 * - P3 a predeclared pool of attempt IDs per trial, used in a fixed order and
 *   only after a 429 on the previous attempt of the same trial, under a hard
 *   cap on the total number of attempts;
 * - P4 any of the above, plus a worst-case and a best-case imputation of the
 *   missing trials (`sensitivity`), both reported.
 *
 * Nothing here dispatches, reads a file, a clock or `Math.random`. The runner
 * does not use this module; adopting a policy is a new pre-registration and a
 * separate, reviewed runner change. See
 * `docs/homework/L02/proposals/429-policy-proposal.md`.
 */

import { experimentOutcome } from './rules.js';
import { mulberry32, type Condition, type Slot } from './schedule.js';

// ---------------------------------------------------------------------------
// Outcomes and policies
// ---------------------------------------------------------------------------

/**
 * What one dispatched attempt produced, as the runner would classify it.
 * `throttled` is an HTTP 429 refused before generation: no response ID and no
 * usage. A 429 that carries either is not `throttled`; it is `failed`.
 */
export type AttemptOutcome =
  | { kind: 'observed'; detected: boolean }
  | { kind: 'throttled' }
  /** v4 rule: `eligible` continues and is imputed (with → no, without → yes); otherwise the schedule stops. */
  | { kind: 'truncated'; eligible: boolean }
  /** Timeout, 5xx, schema failure, provenance gap, fingerprint mismatch, ambiguity: always a stop. */
  | { kind: 'failed' };

export type PolicyId = 'P1' | 'P2' | 'P3';

export type Policy =
  | { id: 'P1' }
  | { id: 'P2' }
  /** `maxTotalAttempts` is the hard cap across the whole study; it never exceeds trials × `attemptsPerTrial`. */
  | { id: 'P3'; attemptsPerTrial: number; maxTotalAttempts: number };

export const attemptsPerTrial = (policy: Policy): number => (policy.id === 'P3' ? policy.attemptsPerTrial : 1);

/** The most attempts a policy can dispatch over `trials` scheduled trials. */
export function maxAttempts(policy: Policy, trials: number): number {
  return policy.id === 'P3' ? Math.min(policy.maxTotalAttempts, trials * policy.attemptsPerTrial) : trials;
}

export function policyProblems(policy: Policy): string[] {
  if (policy.id !== 'P3') return [];
  const problems: string[] = [];
  if (!Number.isInteger(policy.attemptsPerTrial) || policy.attemptsPerTrial < 1 || policy.attemptsPerTrial > 9) {
    problems.push('attemptsPerTrial must be an integer from 1 to 9');
  }
  if (!Number.isInteger(policy.maxTotalAttempts) || policy.maxTotalAttempts < 1) problems.push('maxTotalAttempts must be a positive integer');
  return problems;
}

// ---------------------------------------------------------------------------
// Pacing: data, fixed in advance, a function of the attempt index only
// ---------------------------------------------------------------------------

export interface Pacing {
  /** Delay before the first attempt of every trial except the study's first. */
  interTrialDelayMs: number;
  /** `backoffMs[k - 1]` is the delay before attempt k + 1 of a trial, i.e. after its k-th attempt got a 429. */
  backoffMs: readonly number[];
}

/** The proposed pacing: 30 s between trials; 60 s, then 180 s after a 429. No jitter, no adaptation. */
export const PROPOSED_PACING: Pacing = Object.freeze({ interTrialDelayMs: 30_000, backoffMs: Object.freeze([60_000, 180_000]) });

/**
 * The delay before an attempt. Its only inputs are the attempt's place in the
 * plan: what any earlier attempt returned is not an input, so the pacing
 * cannot react to a detection, a condition or an arm being behind.
 */
export function delayBefore(pacing: Pacing, trialIndex: number, attemptIndex: number): number {
  if (attemptIndex === 1) return trialIndex === 0 ? 0 : pacing.interTrialDelayMs;
  const delay = pacing.backoffMs[attemptIndex - 2];
  if (delay === undefined) throw new Error(`No predeclared backoff before attempt ${attemptIndex}`);
  return delay;
}

// ---------------------------------------------------------------------------
// The predeclared attempt plan
// ---------------------------------------------------------------------------

/** `c-<tag>-<experiment>-<condition>-<trial>-a<k>`: never equal to a v3/v4 slot ID, which has no `-a<k>`. */
export const ATTEMPT_ID = /^c-(v[0-9]{1,3})-([0-9]+)-(with|without)-([1-9][0-9]*)-a([1-9])$/;

export function attemptId(slot: Pick<Slot, 'slot_id'>, attempt: number): string {
  const id = `${slot.slot_id}-a${attempt}`;
  if (!ATTEMPT_ID.test(id)) throw new Error(`"${id}" is not a tagged confirmatory attempt ID`);
  return id;
}

export interface PlannedAttempt {
  attempt_id: string;
  /** Position in the plan: the only order attempts may be used in. */
  plan_index: number;
  trial_id: string;
  trial_index: number;
  condition: Condition;
  /** 1-based attempt number within the trial. */
  attempt: number;
  delay_before_ms: number;
}

/**
 * Every attempt ID the policy may ever use, in the one order it may use them:
 * the seeded trial order, and inside each trial a1, a2, … . The plan is built
 * before any outcome exists and does not take one as input.
 */
export function planAttempts(schedule: readonly Slot[], policy: Policy, pacing: Pacing = PROPOSED_PACING): PlannedAttempt[] {
  const problems = policyProblems(policy);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const per = attemptsPerTrial(policy);
  if (pacing.backoffMs.length < per - 1) throw new Error(`Pacing declares ${pacing.backoffMs.length} backoff delays; ${per - 1} needed`);
  const plan: PlannedAttempt[] = [];
  schedule.forEach((slot, trialIndex) => {
    for (let attempt = 1; attempt <= per; attempt++) {
      plan.push({
        attempt_id: attemptId(slot, attempt),
        plan_index: plan.length,
        trial_id: slot.slot_id,
        trial_index: trialIndex,
        condition: slot.condition,
        attempt,
        delay_before_ms: delayBefore(pacing, trialIndex, attempt),
      });
    }
  });
  return plan;
}

// ---------------------------------------------------------------------------
// The protocol state machine
// ---------------------------------------------------------------------------

export type TrialStatus =
  /** Scored from an observed response. */
  | 'observed'
  /** An eligible truncation, imputed by the frozen v4 rule (with → no, without → yes). */
  | 'imputed'
  /** Every attempt it was allowed got a 429. */
  | 'throttled'
  /** It hit a stop rule (failure or ineligible truncation). */
  | 'failed'
  | 'not_dispatched';

export interface TrialResult {
  trial_id: string;
  condition: Condition;
  status: TrialStatus;
  detected: boolean | null;
  attempts: number;
}

export interface Tally {
  scheduled: number;
  observed: number;
  /** Detections among `observed`. */
  detected: number;
  imputed: number;
  throttled: number;
  failed: number;
  not_dispatched: number;
}

export type StopReason = 'throttle' | 'failure' | 'ineligible_truncation' | 'attempt_cap';

export interface ExecutionStep {
  attempt: PlannedAttempt;
  outcome: AttemptOutcome;
}

export interface Execution {
  policy: Policy;
  steps: ExecutionStep[];
  trials: TrialResult[];
  stopped: { reason: StopReason; attempt_id: string | null } | null;
  tallies: Record<Condition, Tally>;
}

const emptyTally = (): Tally => ({ scheduled: 0, observed: 0, detected: 0, imputed: 0, throttled: 0, failed: 0, not_dispatched: 0 });

/** Counted trials: what the frozen rule scores (observed plus v4-imputed truncations). */
export const counted = (tally: Tally) => tally.observed + tally.imputed;
export const missing = (tally: Tally) => tally.scheduled - counted(tally);

/**
 * Run a policy over the plan. `outcomeOf` answers what an attempt returned; it
 * is called only for attempts the protocol dispatches, in plan order. The
 * protocol's only reaction to an outcome is the one its policy declares: a
 * 429 may (P3) open the next attempt ID of the same trial, any other outcome
 * closes the trial, and a failure stops the study.
 */
export function execute(
  schedule: readonly Slot[],
  policy: Policy,
  outcomeOf: (attempt: PlannedAttempt) => AttemptOutcome,
  pacing: Pacing = PROPOSED_PACING,
): Execution {
  const plan = planAttempts(schedule, policy, pacing);
  const per = attemptsPerTrial(policy);
  const cap = maxAttempts(policy, schedule.length);
  const steps: ExecutionStep[] = [];
  const trials: TrialResult[] = [];
  const tallies: Record<Condition, Tally> = { with: emptyTally(), without: emptyTally() };
  let stopped: Execution['stopped'] = null;

  for (let index = 0; index < schedule.length; index++) {
    const slot = schedule[index]!;
    const tally = tallies[slot.condition];
    tally.scheduled++;
    const result: TrialResult = { trial_id: slot.slot_id, condition: slot.condition, status: 'not_dispatched', detected: null, attempts: 0 };
    trials.push(result);
    if (stopped) { tally.not_dispatched++; continue; }
    for (let attempt = 1; attempt <= per; attempt++) {
      if (steps.length >= cap) {
        stopped = { reason: 'attempt_cap', attempt_id: null };
        if (attempt === 1) tally.not_dispatched++;
        else { result.status = 'throttled'; tally.throttled++; }
        break;
      }
      const planned = plan[index * per + attempt - 1]!;
      const outcome = outcomeOf(planned);
      steps.push({ attempt: planned, outcome });
      result.attempts = attempt;
      if (outcome.kind === 'throttled') {
        if (policy.id === 'P1') stopped = { reason: 'throttle', attempt_id: planned.attempt_id };
        if (policy.id === 'P1' || attempt === per) { result.status = 'throttled'; tally.throttled++; break; }
        continue;
      }
      if (outcome.kind === 'observed') {
        result.status = 'observed';
        result.detected = outcome.detected;
        tally.observed++;
        if (outcome.detected) tally.detected++;
      } else if (outcome.kind === 'truncated' && outcome.eligible) {
        result.status = 'imputed';
        result.detected = slot.condition === 'without';
        tally.imputed++;
      } else {
        result.status = 'failed';
        tally.failed++;
        stopped = { reason: outcome.kind === 'truncated' ? 'ineligible_truncation' : 'failure', attempt_id: planned.attempt_id };
      }
      break;
    }
  }
  return { policy, steps, trials, stopped, tallies };
}

/** Replay a fixed outcome sequence: the i-th dispatched attempt gets `outcomes[i]` (a missing entry is a test error). */
export function fromSequence(outcomes: readonly AttemptOutcome[]): (attempt: PlannedAttempt) => AttemptOutcome {
  let next = 0;
  return () => {
    const outcome = outcomes[next++];
    if (!outcome) throw new Error(`Outcome sequence exhausted after ${outcomes.length} attempts`);
    return outcome;
  };
}

// ---------------------------------------------------------------------------
// Validator: does a recorded trace follow the declared protocol?
// ---------------------------------------------------------------------------

export interface TraceStep {
  attempt_id: string;
  outcome: AttemptOutcome;
  /** The delay the operator actually waited, when recorded. */
  delay_before_ms?: number;
}

/**
 * Every way a recorded sequence of attempts departs from the declared
 * protocol (empty when it follows it). This is how a protocol variant that
 * re-attempts after a non-429, reorders trials, or catches up a lagging arm is
 * rejected.
 */
export function traceProblems(schedule: readonly Slot[], policy: Policy, trace: readonly TraceStep[], pacing: Pacing = PROPOSED_PACING): string[] {
  const plan = planAttempts(schedule, policy, pacing);
  const byId = new Map(plan.map((attempt) => [attempt.attempt_id, attempt]));
  const per = attemptsPerTrial(policy);
  const cap = maxAttempts(policy, schedule.length);
  const problems: string[] = [];
  if (trace.length > cap) problems.push(`${trace.length} attempts exceed the cap of ${cap}`);
  let previous: { planned: PlannedAttempt; outcome: AttemptOutcome } | null = null;
  let ended = false;
  for (const step of trace) {
    const planned = byId.get(step.attempt_id);
    if (!planned) { problems.push(`${step.attempt_id} is not a predeclared attempt ID`); break; }
    if (ended) { problems.push(`${step.attempt_id} was dispatched after the protocol stopped`); break; }
    if (step.delay_before_ms !== undefined && step.delay_before_ms !== planned.delay_before_ms) {
      problems.push(`${step.attempt_id} waited ${step.delay_before_ms} ms; the plan declares ${planned.delay_before_ms} ms`);
    }
    if (planned.attempt > 1) {
      if (!previous || previous.planned.trial_id !== planned.trial_id || previous.planned.attempt !== planned.attempt - 1) {
        problems.push(`${step.attempt_id} does not follow attempt ${planned.attempt - 1} of the same trial`);
      } else if (previous.outcome.kind !== 'throttled') {
        problems.push(`${step.attempt_id} re-attempts a trial whose previous attempt was ${previous.outcome.kind}, not a 429`);
      }
    } else {
      const expectedTrial = previous ? previous.planned.trial_index + 1 : 0;
      if (planned.trial_index !== expectedTrial) problems.push(`${step.attempt_id} is trial ${planned.trial_index + 1}; the fixed order requires trial ${expectedTrial + 1}`);
      if (previous && previous.outcome.kind === 'throttled' && previous.planned.attempt < per && policy.id === 'P3') {
        problems.push(`${step.attempt_id} skips the remaining predeclared attempts of ${previous.planned.trial_id}`);
      }
    }
    const { outcome } = step;
    if (outcome.kind === 'failed' || (outcome.kind === 'truncated' && !outcome.eligible)) ended = true;
    if (outcome.kind === 'throttled' && policy.id === 'P1') ended = true;
    previous = { planned, outcome };
    if (problems.length > 0) break;
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The frozen rule, strict and with P4 sensitivity bounds
// ---------------------------------------------------------------------------

export type StrictVerdict = 'pass' | 'fail' | 'undecidable';

export interface Sensitivity {
  /** The frozen rule on counted trials only: undecidable unless all five per condition are counted. */
  strict: StrictVerdict;
  /** Missing with → not detected, missing without → detected (against the hypothesis). */
  worst_case_pass: boolean;
  /** Missing with → detected, missing without → not detected (for the hypothesis). */
  best_case_pass: boolean;
  /** The verdict every imputation agrees on, or `undecided` when worst and best case differ. */
  bounded: 'pass' | 'fail' | 'undecided';
}

/**
 * The frozen #17 rule (`experimentOutcome`, ≥4/5 with and ≤1/5 without),
 * applied to a tally. v4-imputed truncations keep their frozen conservative
 * value in both bounds; only missing trials (429, failure, not dispatched)
 * are imputed both ways.
 */
export function sensitivity(tallies: Record<Condition, Tally>): Sensitivity {
  const w = tallies.with;
  const wo = tallies.without;
  const withDetected = w.detected;
  const withoutDetected = wo.detected + wo.imputed;
  const pass = (wd: number, wc: number, wod: number, woc: number) => experimentOutcome(wd, wc, wod, woc) === 'success';
  const strict: StrictVerdict =
    counted(w) < w.scheduled || counted(wo) < wo.scheduled || w.scheduled < 5 || wo.scheduled < 5
      ? 'undecidable'
      : pass(withDetected, counted(w), withoutDetected, counted(wo)) ? 'pass' : 'fail';
  const worst = pass(withDetected, w.scheduled, withoutDetected + missing(wo), wo.scheduled);
  const best = pass(withDetected + missing(w), w.scheduled, withoutDetected, wo.scheduled);
  return { strict, worst_case_pass: worst, best_case_pass: best, bounded: worst === best ? (worst ? 'pass' : 'fail') : 'undecided' };
}

/**
 * The balance check reported with every result: missing trials per condition
 * and the two-sided Fisher exact p-value of missing × condition. With five
 * trials per arm it can only flag gross imbalance; it is reported, not tested.
 */
export function missingnessBalance(tallies: Record<Condition, Tally>) {
  const a = missing(tallies.with);
  const b = counted(tallies.with);
  const c = missing(tallies.without);
  const d = counted(tallies.without);
  return { missing_with: a, missing_without: c, scheduled_with: a + b, scheduled_without: c + d, fisher_two_sided_p: fisherTwoSided(a, b, c, d) };
}

function logChoose(n: number, k: number): number {
  let total = 0;
  for (let i = 1; i <= k; i++) total += Math.log(n - k + i) - Math.log(i);
  return total;
}

/** Two-sided Fisher exact test for [[a, b], [c, d]]: the mass of tables no more likely than the observed one. */
export function fisherTwoSided(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const col1 = a + c;
  const n = a + b + c + d;
  const prob = (x: number) => Math.exp(logChoose(row1, x) + logChoose(n - row1, col1 - x) - logChoose(n, col1));
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, col1 - (n - row1)); x <= Math.min(row1, col1); x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-9)) p += px;
  }
  return Math.min(1, p);
}

// ---------------------------------------------------------------------------
// Outcome model, exact distribution and seeded simulation
// ---------------------------------------------------------------------------

/** Independent per-attempt outcome probabilities (the model behind the probability tables). */
export interface OutcomeModel {
  /** P(HTTP 429) per attempt, independent of condition, time and every other attempt. */
  throttle: number;
  /** P(detected | observed) per condition. */
  detect: Record<Condition, number>;
  /** P(truncated | not throttled); default 0. */
  truncate?: number;
  /** P(eligible | truncated); default 1. */
  truncationEligible?: number;
  /** P(other failure | not throttled); default 0. */
  fail?: number;
}

export interface PolicyMetrics {
  /** P(all trials counted): the strict rule is decidable. */
  all_observed: number;
  /** P(exactly k trials counted), k = 0 … trials. */
  counted_distribution: number[];
  strict_pass: number;
  worst_case_pass: number;
  best_case_pass: number;
  /** P(worst and best case agree): the rule is decided whatever the missing trials were. */
  bounded_decided: number;
  expected_attempts: number;
  expected_throttled_attempts: number;
  expected_missing: Record<Condition, number>;
  /** The largest attempt count with positive probability. */
  max_attempts: number;
}

interface TerminalState { tallies: Record<Condition, Tally>; attempts: number }

/**
 * The exact distribution of terminal states, by dynamic programming over the
 * trials in schedule order (sums of products of the model's probabilities).
 * It mirrors the protocol independently of `execute`; the simulation
 * cross-check in the tests is what ties the two together.
 */
export function exactTerminalStates(schedule: readonly Slot[], policy: Policy, model: OutcomeModel): Array<{ state: TerminalState; probability: number }> {
  const per = attemptsPerTrial(policy);
  const cap = maxAttempts(policy, schedule.length);
  const p = model.throttle;
  const t = model.truncate ?? 0;
  const e = model.truncationEligible ?? 1;
  const f = model.fail ?? 0;
  type Live = { state: TerminalState; probability: number; stopped: boolean };
  const key = (s: TerminalState, stopped: boolean) => JSON.stringify([s.attempts, stopped, s.tallies.with, s.tallies.without]);
  const clone = (s: TerminalState): TerminalState => ({ attempts: s.attempts, tallies: { with: { ...s.tallies.with }, without: { ...s.tallies.without } } });
  let states = new Map<string, Live>();
  const start: TerminalState = { attempts: 0, tallies: { with: emptyTally(), without: emptyTally() } };
  states.set(key(start, false), { state: start, probability: 1, stopped: false });

  for (const slot of schedule) {
    const next = new Map<string, Live>();
    const add = (state: TerminalState, probability: number, stopped: boolean) => {
      if (probability === 0) return;
      const k = key(state, stopped);
      const existing = next.get(k);
      if (existing) existing.probability += probability;
      else next.set(k, { state, probability, stopped });
    };
    for (const live of states.values()) {
      const base = clone(live.state);
      base.tallies[slot.condition].scheduled++;
      if (live.stopped) {
        const s = clone(base);
        s.tallies[slot.condition].not_dispatched++;
        add(s, live.probability, true);
        continue;
      }
      let reach = live.probability; // P(every earlier attempt of this trial got a 429)
      for (let attempt = 1; attempt <= per; attempt++) {
        if (base.attempts + attempt - 1 >= cap) {
          const s = clone(base);
          s.attempts += attempt - 1;
          if (attempt === 1) s.tallies[slot.condition].not_dispatched++;
          else s.tallies[slot.condition].throttled++;
          add(s, reach, true);
          reach = 0;
          break;
        }
        const after = (mutate: (tally: Tally) => void, probability: number, stopped: boolean) => {
          const s = clone(base);
          s.attempts += attempt;
          mutate(s.tallies[slot.condition]);
          add(s, reach * probability, stopped);
        };
        const go = 1 - p;
        const scored = go * (1 - t - f);
        const q = model.detect[slot.condition];
        after((tally) => { tally.observed++; tally.detected++; }, scored * q, false);
        after((tally) => { tally.observed++; }, scored * (1 - q), false);
        after((tally) => { tally.imputed++; }, go * t * e, false);
        after((tally) => { tally.failed++; }, go * (t * (1 - e) + f), true);
        if (policy.id === 'P1' || attempt === per) {
          after((tally) => { tally.throttled++; }, p, policy.id === 'P1');
          reach = 0;
          break;
        }
        reach *= p;
      }
    }
    states = next;
  }
  return [...states.values()].map(({ state, probability }) => ({ state, probability }));
}

function metricsFrom(entries: Iterable<{ state: TerminalState; probability: number }>, trials: number): PolicyMetrics {
  const m: PolicyMetrics = {
    all_observed: 0,
    counted_distribution: new Array<number>(trials + 1).fill(0),
    strict_pass: 0,
    worst_case_pass: 0,
    best_case_pass: 0,
    bounded_decided: 0,
    expected_attempts: 0,
    expected_throttled_attempts: 0,
    expected_missing: { with: 0, without: 0 },
    max_attempts: 0,
  };
  for (const { state, probability } of entries) {
    if (probability <= 0) continue;
    const { with: w, without: wo } = state.tallies;
    const total = counted(w) + counted(wo);
    m.counted_distribution[total]! += probability;
    if (total === trials) m.all_observed += probability;
    const s = sensitivity(state.tallies);
    if (s.strict === 'pass') m.strict_pass += probability;
    if (s.worst_case_pass) m.worst_case_pass += probability;
    if (s.best_case_pass) m.best_case_pass += probability;
    if (s.bounded !== 'undecided') m.bounded_decided += probability;
    m.expected_attempts += probability * state.attempts;
    // Every dispatched attempt that did not end its trial with a response or a failure got a 429.
    const answered = w.observed + w.imputed + w.failed + wo.observed + wo.imputed + wo.failed;
    m.expected_throttled_attempts += probability * (state.attempts - answered);
    m.expected_missing.with += probability * missing(w);
    m.expected_missing.without += probability * missing(wo);
    m.max_attempts = Math.max(m.max_attempts, state.attempts);
  }
  return m;
}

/** Exact metrics of a policy under an independent outcome model. */
export function exactMetrics(schedule: readonly Slot[], policy: Policy, model: OutcomeModel): PolicyMetrics {
  return metricsFrom(exactTerminalStates(schedule, policy, model), schedule.length);
}

/** Closed forms for the uncapped policies (independent 429s, no truncation or failure). */
export function closedFormCompletion(policy: Policy, throttle: number, trials: number): { all_observed: number; counted_distribution: number[] } {
  const binomial = (r: number) =>
    Array.from({ length: trials + 1 }, (_, k) => Math.exp(logChoose(trials, k)) * r ** k * (1 - r) ** (trials - k));
  if (policy.id === 'P1') {
    const dist = Array.from({ length: trials + 1 }, (_, k) => (k < trials ? (1 - throttle) ** k * throttle : (1 - throttle) ** trials));
    return { all_observed: (1 - throttle) ** trials, counted_distribution: dist };
  }
  if (policy.id === 'P2') return { all_observed: (1 - throttle) ** trials, counted_distribution: binomial(1 - throttle) };
  if (policy.maxTotalAttempts < trials * policy.attemptsPerTrial) throw new Error('No closed form for a binding attempt cap; use exactMetrics');
  const r = 1 - throttle ** policy.attemptsPerTrial;
  return { all_observed: r ** trials, counted_distribution: binomial(r) };
}

/** The 32-bit seed of a hex string: its first 8 hex digits, as `deriveSeed` in manifest.ts takes them. */
export function seedFromHex(hex: string): number {
  if (!/^[0-9a-f]{8,}$/i.test(hex)) throw new Error('A seed needs at least 8 hex digits');
  return Number.parseInt(hex.slice(0, 8), 16) >>> 0;
}

/** Draw one attempt outcome from the model with a seeded generator. */
export function drawOutcome(random: () => number, model: OutcomeModel, condition: Condition): AttemptOutcome {
  if (random() < model.throttle) return { kind: 'throttled' };
  const u = random();
  const f = model.fail ?? 0;
  const t = model.truncate ?? 0;
  if (u < f) return { kind: 'failed' };
  if (u < f + t) return { kind: 'truncated', eligible: random() < (model.truncationEligible ?? 1) };
  return { kind: 'observed', detected: random() < model.detect[condition] };
}

/** Seeded Monte Carlo estimate of the same metrics, through the real `execute` state machine. */
export function simulate(schedule: readonly Slot[], policy: Policy, model: OutcomeModel, runs: number, seed: number): PolicyMetrics {
  const random = mulberry32(seed);
  const entries: Array<{ state: TerminalState; probability: number }> = [];
  for (let run = 0; run < runs; run++) {
    const execution = execute(schedule, policy, (attempt) => drawOutcome(random, model, attempt.condition));
    entries.push({ state: { tallies: execution.tallies, attempts: execution.steps.length }, probability: 1 / runs });
  }
  return metricsFrom(entries, schedule.length);
}

// ---------------------------------------------------------------------------
// Cost ceilings
// ---------------------------------------------------------------------------

/** Measured inputs as of 2026-11-02; recompute before any freeze. */
export const COST_INPUTS_20261102 = Object.freeze({
  /** Per-attempt reservation, unchanged from v4. */
  reservationUsd: 0.005,
  /** Worst case of one 17-with request at the 8,000-token cap (v4 approval packet). */
  worstCasePerAttemptUsd: 0.00343899,
  /** Settled actual cost of a completed #17 request, low and high. */
  actualPerCallUsd: Object.freeze({ low: 0.00035, high: 0.0008 }),
  /** Global conservative ledger after v4 (the 429 slot holds its $0.005). */
  ledgerConservativeUsd: 0.02174118,
  /** Confirmatory phase share of that ledger: v3 $0.00234162 + v4 $0.00035478 + the held $0.005. */
  ledgerConfirmatoryUsd: 0.0076964,
  confirmatoryCapUsd: 1.0,
  totalCapUsd: 1.5,
});

export type CostInputs = typeof COST_INPUTS_20261102;

/** USD in units of 1e-8, so sums of reservations are exact. */
const units = (usd: number) => Math.round(usd * 1e8);
const usd = (u: number) => u / 1e8;

export interface CostCeiling {
  max_attempts: number;
  /** The capability budget: every attempt reserved at once. */
  new_reservations_usd: number;
  /** Charged now plus the budget: what `writeCapability` would check against. */
  cumulative_ceiling_usd: number;
  /** If every attempt stayed at unknown cost, the ledger rises by the full budget. */
  worst_case_ledger_impact_usd: number;
  /** The reservation covers 1.2 × the per-attempt worst case (the phase-0 rule). */
  reservation_covers_worst_case: boolean;
  fits_caps: boolean;
}

export function costCeiling(policy: Policy, trials: number, inputs: CostInputs = COST_INPUTS_20261102): CostCeiling {
  const attempts = maxAttempts(policy, trials);
  const budget = attempts * units(inputs.reservationUsd);
  const ceiling = units(inputs.ledgerConservativeUsd) + budget;
  return {
    max_attempts: attempts,
    new_reservations_usd: usd(budget),
    cumulative_ceiling_usd: usd(ceiling),
    worst_case_ledger_impact_usd: usd(budget),
    reservation_covers_worst_case: 1.2 * inputs.worstCasePerAttemptUsd <= inputs.reservationUsd + 1e-12,
    fits_caps: units(inputs.ledgerConfirmatoryUsd) + budget <= units(inputs.confirmatoryCapUsd) && ceiling <= units(inputs.totalCapUsd),
  };
}

/**
 * Expected spend from exact metrics. Actual: answered attempts × the measured
 * per-call cost (a 429 so far unbilled). Conservative ledger: answered
 * attempts at their actual cost plus every 429 held at its reservation, which
 * is what today's settlement leaves on the ledger for an unknown-cost slot.
 */
export function expectedSpend(metrics: PolicyMetrics, inputs: CostInputs = COST_INPUTS_20261102) {
  const answered = metrics.expected_attempts - metrics.expected_throttled_attempts;
  const held = metrics.expected_throttled_attempts * inputs.reservationUsd;
  return {
    actual_low_usd: answered * inputs.actualPerCallUsd.low,
    actual_high_usd: answered * inputs.actualPerCallUsd.high,
    conservative_ledger_growth_low_usd: answered * inputs.actualPerCallUsd.low + held,
    conservative_ledger_growth_high_usd: answered * inputs.actualPerCallUsd.high + held,
  };
}

// ---------------------------------------------------------------------------
// Scenarios used by the proposal's tables
// ---------------------------------------------------------------------------

/** The 429 rates the proposal tabulates. */
export const THROTTLE_SCENARIOS = Object.freeze([0.02, 0.05, 0.1, 0.2, 0.3, 0.4]);

/**
 * Placeholder for Agent R's empirical 429 rate per dispatched attempt to
 * `deepinfra/fp8`. Null until R's inventory is accepted; the coordinator's
 * rough count (4 of about 19 dispatches) is not a substitute for it.
 */
export const EMPIRICAL_THROTTLE_RATE: number | null = null;

/** The policies the proposal compares (P4 is `sensitivity` applied to any of them). */
export const PROPOSED_POLICIES: Readonly<Record<string, Policy>> = Object.freeze({
  P1: { id: 'P1' },
  P2: { id: 'P2' },
  'P3 (K=2, cap 20)': { id: 'P3', attemptsPerTrial: 2, maxTotalAttempts: 20 },
  'P3 (K=3, cap 30)': { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30 },
  'P3 (K=3, cap 20)': { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 20 },
});
