import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, verifyRecord, type AdjudicationInput } from '../src/experiments/hw2/adjudication-cli.js';
import {
  REDACTION_INSTRUCTION_R1,
  REDACTION_TERMS_R1,
  REDACTION_TERMS_R1_SHA256,
  REDACTION_TOKEN,
  TECHNICAL_RULES,
  digest,
  preparePacket,
  preparePacketV2,
  redactFinding,
  redactText,
  reveal,
  sealJudgment,
  type BlindPacket,
  type CaseMapping,
  type Judgment,
  type Verdict,
} from '../src/experiments/hw2/adjudication.js';
import { STUDY_V4 } from '../src/experiments/hw2/manifest.js';
import { imputedVerdict, type SlotRow, type SlotRunData } from '../src/experiments/hw2/report.js';
import type { ExpectedRule } from '../src/experiments/hw2/rules.js';

// Synthetic slots only: no v3 case is rescored, nothing is dispatched.
const SCREEN: Record<string, ExpectedRule> = { '17': { anchors: [{ file: 'src/billing/discount.test.ts', start_line: 1, end_line: 9 }], keywords: ['expired', 'boundary'] } };
type F = { file: string; start_line: number; end_line: number; title: string; rationale: string };
const f = (title: string, rationale = 'synthetic rationale'): F => ({ file: 'src/billing/discount.test.ts', start_line: 3, end_line: 6, title, rationale });

function slot(slot_id: string, condition: 'with' | 'without', findings: F[] | 'truncated'): { row: SlotRow; run: SlotRunData | null } {
  const truncated = findings === 'truncated';
  const row: SlotRow = {
    slot_id, experiment: '17', condition, state: truncated ? 'failed' : 'completed', run_id: `run-${slot_id}`, cost_usd: 0.0004,
    eligibility: { eligible: !truncated, provenance: 'verified', sources: ['generation'], reasons: truncated ? ['dispatch_state failed', 'attempt outcome truncated'] : [] },
    fingerprint_ok: true, counted: !truncated, detected: null, finding_titles: [], matched: [], execution_issues: [], prompt_issues: [],
    imputed: truncated ? imputedVerdict(condition) : null,
  };
  const run: SlotRunData = { run_id: `run-${slot_id}`, cost_usd: 0.0004, experiment: {}, config: null, skills_block: condition === 'with' ? 'secret skill block' : null, findings: truncated ? [] : findings };
  return { row, run };
}

/** Ten v4 slots; `findingsOf` gives each one's findings (or 'truncated'). */
function study(findingsOf: (condition: 'with' | 'without', trial: number) => F[] | 'truncated') {
  const slots = [1, 2, 3, 4, 5].flatMap((i) => [slot(`c-v4-17-with-${i}`, 'with', findingsOf('with', i)), slot(`c-v4-17-without-${i}`, 'without', findingsOf('without', i))]);
  const rows = slots.map((s) => s.row);
  return {
    rows,
    runs: new Map(slots.map((s) => [s.row.slot_id, s.run])),
    design: { manifest_fingerprint: 'synthetic-v4', experiments: ['17'], per_condition: 5, slots: rows.map((r) => ({ slot_id: r.slot_id, experiment: r.experiment, condition: r.condition })) },
  };
}

const prepare = (s: ReturnType<typeof study>, ids = true) => {
  let n = 0;
  return preparePacketV2({
    design: s.design, rows: s.rows, runs: s.runs, rules: { '17': TECHNICAL_RULES['17']! }, screenRules: SCREEN, skillNames: ['Edge Cases and Error Paths'],
    ...(ids ? { newCaseId: () => `case-${String(90 - n++).padStart(3, '0')}` } : {}),
  });
};

function judge(packet: BlindPacket, sha: string, adjudicator: string, verdictFor: (caseId: string) => Verdict) {
  const judgment: Judgment = {
    adjudicator, packet_sha256: sha,
    verdicts: packet.cases.map((c) => {
      const detected = verdictFor(c.case_id);
      return { case_id: c.case_id, detected, finding_refs: detected === 'yes' ? ['f1'] : [], reason: 'applied the frozen rule' };
    }),
  };
  return { judgment, seal: sealJudgment(judgment) };
}

describe('redaction r1: term matching', () => {
  it('replaces each term case-insensitively, as whole words, with plural and possessive inflections, longest first', () => {
    expect(redactText('Per the Edge Cases and Error Paths skill, test it')).toEqual({ text: `Per the ${REDACTION_TOKEN} ${REDACTION_TOKEN}, test it`, redactions: 2 });
    expect(redactText("SKILLS, the skill's rule, the skills' rules, with-skill, Without-Skill, untrusted  source").text)
      .toBe(`${REDACTION_TOKEN}, the ${REDACTION_TOKEN} rule, the ${REDACTION_TOKEN} rules, ${REDACTION_TOKEN}, ${REDACTION_TOKEN}, ${REDACTION_TOKEN}`);
    expect(redactText('a breaking-change Skill').text).toBe(`a ${REDACTION_TOKEN} ${REDACTION_TOKEN}`);
    // Longest first: the whole Skill name is one replacement, not a partial one.
    expect(redactText('edge cases and error paths').redactions).toBe(1);
  });

  it('leaves generic wording and words that only contain a term', () => {
    for (const text of ['error path and boundary', 'a breaking change', 'edge cases', 'skillful reviewers', 'deskilled']) expect(redactText(text)).toEqual({ text, redactions: 0 });
  });

  it('counts replacements in title and rationale together', () => {
    expect(redactFinding(f('skill one', 'skill two, skills three'))).toMatchObject({ title: `${REDACTION_TOKEN} one`, rationale: `${REDACTION_TOKEN} two, ${REDACTION_TOKEN} three`, redactions: 3 });
  });

  it('the term list is the leak terms plus every target Skill name, with a stable digest', () => {
    expect(REDACTION_TERMS_R1).toEqual(['edge cases and error paths', 'untrusted source', 'breaking-change', 'without-skill', 'with-skill', 'skill']);
    expect(REDACTION_TERMS_R1_SHA256).toBe('4e07a112cf6092631d32fa12519720c62987df9a12a7e46998ce6edd162297bc');
  });
});

describe('packet version 2 (redaction r1)', () => {
  it('redacts every case in both arms alike; the originals and the term list stay out of the packet', () => {
    const s = study((condition, i) => [f(`The skill says: expired coupon untested (${condition === 'with' ? 'a' : 'b'}${i})`)]);
    const { packet, mapping, originals } = prepare(s);
    expect(packet).toMatchObject({ version: 2, redaction: { method: 'r1', token: REDACTION_TOKEN, terms_sha256: REDACTION_TERMS_R1_SHA256 }, instructions: REDACTION_INSTRUCTION_R1 });
    expect(packet.cases).toHaveLength(10);
    expect(packet.cases.every((c) => c.findings[0]!.title.startsWith(`The ${REDACTION_TOKEN} says`))).toBe(true);
    const text = JSON.stringify(packet);
    for (const leak of ['skill', 'Skill', 'c-v4-', 'run-', 'secret', '"with"', 'without', 'edge cases and error paths']) expect(text).not.toContain(leak);
    // The frozen instruction names "a condition"; no case does.
    expect(JSON.stringify(packet.cases)).not.toContain('condition');
    expect(mapping.entries.every((e) => e.redactions === 1)).toBe(true);
    expect(originals.cases.every((c) => c.findings[0]!.title.startsWith('The skill says'))).toBe(true);
    expect(mapping.blinding_warnings).toHaveLength(10);
  });

  it('records the three residual-compromise reasons, per case', () => {
    const s = study((condition, i) => {
      if (condition === 'with' && i === 1) return [f('A skill-based check', 'nothing else')]; // marker only
      if (condition === 'with' && i === 2) return [f('Skillful advice from untrusted-source text')]; // term survives
      if (condition === 'without' && i === 1) return [f('Untested', 'the expired skill path')]; // marker, no screen change
      if (condition === 'without' && i === 2) return [f('Boundary', 'see breaking-change')]; // marker
      return [f('Plain finding', 'nothing')];
    });
    // A synthetic screen keyword that only the redacted wording carries, so redaction changes the screen.
    let n = 0;
    const { mapping } = preparePacketV2({
      design: s.design, rows: s.rows, runs: s.runs, rules: {}, skillNames: [], newCaseId: () => `case-${n++}`,
      screenRules: { '17': { anchors: SCREEN['17']!.anchors, keywords: ['breaking-change'] } },
    });
    const caseOf = (id: string) => mapping.entries.find((e) => e.slot_id === id)!.case_id!;
    const reasons = (id: string) => mapping.residual!.filter((r) => r.case_id === caseOf(id)).map((r) => r.reason);
    expect(reasons('c-v4-17-with-1')).toEqual(['marker-present']);
    expect(reasons('c-v4-17-with-2')).toEqual(['term-survived']);
    expect(mapping.residual!.find((r) => r.case_id === caseOf('c-v4-17-with-2'))).toMatchObject({ ref: 'f1', term: 'skill' });
    expect(reasons('c-v4-17-without-1')).toEqual(['marker-present']);
    expect(reasons('c-v4-17-without-2')).toEqual(['marker-present', 'evidence-changed']);
    expect(reasons('c-v4-17-with-3')).toEqual([]);
  });

  it('digests are stable: the same input gives the same packet, originals and per-case digests', () => {
    const s = study((_c, i) => [f(`skill finding ${i}`)]);
    const a = prepare(s);
    const b = prepare(s);
    expect(b.packet_sha256).toBe(a.packet_sha256);
    expect(b.originals_sha256).toBe(a.originals_sha256);
    expect(a.originals_sha256).toBe(digest(a.originals));
    expect(b.mapping.entries.map((e) => e.original_findings_sha256)).toEqual(a.mapping.entries.map((e) => e.original_findings_sha256));
    expect(b.mapping_sha256).not.toBe(a.mapping_sha256); // the secret nonce
    expect(a.mapping.originals_sha256).toBe(a.originals_sha256);
    const changed = prepare(study((_c, i) => [f(`skills finding ${i}`)]));
    expect(changed.packet_sha256).toBe(a.packet_sha256); // the same redacted text…
    expect(changed.originals_sha256).not.toBe(a.originals_sha256); // …from different originals
  });

  it('keeps an imputed truncated slot out of the packet and refuses a non-conservative imputation', () => {
    const s = study((condition, i) => (i === 3 ? 'truncated' : [f(`finding ${condition}${i}`)]));
    const { packet, mapping } = prepare(s);
    expect(packet.cases).toHaveLength(8);
    expect(mapping.entries.filter((e) => e.imputed)).toEqual([
      expect.objectContaining({ slot_id: 'c-v4-17-with-3', case_id: null, not_counted_reason: 'imputed (truncated)', imputed: { verdict: 'no', label: 'imputed (truncated)' } }),
      expect.objectContaining({ slot_id: 'c-v4-17-without-3', case_id: null, imputed: { verdict: 'yes', label: 'imputed (truncated)' } }),
    ]);
    const bad = study((condition, i) => (i === 3 ? 'truncated' : [f(`finding ${condition}${i}`)]));
    bad.rows.find((r) => r.slot_id === 'c-v4-17-with-3')!.imputed = { verdict: 'yes', label: 'imputed (truncated)' };
    expect(() => prepare(bad)).toThrow(/an imputed with slot is "no"/);
  });

  it('packet version 1 (v3) refuses an imputed row, and is otherwise unchanged', () => {
    const s = study((condition, i) => (i === 3 ? 'truncated' : [f(`finding ${condition}${i}`)]));
    expect(() => preparePacket({ design: s.design, rows: s.rows, runs: s.runs, rules: {}, skillNames: [] })).toThrow(/needs packet version 2/);
    const plain = study((_c, i) => [f(`skill ${i}`)]);
    const v1 = preparePacket({ design: plain.design, rows: plain.rows.map(({ imputed: _i, ...r }) => r), runs: plain.runs, rules: {}, skillNames: [] });
    expect(v1.packet.version).toBe(1);
    expect(v1.packet.cases[0]!.findings[0]!.title).toMatch(/^skill /);
    expect(Object.keys(v1.packet).sort()).toEqual(['cases', 'ground_truth', 'rules', 'version']);
    expect(Object.keys(v1.mapping).sort()).toEqual(['blinding_warnings', 'design', 'entries', 'nonce', 'packet_sha256', 'version']);
  });

  it('refuses a Skill name redaction r1 does not cover, and a missing screening rule', () => {
    const s = study((_c, i) => [f(`x ${i}`)]);
    expect(() => preparePacketV2({ design: s.design, rows: s.rows, runs: s.runs, rules: {}, screenRules: SCREEN, skillNames: ['New Skill'] })).toThrow(/not covered by redaction r1/);
    expect(() => preparePacketV2({ design: s.design, rows: s.rows, runs: s.runs, rules: {}, screenRules: {}, skillNames: [] })).toThrow(/no frozen screening rule/);
  });
});

describe('v4 prepare → seal → reveal dry run (pure functions)', () => {
  const s = study((condition, i) => (i === 5 ? 'truncated' : [f(condition === 'with' ? `skill: expired and boundary ${i}` : `expired only ${i}`)]));
  const base = prepare(s, false);
  const conditionOf = (id: string) => base.mapping.entries.find((e) => e.case_id === id)!.condition;
  // Adjudicators never see the mapping; the test uses it only to script answers.
  const answer = (id: string): Verdict => (conditionOf(id) === 'with' ? 'yes' : 'no');

  it('counts imputed slots at their conservative verdict and reports the blinding summary', () => {
    const result = reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', answer), judge(base.packet, base.packet_sha256, 'B', answer)] });
    expect(result.status).toBe('revealed');
    if (result.status !== 'revealed') return;
    // 4 adjudicated yes + 1 imputed no; 4 adjudicated no + 1 imputed yes: still ≥ 4/5 and ≤ 1/5.
    expect(result.experiments[0]).toMatchObject({ outcome: 'success', with: { scheduled: 5, adjudicated: 5, detected: 4, imputed: 1 }, without: { scheduled: 5, adjudicated: 5, detected: 1, imputed: 1 } });
    expect(result.imputed).toEqual([
      { slot_id: 'c-v4-17-with-5', condition: 'with', experiment: '17', final: 'no', label: 'imputed (truncated)' },
      { slot_id: 'c-v4-17-without-5', condition: 'without', experiment: '17', final: 'yes', label: 'imputed (truncated)' },
    ]);
    expect(result.cases.every((c) => !c.slot_id.endsWith('-5'))).toBe(true);
    expect(result.blinding).toMatchObject({ method: 'r1', redacted_cases: 4, redactions: 4, warnings_original: 4 });
    expect(result.blinding!.residual.map((r) => r.reason)).toEqual(['marker-present', 'marker-present', 'marker-present', 'marker-present']);
    expect(result.blinding_compromised).toBe(true);
  });

  it('an imputation can never help a pass: one imputed without slot plus one adjudicated yes fails the rule', () => {
    const oneMore = (id: string): Verdict => (conditionOf(id) === 'with' || id === base.mapping.entries.find((e) => e.slot_id === 'c-v4-17-without-1')!.case_id ? 'yes' : 'no');
    const result = reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', oneMore), judge(base.packet, base.packet_sha256, 'B', oneMore)] });
    expect(result.status === 'revealed' && result.experiments[0]).toMatchObject({ outcome: 'inconclusive', without: { detected: 2 } });
  });

  it('refuses a mapping whose imputation was edited, even with a matching digest', () => {
    const mapping = structuredClone(base.mapping) as CaseMapping;
    mapping.entries.find((e) => e.imputed)!.imputed!.verdict = 'yes';
    const result = reveal({ ...base, mapping, mapping_sha256: digest(mapping), judgments: [judge(base.packet, base.packet_sha256, 'A', answer), judge(base.packet, base.packet_sha256, 'B', answer)] });
    expect(result.status === 'invalid' && result.errors.join('; ')).toMatch(/does not carry the conservative verdict/);
  });

  it('refuses a version 1 packet paired with a version 2 mapping', () => {
    const packet = { ...base.packet, version: 1 as const };
    const result = reveal({ ...base, packet, packet_sha256: digest(packet), judgments: [] });
    expect(result.status === 'invalid' && result.errors.join('; ')).toMatch(/versions differ/);
  });
});

describe('adjudication CLI with a version 4 input', () => {
  function setup(findingsOf: Parameters<typeof study>[0]) {
    const s = study(findingsOf);
    const input: AdjudicationInput = {
      design: s.design, rows: s.rows, runs: Object.fromEntries(s.runs), skill_names: ['Edge Cases and Error Paths'],
      manifest_version: 4, study: STUDY_V4, screen_rules: SCREEN,
    };
    const base = mkdtempSync(join(tmpdir(), 'hw2-v4-adj-'));
    const dir = join(base, 'record');
    const inputFile = join(base, 'input.json');
    writeFileSync(inputFile, JSON.stringify(input));
    let tick = 0;
    const logs: string[] = [];
    const run = (...argv: string[]) => main([...argv, '--dir', dir], () => new Date(Date.UTC(2026, 10, 1, 12, 0, tick++)), (l) => logs.push(l));
    return { base, dir, inputFile, run, logs };
  }
  const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
  const judgmentFile = (base: string, dir: string, adjudicator: string, answer: (id: string) => Verdict) => {
    const packet = read<BlindPacket>(join(dir, 'packet.json'));
    const sha = read<{ packet_sha256: string }>(join(dir, 'digests.json')).packet_sha256;
    const file = join(base, `${adjudicator}.json`);
    writeFileSync(file, JSON.stringify(judge(packet, sha, adjudicator, answer).judgment));
    return file;
  };

  it('prepare → register A and B → reveal: packet v2 for #17 only, private originals, imputed rows and the blinding summary in the report', async () => {
    const { base, dir, inputFile, run } = setup((condition, i) => (i === 2 ? 'truncated' : [f(condition === 'with' ? `Per the Edge Cases and Error Paths skill: expired ${i}` : `expired ${i}`)]));
    await run('prepare', '--input', inputFile);
    const packet = read<BlindPacket>(join(dir, 'packet.json'));
    expect(packet.version).toBe(2);
    expect(Object.keys(packet.rules)).toEqual(['17']);
    expect(Object.keys(packet.ground_truth)).toEqual(['17']);
    expect(packet.cases).toHaveLength(8);
    expect(JSON.stringify(packet)).not.toMatch(/skill|Edge Cases and Error Paths|c-v4-/i);
    expect(statSync(join(dir, 'private', 'originals.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'private', 'originals.json'), 'utf8')).toContain('Per the Edge Cases and Error Paths skill');
    expect(verifyRecord(dir)).toEqual([]);

    const mapping = () => read<CaseMapping>(join(dir, 'private', 'mapping.json'));
    const answer = (id: string): Verdict => (mapping().entries.find((e) => e.case_id === id)!.condition === 'with' ? 'yes' : 'no');
    await run('register', '--judgment', judgmentFile(base, dir, 'A', answer));
    await run('register', '--judgment', judgmentFile(base, dir, 'B', answer));
    await run('reveal');
    const report = readFileSync(join(dir, 'report.md'), 'utf8');
    expect(report).toContain('| 17 | 4 / 5 (0) | 1 / 5 (0) | success |');
    expect(report).toContain('| c-v4-17-with-2 | with | no, imputed (truncated) |');
    expect(report).toContain('| c-v4-17-without-2 | without | yes, imputed (truncated) |');
    expect(report).toMatch(/Redaction r1: 8 replacement\(s\) in 4 case\(s\); 8 warning\(s\) in the original text; 4 residual compromise\(s\)/);
    expect(report).toContain('Blinding compromised: yes');
    // The originals are never published, not even at the reveal.
    expect(existsSync(join(dir, 'originals.json'))).toBe(false);
    expect(existsSync(join(dir, 'mapping.json'))).toBe(true);
  });

  it('detects originals changed after the freeze', async () => {
    const { dir, inputFile, run } = setup((_c, i) => [f(`skill ${i}`)]);
    await run('prepare', '--input', inputFile);
    const file = join(dir, 'private', 'originals.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('skill 1', 'skill 9'));
    expect(verifyRecord(dir)).toContain('private/originals.json does not match the digest in the mapping');
  });

  it('refuses a version 4 input without screening rules, and an unknown version', async () => {
    const { base, dir, inputFile, run } = setup((_c, i) => [f(`x ${i}`)]);
    const input = read<AdjudicationInput>(inputFile);
    const noRules = join(base, 'no-rules.json');
    writeFileSync(noRules, JSON.stringify({ ...input, screen_rules: undefined }));
    await expect(run('prepare', '--input', noRules)).rejects.toThrow(/needs the frozen screen_rules/);
    // Version 5 exists since study v5: it is refused with a v4 study block; version 6 is unknown.
    const v5WithV4Study = join(base, 'v5.json');
    writeFileSync(v5WithV4Study, JSON.stringify({ ...input, manifest_version: 5 }));
    await expect(run('prepare', '--input', v5WithV4Study)).rejects.toThrow(/version 5 manifest must carry a known study block/);
    const unknown = join(base, 'v6.json');
    writeFileSync(unknown, JSON.stringify({ ...input, manifest_version: 6 }));
    await expect(run('prepare', '--input', unknown)).rejects.toThrow(/manifest version 6/);
    expect(existsSync(join(dir, 'packet.json'))).toBe(false);
  });
});

describe('frozen v4 text', () => {
  const doc = readFileSync(join(__dirname, '..', '..', 'docs', 'homework', 'L02', 'prereg', 'study-v4-frozen-text.md'), 'utf8');
  it('the adjudicator instruction, the term list, its digest and the study block are the text in study-v4-frozen-text.md', () => {
    expect(doc).toContain(REDACTION_INSTRUCTION_R1);
    expect(REDACTION_INSTRUCTION_R1).toMatch(/The token is not evidence of a condition/);
    expect(doc).toContain(JSON.stringify(REDACTION_TERMS_R1));
    expect(doc).toContain(REDACTION_TERMS_R1_SHA256);
    expect(doc).toContain(JSON.stringify(STUDY_V4));
  });
});
