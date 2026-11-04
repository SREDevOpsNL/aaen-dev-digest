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
 * Nothing here dispatches, reads a file, a clock or `Math.random`. Only the
 * study v5 runner path uses it (`attempt-policy.ts`): the attempt plan
 * (`planAttempts`), the protocol validator (`traceProblems`) as a cross-check
 * of the ledger history, and the P4 bounds (`sensitivity`,
 * `missingnessBalance`) in the report. The v3 and v4 paths never import it.
 * See `docs/homework/L02/proposals/429-policy-proposal.md`.
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
  /** `maxConsecutiveThrottles`: an outage stop after this many classified 429s in a row, across trials (optional). */
  | { id: 'P2'; maxConsecutiveThrottles?: number }
  /** `maxTotalAttempts` is the hard cap across the whole study; it never exceeds trials × `attemptsPerTrial`. */
  | { id: 'P3'; attemptsPerTrial: number; maxTotalAttempts: number; maxConsecutiveThrottles?: number };

/** The outage stop: the number of consecutive 429s that stops the study, or null (P1 stops at the first anyway). */
export const outageLimit = (policy: Policy): number | null => (policy.id === 'P1' ? null : policy.maxConsecutiveThrottles ?? null);

export const attemptsPerTrial = (policy: Policy): number => (policy.id === 'P3' ? policy.attemptsPerTrial : 1);

/** The most attempts a policy can dispatch over `trials` scheduled trials. */
export function maxAttempts(policy: Policy, trials: number): number {
  return policy.id === 'P3' ? Math.min(policy.maxTotalAttempts, trials * policy.attemptsPerTrial) : trials;
}

export function policyProblems(policy: Policy): string[] {
  const problems: string[] = [];
  const limit = outageLimit(policy);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) problems.push('maxConsecutiveThrottles must be a positive integer');
  if (policy.id !== 'P3') return problems;
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

/** `throttle_outage`: the declared number of consecutive 429s was reached (a 429-caused stop, like `throttle` and `attempt_cap`). */
export type StopReason = 'throttle' | 'throttle_outage' | 'failure' | 'ineligible_truncation' | 'attempt_cap';

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
  const limit = outageLimit(policy);
  let streak = 0;

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
        streak++;
        const outage = limit !== null && streak >= limit;
        if (policy.id === 'P1') stopped = { reason: 'throttle', attempt_id: planned.attempt_id };
        else if (outage) stopped = { reason: 'throttle_outage', attempt_id: planned.attempt_id };
        if (policy.id === 'P1' || attempt === per || outage) { result.status = 'throttled'; tally.throttled++; break; }
        continue;
      }
      streak = 0;
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
 * re-attempts after a non-429, reorders trials, catches up a lagging arm, or
 * stops early (optional stopping, or abandoning a trial's remaining attempt
 * IDs) is rejected. A trace must end where the protocol terminates: after a
 * declared stop, at the attempt cap, or with the last trial resolved.
 */
export function traceProblems(
  schedule: readonly Slot[],
  policy: Policy,
  trace: readonly TraceStep[],
  pacing: Pacing = PROPOSED_PACING,
  /**
   * `prefix`: the trace is a run still in progress (a restarted runner's
   * history), so every step is checked but the end-of-protocol check is
   * skipped. Never use it for a finished study.
   */
  options: { prefix?: boolean } = {},
): string[] {
  const plan = planAttempts(schedule, policy, pacing);
  const byId = new Map(plan.map((attempt) => [attempt.attempt_id, attempt]));
  const per = attemptsPerTrial(policy);
  const cap = maxAttempts(policy, schedule.length);
  const problems: string[] = [];
  if (trace.length > cap) problems.push(`${trace.length} attempts exceed the cap of ${cap}`);
  let previous: { planned: PlannedAttempt; outcome: AttemptOutcome } | null = null;
  let ended = false;
  const limit = outageLimit(policy);
  let streak = 0;
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
    streak = outcome.kind === 'throttled' ? streak + 1 : 0;
    if (limit !== null && streak >= limit) ended = true;
    previous = { planned, outcome };
    if (problems.length > 0) break;
  }
  if (!options.prefix && problems.length === 0 && !ended && trace.length < cap && schedule.length > 0) {
    if (!previous) problems.push('the trace ends before the protocol terminates: no attempt was dispatched');
    else if (previous.outcome.kind === 'throttled' && policy.id === 'P3' && previous.planned.attempt < per) {
      problems.push(`the trace ends before the protocol terminates: ${previous.planned.trial_id} still owes attempt a${previous.planned.attempt + 1}`);
    } else if (previous.planned.trial_index < schedule.length - 1) {
      problems.push(`the trace ends before the protocol terminates: after trial ${previous.planned.trial_index + 1} of ${schedule.length}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The frozen rule, strict and with P4 sensitivity bounds
// ---------------------------------------------------------------------------

/** The frozen rule's four values (`experimentOutcome` in rules.ts). */
export type RuleOutcome = ReturnType<typeof experimentOutcome>;

/** What a study may claim about #17. */
export type Claim = 'detected' | 'not_detected' | 'incomplete';

export interface Sensitivity {
  /** The frozen rule on counted trials only: `incomplete` unless every scheduled trial is counted. */
  strict: RuleOutcome;
  /** Missing with → not detected, missing without → detected (against the hypothesis). */
  worst_case: RuleOutcome;
  /** Missing with → detected, missing without → not detected (for the hypothesis). */
  best_case: RuleOutcome;
  worst_case_pass: boolean;
  best_case_pass: boolean;
  /** The outcome both bounds share, or `undecided`. Descriptive: it does not by itself license a claim. */
  bounded: RuleOutcome | 'undecided';
  /** Every missing trial was lost to a classified pre-generation 429 (none to a failure stop). */
  missing_only_throttled: boolean;
  /**
   * What may be claimed. All counted: the strict rule. Otherwise, only when
   * every missing trial is a classified 429: `detected` if the worst case
   * succeeds, `not_detected` if even the best case does not. A non-429 stop
   * leaves the study `incomplete`, exactly as in v4; its bounds are
   * descriptive only.
   */
  claim: Claim;
}

/**
 * The frozen #17 rule (`experimentOutcome`, ≥4/5 with and ≤1/5 without),
 * applied to a tally. v4-imputed truncations keep their frozen conservative
 * value in both bounds; only missing trials are imputed both ways. The rule
 * is monotone (more *with* detections or fewer *without* detections never
 * turn a success into a non-success), so a worst-case success implies
 * success for every possible value of the missing trials, under any
 * missingness mechanism.
 */
export function sensitivity(tallies: Record<Condition, Tally>): Sensitivity {
  const w = tallies.with;
  const wo = tallies.without;
  const withDetected = w.detected;
  const withoutDetected = wo.detected + wo.imputed;
  const complete = counted(w) === w.scheduled && counted(wo) === wo.scheduled;
  const strict = complete ? experimentOutcome(withDetected, counted(w), withoutDetected, counted(wo)) : 'incomplete';
  const worst = experimentOutcome(withDetected, w.scheduled, withoutDetected + missing(wo), wo.scheduled);
  const best = experimentOutcome(withDetected + missing(w), w.scheduled, withoutDetected, wo.scheduled);
  const onlyThrottled = w.failed === 0 && wo.failed === 0;
  let claim: Claim = 'incomplete';
  if (strict !== 'incomplete') claim = strict === 'success' ? 'detected' : 'not_detected';
  else if (onlyThrottled && worst === 'success') claim = 'detected';
  else if (onlyThrottled && best !== 'success' && best !== 'incomplete') claim = 'not_detected';
  return {
    strict,
    worst_case: worst,
    best_case: best,
    worst_case_pass: worst === 'success',
    best_case_pass: best === 'success',
    bounded: worst === best ? worst : 'undecided',
    missing_only_throttled: onlyThrottled,
    claim,
  };
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

/** Per-attempt outcome probabilities (the model behind the probability tables). */
export interface OutcomeModel {
  /** P(HTTP 429) per attempt, independent of condition, time and every other attempt unless overridden below. */
  throttle: number;
  /** A position hazard: P(429) for every attempt of the trial at this schedule index, in place of `throttle`. */
  throttleByPosition?: readonly number[];
  /** A burst: P(429 | the previous dispatched attempt, in any trial, got a 429), in place of the above. */
  burst?: number;
  /** P(detected | observed) per condition. */
  detect: Record<Condition, number>;
  /** P(truncated | not throttled); default 0. */
  truncate?: number;
  /** P(eligible | truncated); default 1. */
  truncationEligible?: number;
  /** P(other failure | not throttled); default 0. */
  fail?: number;
}

/** The 429 probability of an attempt, from its trial's schedule index and whether the previous attempt got a 429. */
export function throttleProbability(model: OutcomeModel, trialIndex: number, previousThrottled: boolean): number {
  if (model.burst !== undefined && previousThrottled) return model.burst;
  return model.throttleByPosition?.[trialIndex] ?? model.throttle;
}

export function modelProblems(model: OutcomeModel): string[] {
  const unit = (x: number | undefined) => x === undefined || (Number.isFinite(x) && x >= 0 && x <= 1);
  const problems: string[] = [];
  const values = [model.throttle, model.detect.with, model.detect.without, model.truncate, model.truncationEligible, model.fail, model.burst, ...(model.throttleByPosition ?? [])];
  if (!values.every(unit)) problems.push('every model probability must be in [0, 1]');
  if ((model.truncate ?? 0) + (model.fail ?? 0) > 1) problems.push('truncate + fail must not exceed 1');
  return problems;
}

export interface PolicyMetrics {
  /** P(all trials counted): the strict rule is decidable. */
  all_observed: number;
  /** P(exactly k trials counted), k = 0 … trials. */
  counted_distribution: number[];
  strict_pass: number;
  /** P(claim = detected): a strict success, or a worst-case success with only 429s missing. */
  worst_case_pass: number;
  /** P(best case succeeds), descriptive. */
  best_case_pass: number;
  /** P(claim is not `incomplete`): the claim is decided whatever the missing trials were. */
  bounded_decided: number;
  /** P(both bounds give the same four-valued outcome, with only 429s missing). */
  bounded_same_outcome: number;
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
  const problems = [...policyProblems(policy), ...modelProblems(model)];
  if (problems.length > 0) throw new Error(problems.join('; '));
  const per = attemptsPerTrial(policy);
  const cap = maxAttempts(policy, schedule.length);
  const t = model.truncate ?? 0;
  const e = model.truncationEligible ?? 1;
  const f = model.fail ?? 0;
  // `streak`: consecutive 429s up to the previous dispatched attempt (the burst model and the outage stop read it).
  type Live = { state: TerminalState; probability: number; stopped: boolean; streak: number };
  const tallyKey = (t: Tally) => `${t.scheduled},${t.observed},${t.detected},${t.imputed},${t.throttled},${t.failed},${t.not_dispatched}`;
  const key = (s: TerminalState, stopped: boolean, streak: number) =>
    `${s.attempts}|${stopped ? 1 : 0}|${streak}|${tallyKey(s.tallies.with)}|${tallyKey(s.tallies.without)}`;
  const limit = outageLimit(policy);
  const clone = (s: TerminalState): TerminalState => ({ attempts: s.attempts, tallies: { with: { ...s.tallies.with }, without: { ...s.tallies.without } } });
  let states = new Map<string, Live>();
  const start: TerminalState = { attempts: 0, tallies: { with: emptyTally(), without: emptyTally() } };
  states.set(key(start, false, 0), { state: start, probability: 1, stopped: false, streak: 0 });

  for (let index = 0; index < schedule.length; index++) {
    const slot = schedule[index]!;
    const next = new Map<string, Live>();
    const add = (state: TerminalState, probability: number, stopped: boolean, streak: number) => {
      if (probability === 0) return;
      // Once stopped, the streak no longer matters: merge those states.
      if (stopped) streak = 0;
      const k = key(state, stopped, streak);
      const existing = next.get(k);
      if (existing) existing.probability += probability;
      else next.set(k, { state, probability, stopped, streak });
    };
    for (const live of states.values()) {
      const base = clone(live.state);
      base.tallies[slot.condition].scheduled++;
      if (live.stopped) {
        const s = clone(base);
        s.tallies[slot.condition].not_dispatched++;
        add(s, live.probability, true, 0);
        continue;
      }
      let reach = live.probability; // P(every earlier attempt of this trial got a 429)
      let streak = live.streak;
      for (let attempt = 1; attempt <= per; attempt++) {
        if (base.attempts + attempt - 1 >= cap) {
          const s = clone(base);
          s.attempts += attempt - 1;
          if (attempt === 1) s.tallies[slot.condition].not_dispatched++;
          else s.tallies[slot.condition].throttled++;
          add(s, reach, true, 0);
          reach = 0;
          break;
        }
        const after = (mutate: (tally: Tally) => void, probability: number, stopped: boolean, nextStreak = 0) => {
          const s = clone(base);
          s.attempts += attempt;
          mutate(s.tallies[slot.condition]);
          add(s, reach * probability, stopped, nextStreak);
        };
        const p = throttleProbability(model, index, streak > 0);
        const go = 1 - p;
        const scored = go * (1 - t - f);
        const q = model.detect[slot.condition];
        after((tally) => { tally.observed++; tally.detected++; }, scored * q, false);
        after((tally) => { tally.observed++; }, scored * (1 - q), false);
        after((tally) => { tally.imputed++; }, go * t * e, false);
        after((tally) => { tally.failed++; }, go * (t * (1 - e) + f), true);
        const outage = limit !== null && streak + 1 >= limit;
        if (policy.id === 'P1' || attempt === per || outage) {
          after((tally) => { tally.throttled++; }, p, policy.id === 'P1' || outage, streak + 1);
          reach = 0;
          break;
        }
        reach *= p;
        streak++;
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
    bounded_same_outcome: 0,
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
    if (s.strict === 'success') m.strict_pass += probability;
    if (s.claim === 'detected') m.worst_case_pass += probability;
    if (s.best_case_pass) m.best_case_pass += probability;
    if (s.claim !== 'incomplete') m.bounded_decided += probability;
    if (s.bounded !== 'undecided' && s.missing_only_throttled) m.bounded_same_outcome += probability;
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
export function drawOutcome(random: () => number, model: OutcomeModel, condition: Condition, throttle: number = model.throttle): AttemptOutcome {
  if (random() < throttle) return { kind: 'throttled' };
  const u = random();
  const f = model.fail ?? 0;
  const t = model.truncate ?? 0;
  if (u < f) return { kind: 'failed' };
  if (u < f + t) return { kind: 'truncated', eligible: random() < (model.truncationEligible ?? 1) };
  return { kind: 'observed', detected: random() < model.detect[condition] };
}

/** Seeded Monte Carlo estimate of the same metrics, through the real `execute` state machine. */
export const MAX_SIMULATION_RUNS = 1_000_000;

export function simulate(schedule: readonly Slot[], policy: Policy, model: OutcomeModel, runs: number, seed: number): PolicyMetrics {
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_SIMULATION_RUNS) throw new Error(`runs must be an integer from 1 to ${MAX_SIMULATION_RUNS}`);
  const problems = modelProblems(model);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const random = mulberry32(seed);
  const entries: Array<{ state: TerminalState; probability: number }> = [];
  for (let run = 0; run < runs; run++) {
    let last = false;
    const execution = execute(schedule, policy, (attempt) => {
      const outcome = drawOutcome(random, model, attempt.condition, throttleProbability(model, attempt.trial_index, last));
      last = outcome.kind === 'throttled';
      return outcome;
    });
    entries.push({ state: { tallies: execution.tallies, attempts: execution.steps.length }, probability: 1 / runs });
  }
  return metricsFrom(entries, schedule.length);
}

// ---------------------------------------------------------------------------
// Cost ceilings
// ---------------------------------------------------------------------------

/**
 * An illustrative snapshot of the measured inputs on 2026-11-02. Every cost
 * function takes the inputs as a parameter; before any freeze, pass the live
 * ledger, prices and caps instead. This snapshot is not a ledger reading.
 */
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
  /**
   * The bound on real spend if every attempt, 429s included, were billed at
   * the per-attempt worst case. "Actual spend under one cent" holds only while
   * 429s stay unbilled (four events so far); this does not depend on that.
   */
  billed_worst_case_usd: number;
  /** The reservation covers 1.2 × the per-attempt worst case (the phase-0 rule). */
  reservation_covers_worst_case: boolean;
  fits_caps: boolean;
}

export function costCeiling(policy: Policy, trials: number, inputs: CostInputs = COST_INPUTS_20261102): CostCeiling {
  const problems = policyProblems(policy);
  if (problems.length > 0) throw new Error(problems.join('; '));
  if (!Number.isInteger(trials) || trials < 0) throw new Error('trials must be a non-negative integer');
  const attempts = maxAttempts(policy, trials);
  const budget = attempts * units(inputs.reservationUsd);
  const ceiling = units(inputs.ledgerConservativeUsd) + budget;
  return {
    max_attempts: attempts,
    new_reservations_usd: usd(budget),
    cumulative_ceiling_usd: usd(ceiling),
    worst_case_ledger_impact_usd: usd(budget),
    billed_worst_case_usd: usd(attempts * units(inputs.worstCasePerAttemptUsd)),
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
 * Agent R's verified inventory (2026-11-02): 4 HTTP 429s in 19 paid
 * dispatches to the pinned `deepinfra/fp8` endpoint, Clopper–Pearson 95%
 * [0.061, 0.456]. #17 alone: 3 of 9. A point estimate from 19 requests, not
 * a design input on its own: the proposal keeps the scenario grid.
 */
export const EMPIRICAL_THROTTLE_RATE = Object.freeze({ overall: 4 / 19, experiment17: 3 / 9, ci95: Object.freeze([0.061, 0.456] as const) });

/** The policies the proposal compares (P4 is `sensitivity` applied to any of them). */
export const PROPOSED_POLICIES: Readonly<Record<string, Policy>> = Object.freeze({
  P1: { id: 'P1' },
  P2: { id: 'P2' },
  'P3 (K=2, cap 20)': { id: 'P3', attemptsPerTrial: 2, maxTotalAttempts: 20 },
  'P3 (K=3, cap 30)': { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30 },
  'P3 (K=3, cap 20)': { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 20 },
  'P3 (K=3, cap 30, outage stop 6)': { id: 'P3', attemptsPerTrial: 3, maxTotalAttempts: 30, maxConsecutiveThrottles: 6 },
});
