/**
 * The study v5 report: every scheduled trial with every attempt of its
 * predeclared pool, the label it enters the result with (`observed`,
 * `imputed`, `bounded`, `incomplete`), the P4 bounds and the missingness
 * record. Built from data only; the CLI fetches it. The per-attempt evidence
 * rules are those of `buildReport` (strict eligibility, frozen fingerprints,
 * the slot each trace executed), applied to each attempt under its own ID.
 *
 * Every class here is re-derived from the stack's trace and compared with the
 * one the runner recorded on the ledger; any disagreement, any attempt the
 * protocol could not have produced, and any trial still owed an attempt make
 * the claim `incomplete`. The regex screen stays non-authoritative: the
 * sealed adjudication reveal applies the same P4 rule to adjudicated verdicts.
 */
import {
  THROTTLE_STOPS,
  attemptPlan,
  modelPacing,
  modelPolicy,
  outcomeOfClass,
  p4Result,
  protocolNext,
  throttleProblems,
  type AttemptClass,
  type AttemptClassification,
  type P4Result,
  type P4Tally,
  type ProtocolState,
  type TrialLabel,
} from './attempt-policy.js';
import type { FrozenExpectations } from './eligibility.js';
import type { SlotRecord } from './ledger.js';
import type { StudySemantics } from './manifest.js';
import { buildReport, renderReport, type ExpectedExecution, type ExperimentSummary, type ScheduledSlot, type SlotRow, type SlotRunData } from './report.js';
import type { ExpectedRule } from './rules.js';
import { parseSlotId, type Slot } from './schedule.js';
import { traceProblems } from './throttle-policy.js';

export interface AttemptRow {
  attempt_id: string;
  attempt: number;
  plan_index: number;
  /** UTC: the reservation (armed), the dispatch (submitted to the stack) and the terminal record (finished). */
  armed_at: string | null;
  submitted_at: string | null;
  finished_at: string | null;
  /** UTC: when the stack's provider call started (the trace's attempt `startedAt`). */
  provider_started_at: string | null;
  /** The predeclared wait the runner recorded before arming it. */
  delay_before_ms: number | null;
  state: string;
  run_id: string | null;
  cost_usd: number | null;
  /** Re-derived from the trace. */
  class: AttemptClass;
  /** What the runner recorded (null: reconciled after a crash, or no ledger record). */
  ledger_class: AttemptClass | null;
  reasons: string[];
}

export interface TrialRow {
  /** 1-based position in the seeded order. */
  position: number;
  trial_id: string;
  experiment: string;
  condition: 'with' | 'without';
  attempts: AttemptRow[];
  /** The attempt the trial is scored from (its first that was not a classified 429). */
  scoring_attempt_id: string | null;
  label: TrialLabel;
  label_reason: string;
  /** Observed: the regex screen; imputed: the conservative verdict; otherwise null. */
  detected: boolean | null;
  pool_exhausted: boolean;
}

export interface P3Summary {
  experiment: string;
  attempts_used: number;
  max_attempts: number;
  /** Where the protocol stands: `done`, a stop (with its reason), or `in progress` (an attempt is still owed). */
  protocol: { state: 'done' | 'stopped' | 'in_progress'; reason: string | null; attempt_id: string | null };
  throttles: Array<{ attempt_id: string; trial_id: string; position: number; condition: 'with' | 'without'; attempt: number }>;
  exhausted_pools: string[];
  /** Regex screen (non-authoritative) under P4. */
  p4: P4Result;
  inconsistencies: string[];
}

export interface P3Report {
  /** One row per dispatched attempt, under its attempt ID (the `buildReport` evidence rules). */
  rows: SlotRow[];
  summaries: ExperimentSummary[];
  trials: TrialRow[];
  p3: P3Summary[];
  /** One row per trial for the adjudication input: the scoring attempt's evidence under the trial ID. */
  trial_rows: SlotRow[];
  /** The scoring attempt's run per trial ID (null: nothing to adjudicate). */
  trial_runs: Map<string, SlotRunData | null>;
}

const asSlot = (s: ScheduledSlot, index: number): Slot => {
  const parsed = parseSlotId(s.slot_id);
  if (!parsed || parsed.tag === null) throw new Error(`${s.slot_id} is not a tagged trial ID`);
  return { slot_id: s.slot_id, index, phase: 'confirmatory', experiment: s.experiment, condition: s.condition, trial: parsed.trial };
};

const eventAt = (record: SlotRecord | null, states: string[]) => record?.events.find((e) => states.includes(e.state))?.at ?? null;

export function buildP3Report(input: {
  /** The frozen trials, in their seeded order. */
  trials: ScheduledSlot[];
  ledger: Map<string, SlotRecord>;
  /** Keyed by attempt ID. */
  runs: Map<string, SlotRunData | null>;
  rules: Record<string, ExpectedRule>;
  frozenNonSkill: Record<string, string>;
  expectations: (experiment: string) => FrozenExpectations;
  execution: ExpectedExecution;
  semantics: StudySemantics;
}): P3Report {
  const policy = input.semantics.attemptPolicy;
  if (input.semantics.version !== 5 || !policy) throw new Error('buildP3Report needs version 5 semantics');
  const trials = input.trials.map(asSlot);
  const plan = attemptPlan(trials, policy);
  const model = modelPolicy(policy);
  const recorded = plan.filter((a) => input.ledger.has(a.attempt_id) || input.runs.get(a.attempt_id));
  const attemptSchedule: ScheduledSlot[] = recorded.map((a) => ({ slot_id: a.attempt_id, experiment: trials[a.trial_index]!.experiment, condition: a.condition }));
  const base = buildReport({ ...input, schedule: attemptSchedule });
  const rowOf = new Map(base.rows.map((r) => [r.slot_id, r]));
  const inconsistencies: string[] = [];

  const attemptRows = new Map<string, AttemptRow>();
  for (const planned of recorded) {
    const id = planned.attempt_id;
    const record = input.ledger.get(id) ?? null;
    const run = input.runs.get(id) ?? null;
    const row = rowOf.get(id)!;
    const terminal = record?.events.find((e) => e.state === record.state) ?? null;
    const ledgerClass = (terminal?.detail?.p3 as AttemptClassification | undefined)?.class ?? null;
    const reasons: string[] = [];
    let cls: AttemptClass;
    const throttle = throttleProblems(run as never, policy.throttle_classification, input.expectations(row.experiment));
    if (row.counted) cls = 'observed';
    else if (row.imputed) cls = 'truncated';
    else if (run && throttle.length === 0 && row.fingerprint_ok && row.execution_issues.length === 0) cls = 'throttled';
    else {
      cls = 'failed';
      if (!run) reasons.push(`no run (${row.state})`);
      else reasons.push(...row.prompt_issues, ...row.execution_issues, ...(row.fingerprint_ok ? [] : ['non-Skill fingerprint differs from the frozen one']),
        ...(row.state === 'failed' ? throttle.map((p) => `not a classified 429: ${p}`) : row.eligibility?.reasons ?? []));
    }
    if (!record) {
      inconsistencies.push(`${id} has a run on the stack but no ledger record`);
      reasons.push('no ledger record');
      cls = 'failed';
    } else if (ledgerClass !== null && ledgerClass !== cls) {
      inconsistencies.push(`${id}: the runner recorded ${ledgerClass}, the trace shows ${cls}`);
      reasons.push(`the runner recorded ${ledgerClass}`);
      cls = 'failed';
    }
    const marker = record?.events[0]?.detail?.p3_attempt as { trial_id?: unknown; attempt?: unknown; delay_before_ms?: unknown } | undefined;
    if (record && (marker?.trial_id !== planned.trial_id || marker?.attempt !== planned.attempt)) {
      inconsistencies.push(`${id}'s reservation does not record its place in the frozen plan`);
    }
    const attempts = (run?.experiment as { attempts?: Array<{ startedAt?: unknown }> } | undefined)?.attempts;
    const started = attempts?.[0]?.startedAt;
    attemptRows.set(id, {
      attempt_id: id,
      attempt: planned.attempt,
      plan_index: planned.plan_index,
      armed_at: eventAt(record, ['reserved']),
      submitted_at: eventAt(record, ['dispatched']),
      finished_at: record && ['completed', 'failed', 'refused', 'ambiguous'].includes(record.state) ? eventAt(record, [record.state]) : null,
      provider_started_at: typeof started === 'string' ? started : null,
      delay_before_ms: typeof marker?.delay_before_ms === 'number' ? marker.delay_before_ms : null,
      state: record?.state ?? row.state,
      run_id: row.run_id,
      cost_usd: row.cost_usd,
      class: cls,
      ledger_class: ledgerClass,
      reasons: cls === 'failed' ? [...new Set(reasons)].filter(Boolean) : [],
    });
  }

  // The recorded sequence against the protocol: each step, then where it stands.
  const trace = recorded.map((a) => ({ attempt_id: a.attempt_id, outcome: outcomeOfClass(attemptRows.get(a.attempt_id)!.class), delay_before_ms: attemptRows.get(a.attempt_id)!.delay_before_ms ?? Number.NaN }));
  const stepProblems = traceProblems(trials, model, trace, modelPacing(policy), { prefix: true });
  inconsistencies.push(...stepProblems.map((p) => `protocol: ${p}`));
  const state: ProtocolState | null = stepProblems.length === 0
    ? protocolNext(plan, model, recorded.map((a, i) => ({ attempt: a, outcome: trace[i]!.outcome })))
    : null;
  const throttleStop = state?.kind === 'stopped' && THROTTLE_STOPS.has(state.reason);

  const trialRows: TrialRow[] = trials.map((slot, index) => {
    const attempts = plan.filter((a) => a.trial_index === index).map((a) => attemptRows.get(a.attempt_id)).filter((a): a is AttemptRow => a !== undefined);
    const scoring = attempts.find((a) => a.class !== 'throttled') ?? null;
    const pool_exhausted = attempts.length === policy.attempts_per_trial && attempts.every((a) => a.class === 'throttled');
    let label: TrialLabel;
    let reason: string;
    let detected: boolean | null = null;
    if (scoring?.class === 'observed') {
      label = 'observed';
      reason = scoring.attempt === 1 ? 'observed on a1' : `observed on a${scoring.attempt} after ${scoring.attempt - 1} classified 429(s)`;
      detected = rowOf.get(scoring.attempt_id)!.detected;
    } else if (scoring?.class === 'truncated') {
      label = 'imputed';
      reason = `truncated on a${scoring.attempt}; imputed against the hypothesis, never re-attempted`;
      detected = slot.condition === 'without';
    } else if (scoring) {
      label = 'incomplete';
      reason = `a${scoring.attempt} failed: ${scoring.reasons.join('; ') || scoring.state}`;
    } else if (pool_exhausted) {
      label = 'bounded';
      reason = `pool exhausted: ${attempts.length} classified 429s`;
    } else if (attempts.length > 0 && throttleStop && state?.kind === 'stopped' && attempts.some((a) => a.attempt_id === state.attempt_id)) {
      label = 'bounded';
      reason = `${attempts.length} classified 429(s), then the ${state.reason === 'attempt_cap' ? 'attempt cap' : 'outage stop'}`;
    } else if (attempts.length === 0 && throttleStop) {
      label = 'bounded';
      reason = `not dispatched: the study stopped on ${state?.kind === 'stopped' ? state.reason : 'a 429 stop'}`;
    } else {
      label = 'incomplete';
      reason = attempts.length > 0 ? `${attempts.length} classified 429(s) and an attempt still owed` : state?.kind === 'stopped' ? `not dispatched: the study stopped on ${state.reason}` : 'not dispatched';
    }
    return {
      position: index + 1, trial_id: slot.slot_id, experiment: slot.experiment, condition: slot.condition,
      attempts, scoring_attempt_id: scoring?.attempt_id ?? null, label, label_reason: reason, detected, pool_exhausted,
    };
  });

  const experiments = [...new Set(trials.map((t) => t.experiment))];
  const p3: P3Summary[] = experiments.map((experiment) => {
    const mine = trialRows.filter((t) => t.experiment === experiment);
    const tally = (condition: 'with' | 'without'): P4Tally => {
      const rows = mine.filter((t) => t.condition === condition);
      const count = (label: TrialLabel) => rows.filter((t) => t.label === label).length;
      return { scheduled: rows.length, observed: count('observed'), detected: rows.filter((t) => t.label === 'observed' && t.detected).length, imputed: count('imputed'), bounded: count('bounded'), incomplete: count('incomplete') };
    };
    const blockers = [...inconsistencies];
    const attempts = mine.flatMap((t) => t.attempts.map((a) => ({ a, t })));
    return {
      experiment,
      attempts_used: attempts.length,
      max_attempts: Math.min(policy.max_total_attempts, trials.length * policy.attempts_per_trial),
      protocol: !state
        ? { state: 'in_progress', reason: 'the recorded attempts do not follow the protocol', attempt_id: null }
        : state.kind === 'next' ? { state: 'in_progress', reason: `${state.attempt.attempt_id} is still owed`, attempt_id: state.attempt.attempt_id }
          : state.kind === 'stopped' ? { state: 'stopped', reason: state.reason, attempt_id: state.attempt_id } : { state: 'done', reason: null, attempt_id: null },
      throttles: attempts.filter(({ a }) => a.class === 'throttled').map(({ a, t }) => ({ attempt_id: a.attempt_id, trial_id: t.trial_id, position: t.position, condition: t.condition, attempt: a.attempt })),
      exhausted_pools: mine.filter((t) => t.pool_exhausted).map((t) => t.trial_id),
      p4: p4Result({ with: tally('with'), without: tally('without') }, blockers),
      inconsistencies,
    };
  });

  // Per trial, for the adjudication input: the scoring attempt's evidence under the trial ID.
  const trial_runs = new Map<string, SlotRunData | null>();
  const trial_rows: SlotRow[] = trialRows.map((t) => {
    const scored = t.scoring_attempt_id ? rowOf.get(t.scoring_attempt_id)! : null;
    trial_runs.set(t.trial_id, t.label === 'observed' && t.scoring_attempt_id ? input.runs.get(t.scoring_attempt_id) ?? null : null);
    const shape = scored ?? {
      execution_issues: [], prompt_issues: [], state: 'not dispatched', run_id: null, cost_usd: null, eligibility: null,
      fingerprint_ok: false, counted: false, detected: null, finding_titles: [], matched: [],
    };
    return {
      ...shape,
      slot_id: t.trial_id,
      experiment: t.experiment,
      condition: t.condition,
      state: t.label === 'observed' ? shape.state : `${t.label}: ${t.label_reason}`,
      counted: t.label === 'observed',
      imputed: t.label === 'imputed' ? scored?.imputed ?? null : null,
    };
  });
  return { rows: base.rows, summaries: base.summaries, trials: trialRows, p3, trial_rows, trial_runs };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const time = (at: string | null) => at ?? '—';

/** The v5 report: the per-attempt evidence table, then the trials, the P4 bounds and the missingness record. */
export function renderP3Report(report: P3Report, semantics: StudySemantics): string {
  const policy = semantics.attemptPolicy!;
  const lines = [renderReport({ rows: report.rows, summaries: report.summaries }), ''];
  for (const s of report.p3) {
    lines.push(
      `## Experiment ${s.experiment}: P3 attempt pool (K = ${policy.attempts_per_trial}, M = ${policy.max_total_attempts}, outage stop L = ${policy.outage_consecutive_429}; pacing ${policy.pacing_s.between_trials} s / ${policy.pacing_s.before_a2} s / ${policy.pacing_s.before_a3} s)`,
      '',
      `- Attempts used: ${s.attempts_used} of ${s.max_attempts}.`,
      `- Protocol: ${s.protocol.state}${s.protocol.reason ? ` (${s.protocol.reason}${s.protocol.attempt_id ? `, ${s.protocol.attempt_id}` : ''})` : ''}.`,
      '',
      '| Pos. | Trial | Condition | Label | Why | Scored attempt | Attempts (class; armed → submitted → finished, UTC) |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...report.trials.filter((t) => t.experiment === s.experiment).map((t) => `| ${[
        t.position, t.trial_id, t.condition, t.label, t.label_reason, t.scoring_attempt_id ?? '—',
        t.attempts.map((a) => `${a.attempt_id}: ${a.class}${a.reasons.length ? ` (${a.reasons.join('; ')})` : ''}; ${time(a.armed_at)} → ${time(a.submitted_at)} → ${time(a.finished_at)}`).join('<br>') || '—',
      ].map((v) => cell(String(v))).join(' | ')} |`),
      '',
      '### P4 (regex screen, non-authoritative; the sealed adjudication reveal applies the same rule to adjudicated verdicts)',
      '',
      '| Condition | Scheduled | Observed | Detected (screen) | Imputed (truncated) | Bounded (classified 429s) | Incomplete |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...(['with', 'without'] as const).map((c) => {
        const t = s.p4.tallies[c];
        return `| ${c} | ${t.scheduled} | ${t.observed} | ${t.detected} | ${t.imputed} | ${t.bounded} | ${t.incomplete} |`;
      }),
      '',
      `- Observed (strict, counted trials only): ${s.p4.strict}.`,
      `- Sensitivity bounds over bounded trials: worst case ${s.p4.worst_case}, best case ${s.p4.best_case}.`,
      `- Claim: **${s.p4.claim}**: ${s.p4.claim_label}.`,
      '- A worst-case success is a conditional bound. It is never a Verified or accepted result.',
      '',
      '### Missingness',
      '',
      `- Classified 429s: ${s.throttles.length}${s.throttles.length ? `: ${s.throttles.map((x) => `${x.attempt_id} (position ${x.position}, ${x.condition}, a${x.attempt})`).join('; ')}` : ''}.`,
      `- Exhausted pools: ${s.exhausted_pools.join(', ') || 'none'}.`,
      `- Outage stop: ${s.protocol.state === 'stopped' && s.protocol.reason === 'throttle_outage' ? `yes, at ${s.protocol.attempt_id}` : 'no'}.`,
      `- Missing per condition: with ${s.p4.balance.missing_with} of ${s.p4.balance.scheduled_with}, without ${s.p4.balance.missing_without} of ${s.p4.balance.scheduled_without}; Fisher two-sided p = ${s.p4.balance.fisher_two_sided_p.toFixed(3)} (reported, not a gate).`,
      `- Inconsistencies: ${s.inconsistencies.join('; ') || 'none'}.`,
      '',
    );
  }
  return lines.join('\n');
}
