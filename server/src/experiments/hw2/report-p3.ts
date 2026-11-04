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
  attemptPlan,
  parseAttemptId,
  trialLabel,
  type ProtocolSummary,
  modelPacing,
  modelPolicy,
  outcomeOfClass,
  p4Lines,
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
import { TAGGED_SLOT_ID, parseSlotId, type Slot } from './schedule.js';

/**
 * How much shorter than declared a measured pacing gap may look before it
 * counts as a deviation. The ledger stamps wall-clock UTC, and on the WSL2
 * host the wall clock jumps back about 6.4 s every few seconds (server
 * LEARNINGS, 2026-10-20), so a tighter bound would flag a correct wait. A
 * skipped wait (0 s against 30, 60 or 180 s) is always caught.
 */
export const PACING_TOLERANCE_MS = 10_000;
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
  /** The measured gap: this attempt's armed time minus the previous attempt's finished time (null for the first). */
  gap_ms: number | null;
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
  protocol: ProtocolSummary;
  /** IDs with the study's tag outside the frozen plan (a trial ID, an `-a4`, …): listed, and they block the claim. */
  unplanned: string[];
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
  // Every recorded attempt, in the order it was dispatched (its first ledger event), so an
  // out-of-order dispatch reaches the validator as it happened (F2).
  const ledgerOrder = [...input.ledger.keys()];
  const dispatchIndex = (id: string) => { const i = ledgerOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  const recorded = plan
    .filter((a) => input.ledger.has(a.attempt_id) || input.runs.get(a.attempt_id))
    .sort((a, b) => dispatchIndex(a.attempt_id) - dispatchIndex(b.attempt_id) || a.plan_index - b.plan_index);
  // Never suppress an attempt (F1): any ID carrying the study's tag that is not in the plan.
  const planned = new Set(plan.map((a) => a.attempt_id));
  const tag = input.semantics.slotTag;
  const unplanned = [...new Set([...input.ledger.keys(), ...[...input.runs.entries()].filter(([, run]) => run).map(([id]) => id)])]
    .filter((id) => !planned.has(id) && (parseAttemptId(id)?.tag === tag || TAGGED_SLOT_ID.exec(id)?.[1] === tag));
  const attemptSchedule: ScheduledSlot[] = recorded.map((a) => ({ slot_id: a.attempt_id, experiment: trials[a.trial_index]!.experiment, condition: a.condition }));
  const base = buildReport({ ...input, schedule: attemptSchedule });
  const rowOf = new Map(base.rows.map((r) => [r.slot_id, r]));
  const inconsistencies: string[] = unplanned.map((id) => `${id} carries the study tag but is not in the frozen attempt plan (${input.ledger.get(id)?.state ?? 'on the stack only'})`);

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
      gap_ms: null,
      state: record?.state ?? row.state,
      run_id: row.run_id,
      cost_usd: row.cost_usd,
      class: cls,
      ledger_class: ledgerClass,
      reasons: cls === 'failed' ? [...new Set(reasons)].filter(Boolean) : [],
    });
  }

  // Real pacing (F3): the runner waits between the previous attempt's terminal record and
  // the next attempt's reservation, so that gap, from the UTC times, must cover the plan's delay.
  recorded.forEach((a, i) => {
    const row = attemptRows.get(a.attempt_id)!;
    if (i === 0 || a.delay_before_ms === 0) return;
    const previous = attemptRows.get(recorded[i - 1]!.attempt_id)!;
    const armed = row.armed_at ? Date.parse(row.armed_at) : Number.NaN;
    const finished = previous.finished_at ? Date.parse(previous.finished_at) : Number.NaN;
    if (!Number.isFinite(armed) || !Number.isFinite(finished)) {
      inconsistencies.push(`pacing: the gap before ${a.attempt_id} cannot be measured from the recorded times`);
      return;
    }
    row.gap_ms = armed - finished;
    if (row.gap_ms < a.delay_before_ms - PACING_TOLERANCE_MS) {
      inconsistencies.push(`pacing: ${a.attempt_id} was armed ${row.gap_ms} ms after ${previous.attempt_id} finished; the plan declares ${a.delay_before_ms} ms`);
    }
  });

  // The recorded sequence against the protocol: each step, then where it stands.
  const trace = recorded.map((a) => ({ attempt_id: a.attempt_id, outcome: outcomeOfClass(attemptRows.get(a.attempt_id)!.class), delay_before_ms: attemptRows.get(a.attempt_id)!.delay_before_ms ?? Number.NaN }));
  const stepProblems = traceProblems(trials, model, trace, modelPacing(policy), { prefix: true });
  inconsistencies.push(...stepProblems.map((p) => `protocol: ${p}`));
  const state: ProtocolState | null = stepProblems.length === 0
    ? protocolNext(plan, model, recorded.map((a, i) => ({ attempt: a, outcome: trace[i]!.outcome })))
    : null;
  const protocol: ProtocolSummary = !state
    ? { state: 'in_progress', reason: 'the recorded attempts do not follow the protocol', attempt_id: null }
    : state.kind === 'next' ? { state: 'in_progress', reason: `${state.attempt.attempt_id} is still owed`, attempt_id: state.attempt.attempt_id }
      : state.kind === 'stopped' ? { state: 'stopped', reason: state.reason, attempt_id: state.attempt_id } : { state: 'done', reason: null, attempt_id: null };

  const trialRows: TrialRow[] = trials.map((slot, index) => {
    const planIds = plan.filter((a) => a.trial_index === index).map((a) => a.attempt_id);
    const attempts = plan.filter((a) => a.trial_index === index).map((a) => attemptRows.get(a.attempt_id)).filter((a): a is AttemptRow => a !== undefined);
    const derived = trialLabel({ classes: attempts.map((a) => a.class), attemptsPerTrial: policy.attempts_per_trial, planIds, protocol });
    const scoring = derived.scoring === null ? null : attempts[derived.scoring - 1]!;
    const detected = derived.label === 'observed' ? rowOf.get(scoring!.attempt_id)!.detected : derived.label === 'imputed' ? slot.condition === 'without' : null;
    const reason = derived.label === 'incomplete' && scoring ? `${derived.reason}: ${scoring.reasons.join('; ') || scoring.state}` : derived.reason;
    return {
      position: index + 1, trial_id: slot.slot_id, experiment: slot.experiment, condition: slot.condition,
      attempts, scoring_attempt_id: scoring?.attempt_id ?? null, label: derived.label, label_reason: reason, detected, pool_exhausted: derived.pool_exhausted,
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
      protocol,
      unplanned,
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
        t.attempts.map((a) => `${a.attempt_id}: ${a.class}${a.reasons.length ? ` (${a.reasons.join('; ')})` : ''}; ${time(a.armed_at)} → ${time(a.submitted_at)} → ${time(a.finished_at)}${a.gap_ms !== null ? `; gap ${a.gap_ms / 1000} s (plan ${(a.delay_before_ms ?? 0) / 1000} s)` : ''}`).join('<br>') || '—',
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
      ...p4Lines(s.p4, 'screen'),
      '',
      '### Missingness',
      '',
      `- Classified 429s: ${s.throttles.length}${s.throttles.length ? `: ${s.throttles.map((x) => `${x.attempt_id} (position ${x.position}, ${x.condition}, a${x.attempt})`).join('; ')}` : ''}.`,
      `- Exhausted pools: ${s.exhausted_pools.join(', ') || 'none'}.`,
      `- Outage stop: ${s.protocol.state === 'stopped' && s.protocol.reason === 'throttle_outage' ? `yes, at ${s.protocol.attempt_id}` : 'no'}.`,
      `- Attempts outside the frozen plan: ${s.unplanned.join(', ') || 'none'}.`,
      `- Inconsistencies: ${s.inconsistencies.join('; ') || 'none'}.`,
      '',
    );
  }
  return lines.join('\n');
}
