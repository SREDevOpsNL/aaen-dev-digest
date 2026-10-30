import { createHash, randomBytes } from 'node:crypto';
import type { SlotRow, SlotRunData } from './report.js';
import { experimentOutcome } from './rules.js';

/**
 * Sealed, condition-blinded technical adjudication (PROSPECTIVE-STUDY.md),
 * built from data only. The preparer turns counted slots into a packet that
 * carries finding text and anchors under opaque case IDs, and keeps the
 * case-to-slot mapping private. Each adjudicator's judgment is sealed by its
 * hash before the mapping is revealed. `reveal` refuses any packet, mapping or
 * judgment that does not match its published digest, and reports a passing
 * outcome only when every scheduled slot has an unambiguous verdict.
 *
 * Digests prove that a record was not altered after its digest was published;
 * they cannot prove the order in which records were published.
 */

export type Verdict = 'yes' | 'no' | 'ambiguous';

export interface BlindFinding {
  /** Opaque within the case: f1, f2, … in the run's finding order. */
  ref: string;
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  rationale: string;
}

export interface BlindCase {
  case_id: string;
  experiment: string;
  findings: BlindFinding[];
}

export interface BlindPacket {
  version: 1;
  /** The frozen technical rule per experiment, as the adjudicators apply it. */
  rules: Record<string, string>;
  /** Sorted by case_id, so packet order does not follow the schedule. */
  cases: BlindCase[];
}

export interface MappingEntry {
  slot_id: string;
  experiment: string;
  condition: 'with' | 'without';
  /** null when the scheduled slot was not counted; it never enters the packet. */
  case_id: string | null;
  not_counted_reason: string | null;
}

export interface BlindingWarning {
  case_id: string;
  ref: string;
  term: string;
}

export interface CaseMapping {
  version: 1;
  packet_sha256: string;
  entries: MappingEntry[];
  /** Finding wording that may reveal the condition: recorded, never hidden. */
  blinding_warnings: BlindingWarning[];
}

export interface CaseVerdict {
  case_id: string;
  detected: Verdict;
  /** The finding(s) supporting the verdict; required for `yes`. */
  finding_refs: string[];
  reason: string;
}

export interface Judgment {
  adjudicator: string;
  packet_sha256: string;
  verdicts: CaseVerdict[];
}

/** Stable JSON: object keys sorted at every level, so equal records hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Wording that names the Skill mechanism or a target Skill would reveal the condition. */
const LEAK_TERMS = ['skill', 'untrusted source', 'with-skill', 'without-skill'];

function blindingWarnings(cases: BlindCase[], extraTerms: string[]): BlindingWarning[] {
  const terms = [...LEAK_TERMS, ...extraTerms.map((t) => t.toLowerCase())];
  const warnings: BlindingWarning[] = [];
  for (const c of cases) {
    for (const f of c.findings) {
      const text = `${f.title}\n${f.rationale}`.toLowerCase();
      for (const term of terms) if (text.includes(term)) warnings.push({ case_id: c.case_id, ref: f.ref, term });
    }
  }
  return warnings;
}

export function preparePacket(input: {
  rows: SlotRow[];
  runs: Map<string, SlotRunData | null>;
  rules: Record<string, string>;
  /** Target Skill names, checked as condition-revealing terms. */
  skillNames: string[];
  newCaseId?: () => string;
}): { packet: BlindPacket; packet_sha256: string; mapping: CaseMapping; mapping_sha256: string } {
  const newCaseId = input.newCaseId ?? (() => `case-${randomBytes(6).toString('hex')}`);
  const used = new Set<string>();
  const cases: BlindCase[] = [];
  const entries: MappingEntry[] = input.rows.map((row) => {
    const run = input.runs.get(row.slot_id) ?? null;
    if (!row.counted || !run) {
      const reason = !run ? `no run (${row.state})` : row.execution_issues[0] ?? row.eligibility?.reasons?.[0] ?? 'not counted';
      return { slot_id: row.slot_id, experiment: row.experiment, condition: row.condition, case_id: null, not_counted_reason: reason };
    }
    let caseId = newCaseId();
    while (used.has(caseId)) caseId = newCaseId();
    used.add(caseId);
    cases.push({
      case_id: caseId,
      experiment: row.experiment,
      findings: run.findings.map((f, i) => ({
        ref: `f${i + 1}`,
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        title: f.title,
        rationale: f.rationale,
      })),
    });
    return { slot_id: row.slot_id, experiment: row.experiment, condition: row.condition, case_id: caseId, not_counted_reason: null };
  });
  cases.sort((a, b) => (a.case_id < b.case_id ? -1 : 1));
  const packet: BlindPacket = { version: 1, rules: input.rules, cases };
  const packet_sha256 = digest(packet);
  const mapping: CaseMapping = { version: 1, packet_sha256, entries, blinding_warnings: blindingWarnings(cases, input.skillNames) };
  return { packet, packet_sha256, mapping, mapping_sha256: digest(mapping) };
}

export const sealJudgment = (judgment: Judgment) => digest(judgment);

export interface ConditionTally {
  scheduled: number;
  adjudicated: number;
  detected: number;
  ambiguous: number;
}

export interface AdjudicatedExperiment {
  experiment: string;
  with: ConditionTally;
  without: ConditionTally;
  outcome: 'success' | 'negative' | 'inconclusive' | 'incomplete';
  note: string | null;
}

export type RevealResult =
  | { status: 'invalid'; errors: string[] }
  | {
      status: 'revealed';
      cases: Array<{ case_id: string; slot_id: string; condition: 'with' | 'without'; experiment: string; final: Verdict; verdicts: Record<string, Verdict> }>;
      experiments: AdjudicatedExperiment[];
      blinding_compromised: boolean;
    };

function judgmentErrors(j: Judgment, packet: BlindPacket, packetSha: string, cases: Set<string> | null): string[] {
  const errors: string[] = [];
  const who = j.adjudicator || '(unnamed)';
  if (!j.adjudicator) errors.push('a judgment has no adjudicator');
  if (j.packet_sha256 !== packetSha) errors.push(`${who} judged a different packet`);
  const seen = new Set<string>();
  for (const v of j.verdicts) {
    const c = packet.cases.find((x) => x.case_id === v.case_id);
    if (!c) errors.push(`${who} judged unknown case ${v.case_id}`);
    if (seen.has(v.case_id)) errors.push(`${who} judged ${v.case_id} twice`);
    seen.add(v.case_id);
    if (!['yes', 'no', 'ambiguous'].includes(v.detected)) errors.push(`${who} gave ${v.case_id} an invalid verdict`);
    if (v.detected === 'yes' && v.finding_refs.length === 0) errors.push(`${who} said yes on ${v.case_id} without citing a finding`);
    for (const ref of v.finding_refs) if (c && !c.findings.some((f) => f.ref === ref)) errors.push(`${who} cited unknown finding ${ref} on ${v.case_id}`);
    if (!v.reason.trim()) errors.push(`${who} gave no reason for ${v.case_id}`);
  }
  // An adjudicator must judge every case; a reconciliation judges only the disputed ones.
  const required = cases ?? new Set(packet.cases.map((c) => c.case_id));
  for (const id of required) if (!seen.has(id)) errors.push(`${who} did not judge ${id}`);
  return errors;
}

export function reveal(input: {
  packet: BlindPacket;
  packet_sha256: string;
  mapping: CaseMapping;
  mapping_sha256: string;
  judgments: Array<{ judgment: Judgment; seal: string }>;
  /** Sealed before the reveal, decided against the rule without the condition. */
  reconciliation?: { judgment: Judgment; seal: string } | null;
}): RevealResult {
  const errors: string[] = [];
  if (digest(input.packet) !== input.packet_sha256) errors.push('the packet does not match its published digest');
  if (digest(input.mapping) !== input.mapping_sha256) errors.push('the mapping does not match its published digest');
  if (input.mapping.packet_sha256 !== input.packet_sha256) errors.push('the mapping belongs to a different packet');
  const caseIds = input.packet.cases.map((c) => c.case_id);
  const mapped = input.mapping.entries.filter((e) => e.case_id !== null).map((e) => e.case_id!);
  if (mapped.length !== caseIds.length || caseIds.some((id) => !mapped.includes(id))) errors.push('the mapping and packet do not cover the same cases');

  const names = input.judgments.map((j) => j.judgment.adjudicator);
  if (new Set(names).size !== 2 || names.length !== 2) errors.push('exactly two distinct adjudicators are required');
  for (const { judgment, seal } of input.judgments) {
    if (sealJudgment(judgment) !== seal) errors.push(`${judgment.adjudicator || '(unnamed)'}'s judgment does not match its seal`);
    errors.push(...judgmentErrors(judgment, input.packet, input.packet_sha256, null));
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const verdictOf = (j: Judgment, id: string) => j.verdicts.find((v) => v.case_id === id)!.detected;
  const disputed = new Set(caseIds.filter((id) => verdictOf(input.judgments[0]!.judgment, id) !== verdictOf(input.judgments[1]!.judgment, id)));
  const rec = input.reconciliation ?? null;
  if (rec) {
    if (sealJudgment(rec.judgment) !== rec.seal) errors.push('the reconciliation does not match its seal');
    errors.push(...judgmentErrors(rec.judgment, input.packet, input.packet_sha256, new Set()));
    for (const v of rec.judgment.verdicts) if (!disputed.has(v.case_id)) errors.push(`the reconciliation overrides undisputed case ${v.case_id}`);
    if (errors.length > 0) return { status: 'invalid', errors };
  }

  const cases = input.mapping.entries
    .filter((e) => e.case_id !== null)
    .map((e) => {
      const id = e.case_id!;
      const verdicts = Object.fromEntries(input.judgments.map(({ judgment }) => [judgment.adjudicator, verdictOf(judgment, id)])) as Record<string, Verdict>;
      const resolved = rec?.judgment.verdicts.find((v) => v.case_id === id)?.detected;
      // Unresolved disagreement stays ambiguous.
      const final: Verdict = disputed.has(id) ? resolved ?? 'ambiguous' : verdictOf(input.judgments[0]!.judgment, id);
      return { case_id: id, slot_id: e.slot_id, condition: e.condition, experiment: e.experiment, final, verdicts };
    });

  const experiments = [...new Set(input.mapping.entries.map((e) => e.experiment))].map((experiment): AdjudicatedExperiment => {
    const tally = (condition: 'with' | 'without'): ConditionTally => {
      const scheduled = input.mapping.entries.filter((e) => e.experiment === experiment && e.condition === condition).length;
      const judged = cases.filter((c) => c.experiment === experiment && c.condition === condition);
      return {
        scheduled,
        adjudicated: judged.filter((c) => c.final !== 'ambiguous').length,
        detected: judged.filter((c) => c.final === 'yes').length,
        ambiguous: judged.filter((c) => c.final === 'ambiguous').length,
      };
    };
    const w = tally('with');
    const wo = tally('without');
    // Five scheduled, not surviving, trials per condition: no replacement and no partial pass.
    const gaps = [w, wo].some((t) => t.scheduled < 5 || t.adjudicated < t.scheduled);
    if (gaps) {
      const note = `${w.scheduled - w.adjudicated} with and ${wo.scheduled - wo.adjudicated} without scheduled slot(s) lack an unambiguous adjudicated verdict`;
      return { experiment, with: w, without: wo, outcome: 'incomplete', note };
    }
    return { experiment, with: w, without: wo, outcome: experimentOutcome(w.detected, w.adjudicated, wo.detected, wo.adjudicated) as AdjudicatedExperiment['outcome'], note: null };
  });

  return { status: 'revealed', cases, experiments, blinding_compromised: input.mapping.blinding_warnings.length > 0 };
}
