import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  digest,
  preparePacket,
  reveal,
  sealJudgment,
  type BlindPacket,
  type Judgment,
  type Verdict,
} from '../src/experiments/hw2/adjudication.js';
import type { SlotRow, SlotRunData } from '../src/experiments/hw2/report.js';

// Synthetic slots only: no Phase 1 case is rescored.
const finding = (title: string, rationale = 'synthetic rationale') => ({ file: 'src/billing/discount.ts', start_line: 3, end_line: 9, title, rationale });

function slot(slotId: string, condition: 'with' | 'without', counted = true): { row: SlotRow; run: SlotRunData | null } {
  const row: SlotRow = {
    slot_id: slotId,
    experiment: '17',
    condition,
    state: counted ? 'completed' : 'failed',
    run_id: counted ? `run-${slotId}` : null,
    cost_usd: null,
    eligibility: counted ? { eligible: true, provenance: 'verified', sources: ['generation'], reasons: [] } : null,
    fingerprint_ok: counted,
    counted,
    detected: null,
    finding_titles: [],
    matched: [],
    execution_issues: [],
  };
  const run: SlotRunData | null = counted
    ? { run_id: `run-${slotId}`, cost_usd: 0.0005, experiment: {}, config: null, skills_block: condition === 'with' ? 'secret' : null, findings: [finding(`Finding of ${slotId.length}`)] }
    : null;
  return { row, run };
}

function schedule(uncounted: string[] = []) {
  const slots = [1, 2, 3, 4, 5].flatMap((i) => [slot(`c-17-with-${i}`, 'with', !uncounted.includes(`c-17-with-${i}`)), slot(`c-17-without-${i}`, 'without', !uncounted.includes(`c-17-without-${i}`))]);
  let n = 0;
  return preparePacket({
    rows: slots.map((s) => s.row),
    runs: new Map(slots.map((s) => [s.row.slot_id, s.run])),
    rules: { '17': 'error branch AND now == expiresAt boundary' },
    skillNames: ['test-quality'],
    newCaseId: () => `case-${String(97 - n++).padStart(3, '0')}`,
  });
}

function judge(packet: BlindPacket, packetSha: string, adjudicator: string, verdictFor: (caseId: string) => Verdict): { judgment: Judgment; seal: string } {
  const judgment: Judgment = {
    adjudicator,
    packet_sha256: packetSha,
    verdicts: packet.cases.map((c) => {
      const detected = verdictFor(c.case_id);
      return { case_id: c.case_id, detected, finding_refs: detected === 'yes' ? ['f1'] : [], reason: 'applied the frozen rule' };
    }),
  };
  return { judgment, seal: sealJudgment(judgment) };
}

describe('HW2 sealed condition-blinded adjudication', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(digest({ b: 1, a: 2 })).toBe(digest({ a: 2, b: 1 }));
  });

  it('the packet carries no condition, slot, run, Skill block or cost, and is not in schedule order', () => {
    const { packet, mapping } = schedule();
    const text = JSON.stringify(packet);
    for (const leak of ['with', 'without', 'c-17-', 'run-', 'secret', '0.0005', 'skills_block', 'condition']) expect(text).not.toContain(leak);
    expect(packet.cases.map((c) => c.case_id)).toEqual([...packet.cases.map((c) => c.case_id)].sort());
    expect(mapping.entries.filter((e) => e.case_id).map((e) => e.case_id)).not.toEqual(packet.cases.map((c) => c.case_id));
  });

  it('a full prepare → seal → reveal dry run reaches the preregistered threshold only from sealed verdicts', () => {
    const { packet, packet_sha256, mapping, mapping_sha256 } = schedule();
    const conditionOf = (id: string) => mapping.entries.find((e) => e.case_id === id)!.condition;
    // Adjudicators never see the mapping; the test uses it only to script a known answer.
    const answer = (id: string): Verdict => (conditionOf(id) === 'with' ? 'yes' : 'no');
    const result = reveal({ packet, packet_sha256, mapping, mapping_sha256, judgments: [judge(packet, packet_sha256, 'A', answer), judge(packet, packet_sha256, 'B', answer)] });
    expect(result.status).toBe('revealed');
    if (result.status !== 'revealed') return;
    expect(result.experiments[0]).toMatchObject({ outcome: 'success', with: { scheduled: 5, detected: 5 }, without: { scheduled: 5, detected: 0 } });
    expect(result.blinding_compromised).toBe(false);
  });

  it('refuses a packet, mapping or judgment altered after its digest was published', () => {
    const base = schedule();
    const yes = () => 'yes' as Verdict;
    const judgments = [judge(base.packet, base.packet_sha256, 'A', yes), judge(base.packet, base.packet_sha256, 'B', yes)];
    const editedPacket = structuredClone(base.packet);
    editedPacket.cases[0]!.findings[0]!.title = 'edited';
    expect(reveal({ ...base, packet: editedPacket, judgments })).toMatchObject({ status: 'invalid' });
    const editedMapping = structuredClone(base.mapping);
    editedMapping.entries[0]!.condition = 'without';
    expect(reveal({ ...base, mapping: editedMapping, judgments })).toMatchObject({ status: 'invalid' });
    const changed = structuredClone(judgments);
    changed[1]!.judgment.verdicts[0]!.detected = 'no';
    const result = reveal({ ...base, judgments: changed });
    expect(result.status === 'invalid' && result.errors.some((e) => e.includes("B's judgment does not match its seal"))).toBe(true);
  });

  it('requires two distinct adjudicators, every case judged, and a cited finding for yes', () => {
    const base = schedule();
    const yes = () => 'yes' as Verdict;
    expect(reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', yes)] })).toMatchObject({ status: 'invalid' });
    expect(reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', yes), judge(base.packet, base.packet_sha256, 'A', yes)] })).toMatchObject({ status: 'invalid' });
    const partial = judge(base.packet, base.packet_sha256, 'B', yes);
    partial.judgment.verdicts.pop();
    partial.seal = sealJudgment(partial.judgment);
    expect(reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', yes), partial] })).toMatchObject({ status: 'invalid' });
    const uncited = judge(base.packet, base.packet_sha256, 'B', yes);
    uncited.judgment.verdicts[0]!.finding_refs = [];
    uncited.seal = sealJudgment(uncited.judgment);
    expect(reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', yes), uncited] })).toMatchObject({ status: 'invalid' });
  });

  it('keeps an unresolved disagreement ambiguous and the outcome incomplete; a sealed reconciliation may settle only disputed cases', () => {
    const base = schedule();
    const conditionOf = (id: string) => base.mapping.entries.find((e) => e.case_id === id)!.condition;
    const disputedId = base.packet.cases[0]!.case_id;
    const a = judge(base.packet, base.packet_sha256, 'A', (id) => (conditionOf(id) === 'with' ? 'yes' : 'no'));
    const b = judge(base.packet, base.packet_sha256, 'B', (id) => (id === disputedId ? (conditionOf(id) === 'with' ? 'no' : 'yes') : conditionOf(id) === 'with' ? 'yes' : 'no'));
    const unresolved = reveal({ ...base, judgments: [a, b] });
    expect(unresolved.status === 'revealed' && unresolved.experiments[0]!.outcome).toBe('incomplete');

    const settle = (caseId: string): { judgment: Judgment; seal: string } => {
      const judgment: Judgment = { adjudicator: 'reconciliation', packet_sha256: base.packet_sha256, verdicts: [{ case_id: caseId, detected: 'no', finding_refs: [], reason: 'no exact boundary named' }] };
      return { judgment, seal: sealJudgment(judgment) };
    };
    const settled = reveal({ ...base, judgments: [a, b], reconciliation: settle(disputedId) });
    expect(settled.status).toBe('revealed');
    if (settled.status === 'revealed') expect(settled.cases.find((c) => c.case_id === disputedId)!.final).toBe('no');
    expect(reveal({ ...base, judgments: [a, b], reconciliation: settle(base.packet.cases[1]!.case_id) })).toMatchObject({ status: 'invalid' });
  });

  it('an uncounted scheduled slot is never replaced: the comparison is incomplete', () => {
    const base = schedule(['c-17-without-3']);
    expect(base.packet.cases).toHaveLength(9);
    expect(base.mapping.entries.find((e) => e.slot_id === 'c-17-without-3')).toMatchObject({ case_id: null, not_counted_reason: 'no run (failed)' });
    const conditionOf = (id: string) => base.mapping.entries.find((e) => e.case_id === id)!.condition;
    const answer = (id: string): Verdict => (conditionOf(id) === 'with' ? 'yes' : 'no');
    const result = reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', answer), judge(base.packet, base.packet_sha256, 'B', answer)] });
    expect(result.status === 'revealed' && result.experiments[0]).toMatchObject({ outcome: 'incomplete', without: { scheduled: 5, adjudicated: 4 } });
  });

  it('five surviving slots do not stand in for a larger schedule with a gap', () => {
    const slots = [1, 2, 3, 4, 5, 6].flatMap((i) => [slot(`c-17-with-${i}`, 'with'), slot(`c-17-without-${i}`, 'without', i !== 6)]);
    const base = preparePacket({ rows: slots.map((s) => s.row), runs: new Map(slots.map((s) => [s.row.slot_id, s.run])), rules: {}, skillNames: [] });
    const conditionOf = (id: string) => base.mapping.entries.find((e) => e.case_id === id)!.condition;
    const answer = (id: string): Verdict => (conditionOf(id) === 'with' ? 'yes' : 'no');
    const result = reveal({ ...base, judgments: [judge(base.packet, base.packet_sha256, 'A', answer), judge(base.packet, base.packet_sha256, 'B', answer)] });
    expect(result.status === 'revealed' && result.experiments[0]).toMatchObject({ outcome: 'incomplete', without: { scheduled: 6, adjudicated: 5 } });
  });

  it('records finding wording that may reveal the condition as compromised blinding', () => {
    const slots = [slot('c-17-with-1', 'with')];
    slots[0]!.run!.findings = [finding('Per the test-quality guidance, the expiry boundary is untested')];
    const { mapping } = preparePacket({ rows: slots.map((s) => s.row), runs: new Map(slots.map((s) => [s.row.slot_id, s.run])), rules: {}, skillNames: ['test-quality'] });
    expect(mapping.blinding_warnings).toEqual([expect.objectContaining({ ref: 'f1', term: 'test-quality' })]);
  });
});
