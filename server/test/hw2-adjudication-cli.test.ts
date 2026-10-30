import { existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, verifyRecord, type AdjudicationInput } from '../src/experiments/hw2/adjudication-cli.js';
import { FIXTURE_GROUND_TRUTH, TECHNICAL_RULES, sealJudgment, type BlindPacket, type CaseMapping, type Judgment, type Verdict } from '../src/experiments/hw2/adjudication.js';
import type { SlotRow } from '../src/experiments/hw2/report.js';

// Synthetic slots only: these runs never prove #17 or #18.
function input(): AdjudicationInput {
  const rows: SlotRow[] = [];
  const runs: AdjudicationInput['runs'] = {};
  for (const experiment of ['17', '18']) {
    for (const condition of ['with', 'without'] as const) {
      for (let trial = 1; trial <= 5; trial++) {
        const slot_id = `c-${experiment}-${condition}-${trial}`;
        rows.push({
          slot_id, experiment, condition, state: 'completed', run_id: `run-${slot_id}`, cost_usd: 0.0004,
          eligibility: { eligible: true, provenance: 'verified', sources: ['generation'], reasons: [] },
          fingerprint_ok: true, counted: true, detected: null, finding_titles: [], matched: [], execution_issues: [],
        });
        runs[slot_id] = {
          run_id: `run-${slot_id}`, cost_usd: 0.0004, experiment: {}, config: null, skills_block: null,
          findings: [{ file: 'src/x.ts', start_line: 1, end_line: 2, title: `Synthetic finding ${trial}`, rationale: 'synthetic' }],
        };
      }
    }
  }
  const design = { manifest_fingerprint: 'synthetic-manifest', experiments: ['17', '18'], per_condition: 5, slots: rows.map((r) => ({ slot_id: r.slot_id, experiment: r.experiment, condition: r.condition })) };
  return { design, rows, runs, skill_names: ['test-quality', 'breaking-change'] };
}

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'hw2-adj-'));
  const dir = join(base, 'record');
  const inputFile = join(base, 'input.json');
  writeFileSync(inputFile, JSON.stringify(input()));
  const logs: string[] = [];
  let tick = 0;
  const run = (...argv: string[]) => main([...argv, '--dir', dir], () => new Date(Date.UTC(2026, 9, 30, 12, 0, tick++)), (l) => logs.push(l));
  return { base, dir, inputFile, run, logs };
}

const packetOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'packet.json'), 'utf8')) as BlindPacket;
const mappingOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'private', 'mapping.json'), 'utf8')) as CaseMapping;

/** Writes a judgment file; `answer` sees only the case ID, as an adjudicator would. */
function judgmentFile(base: string, dir: string, adjudicator: string, answer: (caseId: string) => Verdict): string {
  const packet = packetOf(dir);
  const digests = JSON.parse(readFileSync(join(dir, 'digests.json'), 'utf8'));
  const judgment: Judgment = {
    adjudicator,
    packet_sha256: digests.packet_sha256,
    verdicts: packet.cases.map((c) => {
      const detected = answer(c.case_id);
      return { case_id: c.case_id, detected, finding_refs: detected === 'yes' ? ['f1'] : [], reason: 'applied the frozen rule' };
    }),
  };
  const file = join(base, `${adjudicator}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(judgment));
  return file;
}

describe('HW2 adjudication CLI', () => {
  it('prepare writes a blind packet, a private mapping and published digests, and never prepares twice', async () => {
    const { dir, inputFile, run } = setup();
    await run('prepare', '--input', inputFile);
    const packet = packetOf(dir);
    expect(packet.cases).toHaveLength(20);
    expect(Object.keys(packet.rules).sort()).toEqual(['17', '18']);
    expect(packet.ground_truth['17']).toContain('now == expiresAt');
    const text = JSON.stringify(packet);
    for (const leak of ['"with"', 'without', 'c-17-', 'run-', '0.0004', 'condition']) expect(text).not.toContain(leak);
    expect(statSync(join(dir, 'private', 'mapping.json')).mode & 0o777).toBe(0o600);
    expect(verifyRecord(dir)).toEqual([]);
    await expect(run('prepare', '--input', inputFile)).rejects.toThrow(/not empty/);
  });

  it('runs the full prepare → register A and B → reveal cycle and writes an auditable report', async () => {
    const { base, dir, inputFile, run } = setup();
    await run('prepare', '--input', inputFile);
    const condition = (id: string) => mappingOf(dir).entries.find((e) => e.case_id === id)!.condition;
    const scripted = (id: string): Verdict => (condition(id) === 'with' ? 'yes' : 'no');
    await run('register', '--judgment', judgmentFile(base, dir, 'Technical-Reviewer-A', scripted));
    // Sealed judgments stay private until the reveal: the second adjudicator cannot read the first.
    expect(existsSync(join(dir, 'judgments'))).toBe(false);
    expect(statSync(join(dir, 'private', 'judgments', 'Technical-Reviewer-A.json')).mode & 0o777).toBe(0o600);
    await run('register', '--judgment', judgmentFile(base, dir, 'Technical-Reviewer-B', scripted));
    expect(existsSync(join(dir, 'mapping.json'))).toBe(false);
    await run('reveal');
    expect(existsSync(join(dir, 'judgments', 'Technical-Reviewer-A.json'))).toBe(true);
    expect(existsSync(join(dir, 'mapping.json'))).toBe(true);
    const report = readFileSync(join(dir, 'report.md'), 'utf8');
    expect(report).toContain('| 17 | 5 / 5 (0) | 0 / 5 (0) | success |');
    expect(report).toContain('| 18 | 5 / 5 (0) | 0 / 5 (0) | success |');
    const events = readFileSync(join(dir, 'seals.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(['digests', 'register', 'register', 'reveal']);
    await expect(run('reveal')).rejects.toThrow(/already revealed/);
    await expect(run('register', '--judgment', judgmentFile(base, dir, 'C', scripted))).rejects.toThrow(/already revealed/);
  });

  it('refuses a duplicate, a third, an incomplete or a misnamed judgment, and an early reveal', async () => {
    const { base, dir, inputFile, run } = setup();
    await run('prepare', '--input', inputFile);
    const yes = () => 'yes' as Verdict;
    await expect(run('reveal')).rejects.toThrow(/two sealed judgments/);
    await run('register', '--judgment', judgmentFile(base, dir, 'A', yes));
    await expect(run('register', '--judgment', judgmentFile(base, dir, 'A', yes))).rejects.toThrow(/already registered/);
    await expect(run('reveal')).rejects.toThrow(/two sealed judgments/);
    const partial = judgmentFile(base, dir, 'B', yes);
    const j = JSON.parse(readFileSync(partial, 'utf8')) as Judgment;
    j.verdicts.pop();
    writeFileSync(partial, JSON.stringify(j));
    await expect(run('register', '--judgment', partial)).rejects.toThrow(/did not judge/);
    await expect(run('register', '--judgment', judgmentFile(base, dir, '../escape', yes))).rejects.toThrow(/adjudicator must be/);
    await expect(run('register', '--judgment', judgmentFile(base, dir, 'reconciliation', yes))).rejects.toThrow(/reserved/);
    await run('register', '--judgment', judgmentFile(base, dir, 'B', yes));
    await expect(run('register', '--judgment', judgmentFile(base, dir, 'C', yes))).rejects.toThrow(/already registered/);
  });

  it('detects a judgment, packet or mapping changed after sealing, and a planted unregistered judgment', async () => {
    const { base, dir, inputFile, run } = setup();
    await run('prepare', '--input', inputFile);
    const yes = () => 'yes' as Verdict;
    await run('register', '--judgment', judgmentFile(base, dir, 'A', yes));
    await run('register', '--judgment', judgmentFile(base, dir, 'B', yes));

    const bFile = join(dir, 'private', 'judgments', 'B.json');
    const original = readFileSync(bFile, 'utf8');
    const edited = JSON.parse(original) as Judgment;
    edited.verdicts[0]!.detected = 'no';
    edited.verdicts[0]!.finding_refs = [];
    writeFileSync(bFile, JSON.stringify(edited));
    expect(verifyRecord(dir)).toContain('judgment of B does not match its seal');
    await expect(run('reveal')).rejects.toThrow(/does not match its seal/);
    writeFileSync(bFile, original);

    const mappingFile = join(dir, 'private', 'mapping.json');
    const mapping = readFileSync(mappingFile, 'utf8');
    writeFileSync(mappingFile, mapping.replace('"with"', '"without"'));
    await expect(run('reveal')).rejects.toThrow(/mapping.json does not match/);
    writeFileSync(mappingFile, mapping);

    const planted = { ...(JSON.parse(original) as Judgment), adjudicator: 'Z' };
    writeFileSync(join(dir, 'private', 'judgments', 'Z.json'), JSON.stringify(planted));
    expect(verifyRecord(dir)).toContain('judgment Z.json was never registered');
    expect(sealJudgment(planted)).toBeTruthy();
  });

  it('reconciles only disputed cases, before the reveal; unresolved disagreement stays incomplete', async () => {
    const { base, dir, inputFile, run, logs } = setup();
    await run('prepare', '--input', inputFile);
    const condition = (id: string) => mappingOf(dir).entries.find((e) => e.case_id === id)!.condition;
    const scripted = (id: string): Verdict => (condition(id) === 'with' ? 'yes' : 'no');
    const first = packetOf(dir).cases.find((c) => c.experiment === '17')!.case_id;
    await run('register', '--judgment', judgmentFile(base, dir, 'A', scripted));
    await run('register', '--judgment', judgmentFile(base, dir, 'B', (id) => (id === first ? 'ambiguous' : scripted(id))));
    await run('disputed');
    expect(logs.at(-1)).toBe(first);

    const other = packetOf(dir).cases.find((c) => c.case_id !== first)!.case_id;
    const reconciliation = (caseId: string) => {
      const file = join(base, `rec-${caseId}.json`);
      const digests = JSON.parse(readFileSync(join(dir, 'digests.json'), 'utf8'));
      writeFileSync(file, JSON.stringify({ adjudicator: 'reconciliation', packet_sha256: digests.packet_sha256, verdicts: [{ case_id: caseId, detected: 'ambiguous', finding_refs: [], reason: 'rule text cannot decide' }] }));
      return file;
    };
    await expect(run('reconcile', '--judgment', reconciliation(other))).rejects.toThrow(/not disputed/);
    await run('reconcile', '--judgment', reconciliation(first));
    await run('reveal');
    const report = readFileSync(join(dir, 'report.md'), 'utf8');
    expect(report).toMatch(/\| 17 \| .* \| incomplete/);
    expect(report).toContain('| 18 | 5 / 5 (0) | 0 / 5 (0) | success |');
  });

  it('refuses input whose rows are not the frozen schedule', async () => {
    const { base, dir, run } = setup();
    const bad = input();
    bad.rows.push({ ...bad.rows[0]!, slot_id: 'c-17-with-6' });
    const file = join(base, 'bad.json');
    writeFileSync(file, JSON.stringify(bad));
    await expect(run('prepare', '--input', file)).rejects.toThrow(/not scheduled/);
    expect(existsSync(join(dir, 'packet.json'))).toBe(false);
  });

  it('the rules and ground truth adjudicators receive are the frozen text in PROSPECTIVE-STUDY.md', () => {
    const doc = readFileSync(join(__dirname, '..', '..', 'docs', 'homework', 'L02', 'PROSPECTIVE-STUDY.md'), 'utf8');
    for (const text of [...Object.values(TECHNICAL_RULES), ...Object.values(FIXTURE_GROUND_TRUTH)]) expect(doc).toContain(text);
  });
});
