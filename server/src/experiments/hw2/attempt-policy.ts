/**
 * Study v5 (#17, item B successor): the P3 attempt-pool policy, as the runner,
 * the report and the adjudication apply it. Owner decisions of 2026-11-02:
 *
 * - every trial of the seeded schedule has a predeclared pool of K = 3
 *   attempt IDs (`c-v5-17-<condition>-<trial>-a<k>`), each with its own
 *   ledger reservation; the study has at most M = 30 attempts and stops after
 *   L = 6 classified 429s in a row (counted across trials, reset by any
 *   response);
 * - attempt a(k+1) of a trial is used only right after a(k) of the same trial
 *   got a strictly classified upstream pre-generation HTTP 429
 *   (`throttleProblems`); an observation, a truncation, a failure or any
 *   detection never opens a new attempt, and anything ambiguous stops;
 * - fixed pacing (30 s between trials, 60 s before a2, 180 s before a3),
 *   decided by the attempt's place in the plan only.
 *
 * The plan, the validator and the P4 bounds are those of the pure model in
 * `throttle-policy.ts`; this module only maps the frozen study block onto it
 * and classifies what the stack recorded. Nothing here dispatches.
 */
import type { FrozenExpectations } from './eligibility.js';
import type { Slot } from './schedule.js';
import {
  ATTEMPT_ID,
  maxAttempts,
  missingnessBalance,
  outageLimit,
  planAttempts,
  sensitivity,
  type AttemptOutcome,
  type Claim,
  type Sensitivity,
  type Tally,
  type Pacing,
  type PlannedAttempt,
  type Policy,
  type StopReason,
} from './throttle-policy.js';

/** How a 429 is recognised as an upstream pre-generation refusal: structured fields only, never message text. */
export interface ThrottleClassification {
  http_status: 429;
  origin: 'upstream_provider';
  /** Exact `errorDetail.limitSource` values that count; anything else is a failure. */
  limit_sources: string[];
}

export interface AttemptPolicyP3 {
  kind: 'p3';
  attempts_per_trial: number;
  max_total_attempts: number;
  /** The outage stop: this many classified 429s in a row, across trials, stop the study. */
  outage_consecutive_429: number;
  pacing_s: { between_trials: number; before_a2: number; before_a3: number };
  throttle_classification: ThrottleClassification;
}

/** The owner-approved v5 policy (P3, K = 3, M = 30, L = 6, 30/60/180 s, shared-pool 429s only). */
export const P3_ATTEMPT_POLICY_V5: AttemptPolicyP3 = Object.freeze({
  kind: 'p3' as const,
  attempts_per_trial: 3,
  max_total_attempts: 30,
  outage_consecutive_429: 6,
  pacing_s: Object.freeze({ between_trials: 30, before_a2: 60, before_a3: 180 }),
  throttle_classification: Object.freeze({
    http_status: 429 as const,
    origin: 'upstream_provider' as const,
    limit_sources: Object.freeze(['upstream_provider_shared_pool']) as unknown as string[],
  }),
}) as AttemptPolicyP3;

/** The frozen policy as the pure model's `Policy`. */
export function modelPolicy(policy: AttemptPolicyP3): Policy {
  return { id: 'P3', attemptsPerTrial: policy.attempts_per_trial, maxTotalAttempts: policy.max_total_attempts, maxConsecutiveThrottles: policy.outage_consecutive_429 };
}

/** The frozen pacing as the pure model's `Pacing` (milliseconds). */
export function modelPacing(policy: AttemptPolicyP3): Pacing {
  const backoff = [policy.pacing_s.before_a2, policy.pacing_s.before_a3].slice(0, Math.max(0, policy.attempts_per_trial - 1));
  return { interTrialDelayMs: policy.pacing_s.between_trials * 1000, backoffMs: backoff.map((s) => s * 1000) };
}

/** Every attempt ID the study may use, in the only order it may use them. */
export function attemptPlan(trials: readonly Slot[], policy: AttemptPolicyP3): PlannedAttempt[] {
  return planAttempts(trials, modelPolicy(policy), modelPacing(policy));
}

/** The most attempts the study can dispatch (M, or trials × K when smaller). */
export const maxStudyAttempts = (trials: number, policy: AttemptPolicyP3) => maxAttempts(modelPolicy(policy), trials);

/** The attempt plan as the manifest freezes it. */
export interface FrozenAttempt {
  attempt_id: string;
  trial_id: string;
  attempt: number;
  delay_before_s: number;
}

export const frozenAttempts = (plan: readonly PlannedAttempt[]): FrozenAttempt[] =>
  plan.map((a) => ({ attempt_id: a.attempt_id, trial_id: a.trial_id, attempt: a.attempt, delay_before_s: a.delay_before_ms / 1000 }));

/** The parts of an attempt ID, or null when it is not one. */
export function parseAttemptId(id: string): { tag: string; experiment: string; condition: 'with' | 'without'; trial: number; attempt: number; trial_id: string } | null {
  const m = ATTEMPT_ID.exec(id);
  if (!m) return null;
  return { tag: m[1]!, experiment: m[2]!, condition: m[3] as 'with' | 'without', trial: Number(m[4]), attempt: Number(m[5]), trial_id: id.replace(/-a[1-9]$/, '') };
}

// ---------------------------------------------------------------------------
// Classification of a settled attempt
// ---------------------------------------------------------------------------

/** The fields of a slot lookup's run the classification reads (all structured). */
export interface AttemptRunView {
  status?: string | null;
  cost_usd: number | null;
  experiment: {
    dispatch_state?: string;
    usage_known?: boolean;
    attempts?: Array<{
      dispatch?: string;
      outcome?: string;
      httpStatus?: number | null;
      responseId?: string | null;
      generationIdHeader?: string | null;
      tokensIn?: number | null;
      tokensOut?: number | null;
      costUsd?: number | null;
      generation?: { status?: string; totalCost?: number | null; tokensPrompt?: number | null; tokensCompletion?: number | null } | null;
      errorDetail?: { origin?: string; limitSource?: string | null; providerName?: string | null } | null;
    }>;
  } & Record<string, unknown> | null;
}

const present = (value: unknown) => value !== null && value !== undefined;

/** The longest provider-controlled value quoted in a reason, a log line or a report cell. */
export const SHOWN_MAX = 80;

/**
 * A recorded value as it may be quoted: a string cut to `SHOWN_MAX`
 * characters with control characters removed, a finite number, or a fixed
 * word. Never the raw value of an unexpected type.
 */
export function shown(value: unknown, missing = 'unknown'): string {
  if (value === null || value === undefined) return missing;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'not a finite number';
  if (typeof value !== 'string') return `(${typeof value})`;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX - 1)}…` : text;
}

/**
 * Why a settled run is not a strictly classified upstream pre-generation 429
 * (empty when it is). Every test reads a structured field; no message or body
 * text is ever consulted. The request must have reached the provider (one
 * dispatched attempt, not a local refusal), failed with the numeric HTTP
 * status 429, carry no response or generation ID and no reported usage or
 * cost, and name the frozen upstream provider with an allowlisted
 * `limit_source`. A 429 from OpenRouter itself, or any other limit, is not one.
 */
export function throttleProblems(run: AttemptRunView | null, classification: ThrottleClassification, expected: Pick<FrozenExpectations, 'providerName'> | null): string[] {
  const problems: string[] = [];
  const experiment = run?.experiment ?? null;
  if (!experiment) return ['no experiment block'];
  if (run!.status === 'running') problems.push('the run is still running');
  if (experiment.dispatch_state !== 'failed') problems.push(`dispatch_state ${shown(experiment.dispatch_state)}, not failed`);
  if (experiment.usage_known !== false) problems.push(`usage_known is ${shown(experiment.usage_known === true ? 'true' : experiment.usage_known)}, not false`);
  if (run!.cost_usd !== null && run!.cost_usd !== undefined) problems.push('the run reports a cost');
  const attempts = experiment.attempts ?? [];
  if (attempts.length !== 1) return [...problems, `expected exactly one attempt, found ${attempts.length}`];
  const a = attempts[0]!;
  if (a.dispatch !== 'dispatched') problems.push(`attempt dispatch ${shown(a.dispatch)}: the request did not reach the provider`);
  if (a.outcome !== 'http_error') problems.push(`attempt outcome ${shown(a.outcome)}, not http_error`);
  if (typeof a.httpStatus !== 'number' || a.httpStatus !== classification.http_status) problems.push(`HTTP status ${shown(a.httpStatus)}, not ${classification.http_status}`);
  if (present(a.responseId)) problems.push('the attempt carries a response ID');
  if (present(a.generationIdHeader)) problems.push('the attempt carries a generation ID');
  if (present(a.tokensIn) || present(a.tokensOut) || present(a.costUsd)) problems.push('the attempt reports generation usage or cost');
  const generation = a.generation ?? null;
  if (generation && (generation.status === 'found' || present(generation.totalCost) || present(generation.tokensPrompt) || present(generation.tokensCompletion))) {
    problems.push('a generation record exists for the attempt');
  }
  const detail = a.errorDetail ?? null;
  if (!detail) return [...problems, 'no structured error detail'];
  if (detail.origin !== classification.origin) problems.push(`error origin ${shown(detail.origin)}, not ${classification.origin}`);
  if (typeof detail.limitSource !== 'string' || !classification.limit_sources.includes(detail.limitSource)) {
    problems.push(`limit_source ${shown(detail.limitSource, 'missing')} is not in the allowlist (${classification.limit_sources.join(', ')})`);
  }
  if (!expected || typeof expected.providerName !== 'string' || expected.providerName.length === 0) problems.push('no frozen provider to compare the 429 with');
  else if (detail.providerName !== expected.providerName) problems.push(`the 429 names provider ${shown(detail.providerName)}, not ${shown(expected.providerName)}`);
  return problems;
}

/** What the protocol makes of one settled attempt, recorded on its terminal ledger event (`detail.p3`). */
export type AttemptClass = 'observed' | 'throttled' | 'truncated' | 'failed';

export interface AttemptClassification {
  class: AttemptClass;
  /** Why it is `failed` (empty otherwise). */
  reasons: string[];
}

/** The pure model's outcome for a recorded class (detection is not known to the runner and does not steer it). */
export function outcomeOfClass(c: AttemptClass): AttemptOutcome {
  if (c === 'observed') return { kind: 'observed', detected: false };
  if (c === 'throttled') return { kind: 'throttled' };
  if (c === 'truncated') return { kind: 'truncated', eligible: true };
  return { kind: 'failed' };
}

// ---------------------------------------------------------------------------
// Protocol state: what happens next, from the recorded outcomes alone
// ---------------------------------------------------------------------------

export type ProtocolState =
  | { kind: 'next'; attempt: PlannedAttempt }
  | { kind: 'stopped'; reason: StopReason; attempt_id: string | null }
  | { kind: 'done' };

/**
 * The next step of the P3 protocol after `steps` (attempts in plan order,
 * already checked by `traceProblems`). It mirrors `execute` in
 * `throttle-policy.ts`, which the tests check it against.
 */
export function protocolNext(plan: readonly PlannedAttempt[], policy: Policy, steps: ReadonlyArray<{ attempt: PlannedAttempt; outcome: AttemptOutcome }>): ProtocolState {
  if (policy.id !== 'P3') throw new Error('protocolNext implements P3 only');
  const per = policy.attemptsPerTrial;
  const trials = plan.length / per;
  const cap = maxAttempts(policy, trials);
  const limit = outageLimit(policy);
  const last = steps.at(-1);
  let candidate: PlannedAttempt | undefined;
  if (!last) candidate = plan[0];
  else {
    const { outcome, attempt } = last;
    if (outcome.kind === 'failed' || (outcome.kind === 'truncated' && !outcome.eligible)) {
      return { kind: 'stopped', reason: outcome.kind === 'truncated' ? 'ineligible_truncation' : 'failure', attempt_id: attempt.attempt_id };
    }
    let streak = 0;
    for (let i = steps.length - 1; i >= 0 && steps[i]!.outcome.kind === 'throttled'; i--) streak++;
    if (limit !== null && streak >= limit) return { kind: 'stopped', reason: 'throttle_outage', attempt_id: attempt.attempt_id };
    candidate = outcome.kind === 'throttled' && attempt.attempt < per
      ? plan[attempt.plan_index + 1]
      : plan[(attempt.trial_index + 1) * per];
  }
  if (!candidate) return { kind: 'done' };
  // The cap names the attempt it refused, so a trial cut short by it can be labelled bounded.
  if (steps.length >= cap) return { kind: 'stopped', reason: 'attempt_cap', attempt_id: candidate.attempt_id };
  return { kind: 'next', attempt: candidate };
}

/** 429-caused stops: trials they leave undispatched are `bounded`, not `incomplete`. */
export const THROTTLE_STOPS: ReadonlySet<StopReason> = new Set(['throttle', 'throttle_outage', 'attempt_cap']);

/** Where a study's protocol stands, as the report records it (and the adjudication input carries it). */
export interface ProtocolSummary {
  state: 'done' | 'stopped' | 'in_progress';
  reason: string | null;
  /** The stop's attempt (the last dispatched, or the one the cap refused); the attempt still owed when in progress. */
  attempt_id: string | null;
}

/**
 * A trial's label from its own attempt classes (in attempt order) and where
 * the protocol stands. The report and the adjudication `prepare` both use
 * it, so a label in the adjudication input is re-derived, never trusted.
 * `observed` here means an observation the report counted.
 */
export function trialLabel(args: {
  classes: readonly AttemptClass[];
  attemptsPerTrial: number;
  /** Every planned attempt ID of the trial. */
  planIds: readonly string[];
  protocol: ProtocolSummary;
}): { label: TrialLabel; reason: string; scoring: number | null; pool_exhausted: boolean } {
  const { classes, protocol } = args;
  const scoringIndex = classes.findIndex((c) => c !== 'throttled');
  const throttles = scoringIndex === -1 ? classes.length : scoringIndex;
  const pool_exhausted = classes.length === args.attemptsPerTrial && classes.every((c) => c === 'throttled');
  const throttleStop = protocol.state === 'stopped' && THROTTLE_STOPS.has(protocol.reason as StopReason);
  const base = { scoring: scoringIndex === -1 ? null : scoringIndex + 1, pool_exhausted };
  if (scoringIndex !== -1) {
    const c = classes[scoringIndex]!;
    const k = scoringIndex + 1;
    if (c === 'observed') return { ...base, label: 'observed', reason: k === 1 ? 'observed on a1' : `observed on a${k} after ${throttles} classified 429(s)` };
    if (c === 'truncated') return { ...base, label: 'imputed', reason: `truncated on a${k}; imputed against the hypothesis, never re-attempted` };
    return { ...base, label: 'incomplete', reason: `a${k} failed` };
  }
  if (pool_exhausted) return { ...base, label: 'bounded', reason: `pool exhausted: ${classes.length} classified 429s` };
  if (classes.length > 0 && throttleStop && protocol.attempt_id !== null && args.planIds.includes(protocol.attempt_id)) {
    return { ...base, label: 'bounded', reason: `${classes.length} classified 429(s), then the ${protocol.reason === 'attempt_cap' ? 'attempt cap' : 'outage stop'}` };
  }
  if (classes.length === 0 && throttleStop) return { ...base, label: 'bounded', reason: `not dispatched: the study stopped on ${protocol.reason}` };
  if (classes.length > 0) return { ...base, label: 'incomplete', reason: `${classes.length} classified 429(s) and an attempt still owed` };
  return { ...base, label: 'incomplete', reason: protocol.state === 'stopped' ? `not dispatched: the study stopped on ${protocol.reason}` : 'not dispatched' };
}

// ---------------------------------------------------------------------------
// P4 reporting: observations apart from the bounds
// ---------------------------------------------------------------------------

/** How a scheduled v5 trial enters the result. */
export type TrialLabel =
  /** Scored from its observed attempt. */
  | 'observed'
  /** An eligible truncation, imputed by the frozen v4 rule (with → no, without → yes); never re-attempted. */
  | 'imputed'
  /** Missing because of classified 429s only (exhausted pool, or not dispatched after an outage stop or the cap): filled only in the bounds. */
  | 'bounded'
  /** Missing for any other reason: it leaves the claim `incomplete`. */
  | 'incomplete';

export interface P4Tally {
  scheduled: number;
  observed: number;
  /** Detections among `observed`. */
  detected: number;
  imputed: number;
  bounded: number;
  incomplete: number;
}

export interface P4Result {
  tallies: Record<'with' | 'without', P4Tally>;
  /** The frozen rule on observed (and imputed) trials only: `incomplete` unless every trial is counted. */
  strict: Sensitivity['strict'];
  /** Bounded trials against the hypothesis (with → no, without → yes). */
  worst_case: Sensitivity['worst_case'];
  /** Bounded trials for the hypothesis (with → yes, without → no). */
  best_case: Sensitivity['best_case'];
  claim: Claim;
  /** `strict`: every trial counted; `conditional_bound`: a worst-case success; `bound`: even the best case fails; `none`: no claim. */
  claim_basis: 'strict' | 'conditional_bound' | 'bound' | 'none';
  /** Wording for the report: a worst-case success is a conditional bound, never a verified result. */
  claim_label: string;
  balance: ReturnType<typeof missingnessBalance>;
  /** Anything that forces the claim to `incomplete` whatever the tallies (protocol or record inconsistencies). */
  blockers: string[];
  /**
   * True when a trial is missing for a reason other than classified 429s
   * (an `incomplete` trial, such as an ambiguous adjudicated verdict) or a
   * blocker applies: the bounds are then descriptive only and support no claim.
   */
  bounds_descriptive: boolean;
}

/**
 * The P4 result of a tally (owner decision 6). A claim beyond `incomplete`
 * needs every missing trial to be `bounded` (lost to classified 429s); one
 * `incomplete` trial, or any blocker, leaves the claim `incomplete`, and the
 * bounds are then descriptive only.
 */
export function p4Result(tallies: Record<'with' | 'without', P4Tally>, blockers: readonly string[] = []): P4Result {
  const model = (t: P4Tally): Tally => ({ scheduled: t.scheduled, observed: t.observed, detected: t.detected, imputed: t.imputed, throttled: t.bounded, failed: t.incomplete, not_dispatched: 0 });
  for (const t of Object.values(tallies)) {
    if (t.observed + t.imputed + t.bounded + t.incomplete !== t.scheduled || t.detected > t.observed) throw new Error(`inconsistent P4 tally ${JSON.stringify(t)}`);
  }
  const s = sensitivity({ with: model(tallies.with), without: model(tallies.without) });
  const blocked = blockers.length > 0;
  const claim: Claim = blocked ? 'incomplete' : s.claim;
  const claim_basis: P4Result['claim_basis'] = claim === 'incomplete' ? 'none'
    : s.strict !== 'incomplete' ? 'strict'
      : claim === 'detected' ? 'conditional_bound' : 'bound';
  const claim_label = {
    strict: claim === 'detected' ? 'detected (strict: every trial counted)' : 'not detected (strict: every trial counted)',
    conditional_bound: 'detected only as a conditional bound (worst case over trials lost to classified 429s); not a verified or accepted result',
    bound: 'not detected (even the best case over trials lost to classified 429s fails)',
    none: blocked ? `incomplete (${blockers.join('; ')})` : 'incomplete (a trial is missing for a reason other than classified 429s, or the bounds disagree)',
  }[claim_basis];
  return {
    tallies,
    strict: s.strict,
    worst_case: s.worst_case,
    best_case: s.best_case,
    claim,
    claim_basis,
    claim_label,
    balance: missingnessBalance({ with: model(tallies.with), without: model(tallies.without) }),
    blockers: [...blockers],
    bounds_descriptive: blocked || tallies.with.incomplete + tallies.without.incomplete > 0,
  };
}

/** Report wording shared by the runner report and the adjudication report (F6, I1). */
export function p4Lines(p: P4Result, source: 'screen' | 'adjudicated'): string[] {
  return [
    `- Strict (observed plus v4-imputed truncations; every trial must be counted): ${p.strict}.`,
    `- Sensitivity bounds over bounded trials: worst case ${p.worst_case}, best case ${p.best_case}.`,
    // A worst-case success never appears as a bare "detected" (acceptance review, wording).
    `- Claim${source === 'screen' ? ' (regex screen)' : ''}: **${p.claim_basis === 'conditional_bound' ? 'conditional bound only, not verified' : p.claim}**: ${p.claim_label}.`,
    ...(p.bounds_descriptive ? ['- The bounds are descriptive only: a trial is missing for a reason other than classified 429s (an incomplete trial or an ambiguous adjudicated verdict), or the record is inconsistent.'] : []),
    '- A worst-case success is a conditional bound. It is never a Verified or accepted result.',
    `- Missing per condition: with ${p.balance.missing_with} of ${p.balance.scheduled_with}, without ${p.balance.missing_without} of ${p.balance.scheduled_without}; Fisher two-sided p = ${p.balance.fisher_two_sided_p.toFixed(3)} (reported, not a gate).`,
  ];
}
