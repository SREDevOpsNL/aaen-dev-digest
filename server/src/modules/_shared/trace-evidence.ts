/**
 * What a persisted run trace proves about the prompt it records, derived at
 * READ time only (a stored trace is never rewritten):
 *
 * - `dispatched_request`: written with lifecycle evidence; the assembly is
 *   what one request passed to the provider.
 * - `dispatched_request_incomplete`: written with lifecycle evidence, but the
 *   stored assembly was cut by the size bound (`prompt_assembly_complete:
 *   false`); it does not prove any section, the Skills section included.
 * - `dispatched_request_whole_diff`: a map-reduce success with lifecycle
 *   evidence; the top-level assembly is the whole-diff one, which no request
 *   sent as such, and the executed requests are in `stages[]`.
 * - `agent_config`: written with lifecycle evidence; nothing was dispatched,
 *   so it holds only the agent's system prompt.
 * - `unrecorded`: no evidence of the request survived (a reaped run).
 * - `legacy_single_pass`: an older single-pass success; its assembly came
 *   from the one call (recorded assembly).
 * - `legacy_map_reduce_whole_diff`: an older map-reduce success; its assembly
 *   is the whole-diff one, not evidence of any executed chunk.
 * - `legacy_failed_fallback`: an older failure trace; its assembly is the
 *   fallback (system prompt, no Skills, empty user message), so there is no
 *   dispatched-request evidence at all.
 */
export type PromptEvidence =
  | 'dispatched_request'
  | 'dispatched_request_whole_diff'
  | 'dispatched_request_incomplete'
  | 'agent_config'
  | 'unrecorded'
  | 'legacy_single_pass'
  | 'legacy_map_reduce_whole_diff'
  | 'legacy_failed_fallback';

interface TraceLike {
  prompt_assembly_source?: unknown;
  prompt_assembly_scope?: unknown;
  prompt_assembly_complete?: unknown;
  tool_calls?: unknown;
}

export function promptEvidence(trace: unknown): PromptEvidence {
  const t = (trace ?? {}) as TraceLike;
  const source = t.prompt_assembly_source;
  if (source === 'dispatched_request') {
    if (t.prompt_assembly_complete === false) return 'dispatched_request_incomplete';
    return t.prompt_assembly_scope === 'whole_diff' ? 'dispatched_request_whole_diff' : 'dispatched_request';
  }
  if (source === 'agent_config' || source === 'unrecorded') return source;
  // Legacy: only the success path ever wrote tool_calls (one per chunk, meta = mode).
  const calls = Array.isArray(t.tool_calls) ? (t.tool_calls as Array<{ meta?: unknown }>) : [];
  if (calls.length === 0) return 'legacy_failed_fallback';
  return calls.some((c) => c?.meta === 'map-reduce') ? 'legacy_map_reduce_whole_diff' : 'legacy_single_pass';
}

/** Whether the trace's Skills section can be read as what the model received. */
export function skillsRecorded(evidence: PromptEvidence): boolean {
  // The Skills section is in the system message, identical for every chunk,
  // so a whole-diff legacy assembly still shows the Skills that were sent.
  return (
    evidence === 'dispatched_request' ||
    evidence === 'dispatched_request_whole_diff' ||
    evidence === 'legacy_single_pass' ||
    evidence === 'legacy_map_reduce_whole_diff'
  );
}

/** Why a trace's prompt cannot be read as evidence, or null when it can. */
export function promptNotRecordedReason(evidence: PromptEvidence): string | null {
  switch (evidence) {
    case 'legacy_failed_fallback':
      return 'prompt not recorded (legacy failure trace)';
    case 'unrecorded':
      return 'prompt not recorded (the run was reaped before its trace was written)';
    case 'agent_config':
      return 'prompt not recorded (no request was dispatched)';
    case 'dispatched_request_incomplete':
      return 'prompt recorded only in part (cut at the trace size bound)';
    default:
      return null;
  }
}
