import { evaluateSlot, fingerprintsAgree, type Eligibility, type FrozenExpectations } from './eligibility.js';
import type { SlotRecord } from './ledger.js';
import { detection, type ExpectedRule, type FindingLike } from './rules.js';

/**
 * The experiment report, built from data only (the CLI fetches it). Every
 * scheduled slot appears, including slots that were never dispatched; a slot
 * counts only when it is strict single-generation evidence AND reproduces the
 * frozen non-Skill fingerprint. Regex screening uses the pre-registered rules
 * but never establishes a final technical detection or passing outcome.
 */

export interface ScheduledSlot {
  slot_id: string;
  experiment: string;
  condition: 'with' | 'without';
}

export interface SlotRunData {
  run_id: string;
  cost_usd: number | null;
  experiment: { non_skill_fingerprint?: string | null } & Record<string, unknown>;
  /** The persisted trace's reviewer and PR: what actually ran. */
  config: { agent?: string; pr?: number | null } | null;
  /** The persisted Skills section the model received (null = none). */
  skills_block: string | null;
  findings: FindingLike[];
}

/** What a slot's trace must show it executed (never inferred from the scheduled label). */
export interface ExpectedExecution {
  manifestFingerprint: string;
  phase: 'confirmatory' | 'exploration';
  fixture: (experiment: string) => { reviewer: string; prNumber: number; targetSkill: string };
  /** sha256 of the Skill slot for the condition: [] without, [the target skill block] with. */
  skillFingerprint: (experiment: string, condition: 'with' | 'without') => string;
}

/** Every way the persisted trace disagrees with what this scheduled slot was meant to execute. */
export function executionIssues(slot: ScheduledSlot, run: SlotRunData, expected: ExpectedExecution): string[] {
  const issues: string[] = [];
  const block = run.experiment as Record<string, unknown>;
  const check = (field: string, actual: unknown, want: unknown) => {
    if (actual !== want) issues.push(`trace ${field} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(want)}`);
  };
  check('slot_id', block.slot_id, slot.slot_id);
  check('experiment', block.experiment, slot.experiment);
  check('condition', block.condition, slot.condition);
  check('phase', block.phase, expected.phase);
  check('manifest_fingerprint', block.manifest_fingerprint, expected.manifestFingerprint);
  const fixture = expected.fixture(slot.experiment);
  check('reviewer', run.config?.agent, fixture.reviewer);
  check('fixture PR', run.config?.pr, fixture.prNumber);

  // The Skills section actually sent, by structure and by fingerprint.
  const skillCount = (run.skills_block?.match(/<untrusted source="skill-\d+">/g) ?? []).length;
  if (slot.condition === 'without' && (run.skills_block ?? '') !== '') {
    issues.push(`a "without" slot sent ${skillCount} skill(s) in its Skills section`);
  }
  if (slot.condition === 'with') {
    if (skillCount !== 1) issues.push(`a "with" slot sent ${skillCount} skills instead of exactly the target skill`);
    else if (!run.skills_block!.includes(`### ${fixture.targetSkill}\n`)) issues.push(`the one skill sent is not the target skill ${fixture.targetSkill}`);
  }
  check('skill_fingerprint', block.skill_fingerprint, expected.skillFingerprint(slot.experiment, slot.condition));
  return issues;
}

export interface SlotRow {
  /** Disagreements between the persisted trace and this slot's preregistered execution. */
  execution_issues: string[];
  slot_id: string;
  experiment: string;
  condition: 'with' | 'without';
  state: string;
  run_id: string | null;
  cost_usd: number | null;
  eligibility: Eligibility | null;
  fingerprint_ok: boolean;
  counted: boolean;
  detected: boolean | null;
  finding_titles: string[];
  matched: Array<{ title: string; file: string; lines: string }>;
}

export interface ExperimentSummary {
  experiment: string;
  with: { counted: number; detected: number };
  without: { counted: number; detected: number };
  fingerprints_agree: boolean;
  outcome: 'success' | 'negative' | 'inconclusive' | 'incomplete' | 'invalid';
  note: string | null;
}

export function buildReport(input: {
  schedule: ScheduledSlot[];
  ledger: Map<string, SlotRecord>;
  runs: Map<string, SlotRunData | null>;
  rules: Record<string, ExpectedRule>;
  frozenNonSkill: Record<string, string>;
  expectations: (experiment: string) => FrozenExpectations;
  execution: ExpectedExecution;
}): { rows: SlotRow[]; summaries: ExperimentSummary[] } {
  const rows: SlotRow[] = input.schedule.map((slot) => {
    const record = input.ledger.get(slot.slot_id) ?? null;
    const run = input.runs.get(slot.slot_id) ?? null;
    if (!run) {
      return {
        ...slot,
        state: record?.state ?? 'not dispatched',
        run_id: record?.run_id ?? null,
        cost_usd: record?.cost_usd ?? null,
        eligibility: null,
        fingerprint_ok: false,
        counted: false,
        detected: null,
        finding_titles: [],
        matched: [],
        execution_issues: [],
      };
    }
    const issues = executionIssues(slot, run, input.execution);
    const eligibility = evaluateSlot(run, input.expectations(slot.experiment));
    const fingerprintOk = run.experiment.non_skill_fingerprint === input.frozenNonSkill[slot.experiment];
    const rule = input.rules[slot.experiment];
    const found = rule ? detection(run.findings, rule) : { detected: false, matched: [] };
    const matched = run.findings
      .filter((f) => found.matched.includes(f.title))
      .map((f) => ({ title: f.title, file: f.file, lines: `${f.start_line}-${f.end_line}` }));
    return {
      ...slot,
      state: record?.state ?? 'unknown',
      run_id: run.run_id,
      cost_usd: run.cost_usd,
      eligibility,
      fingerprint_ok: fingerprintOk,
      counted: eligibility.eligible && fingerprintOk && issues.length === 0,
      execution_issues: issues,
      detected: found.detected,
      finding_titles: run.findings.map((f) => f.title),
      matched,
    };
  });

  const experiments = [...new Set(input.schedule.map((s) => s.experiment))];
  const summaries = experiments.map((experiment): ExperimentSummary => {
    const counted = rows.filter((r) => r.experiment === experiment && r.counted);
    const tally = (condition: 'with' | 'without') => {
      const subset = counted.filter((r) => r.condition === condition);
      return { counted: subset.length, detected: subset.filter((r) => r.detected).length };
    };
    const withT = tally('with');
    const withoutT = tally('without');
    // Operational check: every counted trial reproduces one non-Skill fingerprint, the frozen one.
    const blocks = counted.map((r) => ({ non_skill_fingerprint: input.runs.get(r.slot_id)?.experiment.non_skill_fingerprint ?? null }));
    const agree = counted.length === 0 || (fingerprintsAgree(blocks) && blocks[0]!.non_skill_fingerprint === input.frozenNonSkill[experiment]);
    const mismatched = rows.filter((r) => r.experiment === experiment && r.eligibility?.eligible && !r.fingerprint_ok).length;
    if (!agree || mismatched > 0) {
      return { experiment, with: withT, without: withoutT, fingerprints_agree: false, outcome: 'invalid', note: `${mismatched} otherwise eligible slot(s) did not reproduce the frozen non-Skill fingerprint` };
    }
    // A slot that did not execute what was scheduled breaks the comparison itself.
    const wrong = rows.filter((r) => r.experiment === experiment && r.execution_issues.length > 0);
    if (wrong.length > 0) {
      return {
        experiment,
        with: withT,
        without: withoutT,
        fingerprints_agree: true,
        outcome: 'invalid',
        note: `${wrong.length} slot(s) did not execute their preregistered slot, condition or Skills: ${wrong.map((r) => `${r.slot_id} (${r.execution_issues[0]})`).join('; ')}`,
      };
    }
    // Anchored regexes are a provisional screen, not technical adjudication.
    // They cannot establish #17's conjunction or #18's lookup-semantics break.
    return {
      experiment,
      with: withT,
      without: withoutT,
      fingerprints_agree: true,
      outcome: 'incomplete',
      note: 'Anchored regex screening is non-authoritative; sealed condition-blinded technical adjudication is required',
    };
  });
  return { rows, summaries };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderReport(report: { rows: SlotRow[]; summaries: ExperimentSummary[] }): string {
  const lines = [
    '| Experiment | With: regex hits / eligible | Without: regex hits / eligible | Fingerprints agree | Outcome |',
    '| --- | --- | --- | --- | --- |',
    ...report.summaries.map(
      (s) =>
        `| ${s.experiment} | ${s.with.detected} / ${s.with.counted} | ${s.without.detected} / ${s.without.counted} | ${s.fingerprints_agree ? 'yes' : 'no'} | ${s.outcome}${s.note ? ` (${cell(s.note)})` : ''} |`,
    ),
    '',
    '| Slot | Exp. | Condition | State | Counted | Provenance | Fingerprint | Regex screen | Matched (anchor) | All finding titles | Cost (USD) | Not counted because |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.rows.map((r) =>
      [
        r.slot_id,
        r.experiment,
        r.condition,
        r.state,
        r.counted ? 'yes' : 'no',
        r.eligibility ? `${r.eligibility.provenance} (${r.eligibility.sources.join(', ') || '—'})` : '—',
        r.run_id ? (r.fingerprint_ok ? 'frozen' : 'MISMATCH') : '—',
        r.detected === null ? '—' : r.detected ? 'yes' : 'no',
        r.matched.map((m) => `${m.title} (${m.file}:${m.lines})`).join('; ') || '—',
        r.finding_titles.join('; ') || '—',
        r.cost_usd === null ? 'unknown' : String(r.cost_usd),
        r.counted
          ? '—'
          : r.eligibility
            ? [...r.execution_issues, ...r.eligibility.reasons, ...(r.fingerprint_ok ? [] : ['non-Skill fingerprint differs from the frozen one'])].join('; ') || '—'
            : r.state,
      ]
        .map((v) => cell(String(v)))
        .join(' | '),
    ).map((row) => `| ${row} |`),
  ];
  return lines.join('\n');
}
