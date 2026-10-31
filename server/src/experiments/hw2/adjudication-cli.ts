/**
 * HW2 sealed condition-blinded adjudication CLI (unpaid, offline, deterministic).
 *
 *   pnpm exec tsx src/experiments/hw2/adjudication-cli.ts <command> --dir <dir> [--flag value …]
 *
 *   prepare   --input <adjudication-input.json>   blind packet + private mapping + digests
 *   register  --judgment <file>                   validate and seal one adjudicator's judgment
 *   disputed                                      case IDs the two sealed judgments disagree on
 *   reconcile --judgment <file>                   seal a reconciliation of disputed cases only
 *   verify                                        recheck every digest and seal
 *   reveal    [--out <report.md>]                 open the mapping only after two valid seals
 *
 * The directory layout is the audit record:
 *   packet.json          shareable with adjudicators (no condition, slot, run, Skill or cost)
 *   private/mapping.json case → slot/condition; never given to adjudicators
 *   digests.json         packet and mapping SHA-256, published before judging
 *   private/judgments/<name>.json, private/reconciliation.json
 *                        sealed judgments stay private until the reveal, so the
 *                        second adjudicator cannot read the first; the reveal
 *                        publishes them as judgments/<name>.json
 *   seals.jsonl          append-only: digest, register, reconcile and reveal events with timestamps
 *   report.json, report.md
 *
 * The input is written by `cli.ts report --adjudication-input <file>`.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FIXTURE_GROUND_TRUTH,
  TECHNICAL_RULES,
  digest,
  judgmentErrors,
  preparePacket,
  reveal,
  sealJudgment,
  type AdjudicationDesign,
  type BlindPacket,
  type CaseMapping,
  type Judgment,
  type RevealResult,
} from './adjudication.js';
import type { SlotRow, SlotRunData } from './report.js';

export interface AdjudicationInput {
  /** The frozen pre-registration's schedule and manifest fingerprint. */
  design: AdjudicationDesign;
  rows: SlotRow[];
  runs: Record<string, SlotRunData | null>;
  skill_names: string[];
}

interface Digests {
  packet_sha256: string;
  mapping_sha256: string;
}

interface SealEvent {
  at: string;
  event: 'digests' | 'register' | 'reconcile' | 'reveal';
  adjudicator?: string;
  seal?: string;
  packet_sha256?: string;
  mapping_sha256?: string;
}

type Flags = Record<string, string | true>;

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return { command, flags };
}

const need = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string') throw new Error(`--${name} is required`);
  return value;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown, mode = 0o644) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode });
  chmodSync(path, mode);
};

class Record_ {
  constructor(readonly dir: string) {}
  path = (...parts: string[]) => join(this.dir, ...parts);
  packet = () => readJson<BlindPacket>(this.path('packet.json'));
  mapping = () => readJson<CaseMapping>(this.path('private', 'mapping.json'));
  digests = () => readJson<Digests>(this.path('digests.json'));
  seals = (): SealEvent[] =>
    existsSync(this.path('seals.jsonl'))
      ? readFileSync(this.path('seals.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as SealEvent)
      : [];
  append = (event: SealEvent) => appendFileSync(this.path('seals.jsonl'), `${JSON.stringify(event)}\n`);
  judgments = (): Array<{ judgment: Judgment; seal: string }> =>
    this.seals()
      .filter((e) => e.event === 'register')
      .map((e) => ({ judgment: readJson<Judgment>(this.path('private', 'judgments', `${e.adjudicator}.json`)), seal: e.seal! }));
  reconciliation = (): { judgment: Judgment; seal: string } | null => {
    const event = this.seals().find((e) => e.event === 'reconcile');
    return event ? { judgment: readJson<Judgment>(this.path('private', 'reconciliation.json')), seal: event.seal! } : null;
  };
  revealed = () => this.seals().some((e) => e.event === 'reveal') || existsSync(this.path('report.json'));
}

/** Every integrity problem in the record: digests, seals, and judgment files on disk. */
export function verifyRecord(dir: string): string[] {
  const rec = new Record_(dir);
  const problems: string[] = [];
  const digests = rec.digests();
  if (digest(rec.packet()) !== digests.packet_sha256) problems.push('packet.json does not match its published digest');
  if (digest(rec.mapping()) !== digests.mapping_sha256) problems.push('private/mapping.json does not match its published digest');
  const published = rec.seals().find((e) => e.event === 'digests');
  if (!published || published.packet_sha256 !== digests.packet_sha256 || published.mapping_sha256 !== digests.mapping_sha256) {
    problems.push('digests.json differs from the digests first recorded in seals.jsonl');
  }
  const registered = rec.seals().filter((e) => e.event === 'register');
  const names = registered.map((e) => e.adjudicator!);
  if (new Set(names).size !== names.length) problems.push('an adjudicator was registered more than once');
  for (const event of registered) {
    const file = rec.path('private', 'judgments', `${event.adjudicator}.json`);
    if (!existsSync(file)) problems.push(`judgment of ${event.adjudicator} is missing`);
    else if (sealJudgment(readJson<Judgment>(file)) !== event.seal) problems.push(`judgment of ${event.adjudicator} does not match its seal`);
  }
  const judgmentDir = rec.path('private', 'judgments');
  const onDisk = existsSync(judgmentDir) ? readdirSync(judgmentDir).map((f) => f.replace(/\.json$/, '')) : [];
  for (const name of onDisk) if (!names.includes(name)) problems.push(`judgment ${name}.json was never registered`);
  const rc = rec.seals().find((e) => e.event === 'reconcile');
  const rcFile = rec.path('private', 'reconciliation.json');
  if (rc && sealJudgment(readJson<Judgment>(rcFile)) !== rc.seal) problems.push('reconciliation.json does not match its seal');
  if (!rc && existsSync(rcFile)) problems.push('reconciliation.json was never sealed');
  return problems;
}

function disputedCases(rec: Record_): string[] {
  const [a, b] = rec.judgments();
  if (!a || !b) throw new Error('two sealed judgments are needed first');
  const verdict = (j: Judgment, id: string) => j.verdicts.find((v) => v.case_id === id)?.detected;
  return rec.packet().cases.map((c) => c.case_id).filter((id) => verdict(a.judgment, id) !== verdict(b.judgment, id));
}

export function renderAdjudicationReport(rec: { digests: Digests; seals: SealEvent[]; result: RevealResult; warnings: CaseMapping['blinding_warnings'] }): string {
  const lines = ['# HW2 sealed adjudication report', '', `- packet SHA-256: \`${rec.digests.packet_sha256}\``, `- mapping SHA-256: \`${rec.digests.mapping_sha256}\``, '', '## Seal order', ''];
  for (const e of rec.seals) lines.push(`- ${e.at} ${e.event}${e.adjudicator ? ` ${e.adjudicator}` : ''}${e.seal ? ` \`${e.seal}\`` : ''}`);
  lines.push('', '## Result', '');
  if (rec.result.status === 'invalid') {
    lines.push('**Invalid record — no outcome.**', '', ...rec.result.errors.map((e) => `- ${e}`));
    return `${lines.join('\n')}\n`;
  }
  lines.push('| Experiment | With: detected / scheduled (ambiguous) | Without: detected / scheduled (ambiguous) | Outcome |', '| --- | --- | --- | --- |');
  for (const x of rec.result.experiments) {
    lines.push(`| ${x.experiment} | ${x.with.detected} / ${x.with.scheduled} (${x.with.ambiguous}) | ${x.without.detected} / ${x.without.scheduled} (${x.without.ambiguous}) | ${x.outcome}${x.note ? ` — ${x.note}` : ''} |`);
  }
  lines.push('', '| Case | Slot | Condition | Final | Per adjudicator |', '| --- | --- | --- | --- | --- |');
  for (const c of rec.result.cases) lines.push(`| ${c.case_id} | ${c.slot_id} | ${c.condition} | ${c.final} | ${Object.entries(c.verdicts).map(([k, v]) => `${k}: ${v}`).join(', ')} |`);
  lines.push('', `Blinding compromised: ${rec.result.blinding_compromised ? 'yes' : 'no'}`);
  for (const w of rec.warnings) lines.push(`- ${w.case_id} ${w.ref}: "${w.term}"`);
  return `${lines.join('\n')}\n`;
}

export async function main(argv: string[], now: () => Date = () => new Date(), log: (line: string) => void = console.log): Promise<void> {
  const { command, flags } = parseArgs(argv);
  const at = () => now().toISOString();
  if (command === 'help') {
    log('commands: prepare | register | disputed | reconcile | verify | reveal (all take --dir)');
    return;
  }
  const dir = resolve(need(flags, 'dir'));
  const rec = new Record_(dir);
  switch (command) {
    case 'prepare': {
      if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty; a record is never prepared twice`);
      const input = readJson<AdjudicationInput>(need(flags, 'input'));
      const prepared = preparePacket({
        design: input.design,
        rows: input.rows,
        runs: new Map(Object.entries(input.runs)),
        rules: TECHNICAL_RULES,
        groundTruth: FIXTURE_GROUND_TRUTH,
        skillNames: input.skill_names,
      });
      mkdirSync(rec.path('private', 'judgments'), { recursive: true, mode: 0o700 });
      writeJson(rec.path('packet.json'), prepared.packet);
      writeJson(rec.path('private', 'mapping.json'), prepared.mapping, 0o600);
      const digests: Digests = { packet_sha256: prepared.packet_sha256, mapping_sha256: prepared.mapping_sha256 };
      writeJson(rec.path('digests.json'), digests);
      rec.append({ at: at(), event: 'digests', ...digests });
      log(`prepared ${prepared.packet.cases.length} case(s); packet ${digests.packet_sha256}; mapping ${digests.mapping_sha256}`);
      if (prepared.mapping.blinding_warnings.length > 0) log(`blinding warnings: ${prepared.mapping.blinding_warnings.length} (recorded in the private mapping)`);
      return;
    }
    case 'register': {
      if (rec.revealed()) throw new Error('the mapping is already revealed; no judgment can be registered');
      const problems = verifyRecord(dir);
      if (problems.length > 0) throw new Error(`record integrity: ${problems.join('; ')}`);
      const judgment = readJson<Judgment>(need(flags, 'judgment'));
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(judgment.adjudicator ?? '')) throw new Error('adjudicator must be 1-64 characters of [A-Za-z0-9._-]');
      if (judgment.adjudicator === 'reconciliation') throw new Error('"reconciliation" is reserved');
      const registered = rec.seals().filter((e) => e.event === 'register');
      if (registered.some((e) => e.adjudicator === judgment.adjudicator)) throw new Error(`${judgment.adjudicator} is already registered`);
      if (registered.length >= 2) throw new Error('two judgments are already registered');
      const packet = rec.packet();
      const errors = judgmentErrors(judgment, packet, rec.digests().packet_sha256, null);
      if (errors.length > 0) throw new Error(errors.join('; '));
      const seal = sealJudgment(judgment);
      writeJson(rec.path('private', 'judgments', `${judgment.adjudicator}.json`), judgment, 0o600);
      rec.append({ at: at(), event: 'register', adjudicator: judgment.adjudicator, seal });
      log(`sealed ${judgment.adjudicator}: ${seal}`);
      return;
    }
    case 'disputed': {
      const problems = verifyRecord(dir);
      if (problems.length > 0) throw new Error(`record integrity: ${problems.join('; ')}`);
      const ids = disputedCases(rec);
      log(ids.length === 0 ? 'no disputed cases' : ids.join('\n'));
      return;
    }
    case 'reconcile': {
      if (rec.revealed()) throw new Error('the mapping is already revealed; reconciliation must come before the reveal');
      if (rec.reconciliation()) throw new Error('a reconciliation is already sealed');
      const problems = verifyRecord(dir);
      if (problems.length > 0) throw new Error(`record integrity: ${problems.join('; ')}`);
      const disputed = new Set(disputedCases(rec));
      const judgment = readJson<Judgment>(need(flags, 'judgment'));
      if (judgment.adjudicator !== 'reconciliation') throw new Error('a reconciliation judgment has adjudicator "reconciliation"');
      const errors = judgmentErrors(judgment, rec.packet(), rec.digests().packet_sha256, new Set());
      for (const v of judgment.verdicts) if (!disputed.has(v.case_id)) errors.push(`case ${v.case_id} is not disputed`);
      if (errors.length > 0) throw new Error(errors.join('; '));
      const seal = sealJudgment(judgment);
      writeJson(rec.path('private', 'reconciliation.json'), judgment, 0o600);
      rec.append({ at: at(), event: 'reconcile', adjudicator: 'reconciliation', seal });
      log(`sealed reconciliation of ${judgment.verdicts.length} case(s): ${seal}`);
      return;
    }
    case 'verify': {
      const problems = verifyRecord(dir);
      log(problems.length === 0 ? 'record intact' : problems.join('\n'));
      if (problems.length > 0) process.exitCode = 1;
      return;
    }
    case 'reveal': {
      if (rec.revealed()) throw new Error('already revealed');
      const problems = verifyRecord(dir);
      if (problems.length > 0) throw new Error(`record integrity: ${problems.join('; ')}`);
      if (rec.judgments().length !== 2) throw new Error('exactly two sealed judgments are required before the reveal');
      const digests = rec.digests();
      const mapping = rec.mapping();
      const result = reveal({
        packet: rec.packet(),
        packet_sha256: digests.packet_sha256,
        mapping,
        mapping_sha256: digests.mapping_sha256,
        judgments: rec.judgments(),
        reconciliation: rec.reconciliation(),
      });
      // The report exists before the reveal is recorded; either one marks the record revealed.
      const revealedAt = at();
      const seals = [...rec.seals(), { at: revealedAt, event: 'reveal' as const }];
      const report = renderAdjudicationReport({ digests, seals, result, warnings: mapping.blinding_warnings });
      writeJson(rec.path('report.json'), { generated_at: revealedAt, result });
      writeFileSync(rec.path('report.md'), report, { flag: 'wx' });
      rec.append({ at: revealedAt, event: 'reveal' });
      // Publish the sealed judgments and the mapping now that the conditions are open.
      mkdirSync(rec.path('judgments'), { recursive: true });
      for (const { judgment } of rec.judgments()) writeJson(rec.path('judgments', `${judgment.adjudicator}.json`), judgment);
      const reconciliation = rec.reconciliation();
      if (reconciliation) writeJson(rec.path('reconciliation.json'), reconciliation.judgment);
      writeJson(rec.path('mapping.json'), mapping);
      if (typeof flags.out === 'string') writeFileSync(flags.out, report);
      log(report);
      if (result.status === 'invalid') process.exitCode = 1;
      return;
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`hw2-adjudication: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
