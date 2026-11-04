import type { RunTrace } from '@devdigest/shared';

/** The note the boot reaper records on a run whose process died mid-flight. */
export const REAPED_NOTE =
  'The server process stopped before this run wrote its terminal record; only what was persisted before then is kept.';
/** The note on a cancelled run that never got a trace (its process died after the cancel). */
export const REAPED_CANCELLED_NOTE =
  'The run was cancelled and its process stopped before it wrote a trace; nothing about its request was recorded.';

/** What the reaper knows from the agent_runs row (never more). */
export interface ReapedRunRow {
  agentName: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/**
 * The trace the boot reaper writes for an orphaned `running` run.
 *
 * - An existing (partial) trace is kept, not replaced: its log, experiment
 *   block and prompt stay; it gains `persistence: reaped`, and its prompt is
 *   relabelled `unrecorded` unless it already recorded the dispatched request.
 *   Its `dispatch` is dropped: whether a request went out after it was
 *   written is unknown.
 * - Stats come from the row's persisted tokens and cost. A checkpoint trace's
 *   zeros are never treated as measured usage: with no persisted tokens the
 *   usage is unknown (null).
 * - Without a trace, a minimal one is written with no prompt at all.
 */
export function reapedTrace(existing: unknown, row: ReapedRunRow, at: Date, note: string = REAPED_NOTE): RunTrace {
  const persistence = { state: 'reaped' as const, at: at.toISOString(), note };
  const measured = row.tokensIn !== null && row.tokensOut !== null;
  const stats = {
    // duration_ms is a required integer in the contract: an unknown duration is 0, flagged as not known.
    duration_ms: row.durationMs ?? 0,
    ...(row.durationMs === null ? { duration_known: false } : {}),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    findings: 0,
    grounding: '0/0 passed',
    usage_state: measured ? ('measured' as const) : ('unknown' as const),
  };
  if (existing && typeof existing === 'object' && 'prompt_assembly' in existing) {
    const { dispatch: _dropped, ...kept } = existing as RunTrace;
    // Usage the partial trace itself measured is kept when the row has none; never overwritten by nulls or zeros.
    const keptMeasured = !measured && kept.stats?.usage_state === 'measured';
    return {
      ...kept,
      stats: keptMeasured
        ? kept.stats
        : { ...kept.stats, ...stats, findings: kept.stats?.findings ?? 0, grounding: kept.stats?.grounding ?? '0/0 passed' },
      prompt_assembly_source: kept.prompt_assembly_source === 'dispatched_request' ? 'dispatched_request' : 'unrecorded',
      persistence,
    };
  }
  return {
    config: { agent: row.agentName ?? 'unknown agent', provider: row.provider, model: row.model ?? '', source: 'local' },
    stats,
    prompt_assembly: { system: '', skills: null, memory: null, specs: null, user: '' },
    prompt_assembly_source: 'unrecorded',
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: [],
    persistence,
  };
}
