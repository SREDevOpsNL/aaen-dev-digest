import { describe, expect, it } from 'vitest';
import type { PromptAssembly } from '@devdigest/shared';
import { RunTraceRecorder, STAGE_ASSEMBLY_MAX_BYTES, assemblyDigest, topLevelAssembly } from '../src/modules/reviews/trace-recorder.js';
import { promptEvidence, promptNotRecordedReason, skillsRecorded } from '../src/modules/_shared/trace-evidence.js';

const stage = (index: number, count: number) => ({ stage_id: `map-${index}`, kind: 'map' as const, index, count, label: `f${index}` });
const usage = { tokens_in: 1, tokens_out: 1, provider_cost_usd: null, cost_usd: null };

describe('RunTraceRecorder.traceStages (stored once, completeness reused)', () => {
  it('a later stage pointing at a stored copy that was cut reports assembly_complete: false', () => {
    const big: PromptAssembly = { system: 's', skills: '<untrusted source="skill-0">\nrule\n</untrusted>', user: 'x'.repeat(STAGE_ASSEMBLY_MAX_BYTES + 10) };
    const small: PromptAssembly = { system: 's', user: 'small' };
    const r = new RunTraceRecorder();
    for (const [i, a] of [big, small, big].entries()) {
      r.onStage({ type: 'prepared', stage: stage(i, 3), assembly: a });
      r.onStage({ type: 'completed', stage_id: `map-${i}`, usage, attempts: 1 });
    }
    const stages = r.traceStages(null);
    expect(stages.map((s) => [s.assembly !== undefined, s.assembly_complete])).toEqual([
      [true, false], // stored, cut
      [true, true],
      [false, false], // points at the cut copy: not complete
    ]);
    expect(stages[2]!.assembly_sha256).toBe(stages[0]!.assembly_sha256);
    expect(stages[0]!.stored_assembly_bytes).toBeLessThanOrEqual(STAGE_ASSEMBLY_MAX_BYTES);
    expect(stages[0]!.assembly_bytes).toBe(assemblyDigest(big).bytes);
  });

  it('a stage pointing at the top-level copy is complete only when the top-level copy is', () => {
    const a: PromptAssembly = { system: 's', user: 'y'.repeat(300 * 1024) };
    const r = new RunTraceRecorder();
    r.onStage({ type: 'prepared', stage: { stage_id: 'single-0', kind: 'single', index: 0, count: 1, label: 'all files' }, assembly: a });
    const top = topLevelAssembly(a);
    expect(top.complete).toBe(false);
    expect(r.traceStages(top)[0]).toMatchObject({ assembly_complete: false });
    expect(r.traceStages({ ...top, complete: true })[0]).toMatchObject({ assembly_complete: true });
  });
});

describe('promptEvidence with a cut prompt', () => {
  it('a cut top-level assembly is not proof of any section, the Skills included', () => {
    const trace = { prompt_assembly_source: 'dispatched_request', prompt_assembly_complete: false, prompt_assembly_scope: 'single_stage', tool_calls: [] };
    expect(promptEvidence(trace)).toBe('dispatched_request_incomplete');
    expect(skillsRecorded('dispatched_request_incomplete')).toBe(false);
    expect(promptNotRecordedReason('dispatched_request_incomplete')).toBe('prompt recorded only in part (cut at the trace size bound)');
    expect(promptEvidence({ ...trace, prompt_assembly_complete: true })).toBe('dispatched_request');
    expect(promptEvidence({ ...trace, prompt_assembly_complete: undefined })).toBe('dispatched_request');
  });
});
