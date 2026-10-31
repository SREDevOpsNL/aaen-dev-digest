import { z } from 'zod';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  /** Tokens of the whole Skills section of the system message as sent (heading,
      preamble and wrapped skill bodies), counted by the studio tokenizer;
      null/absent when no skill was attached or in traces written before it existed. */
  skills_tokens: z.number().int().nonnegative().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (repo-intel); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (repo-intel); null when absent. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  /** Authoritative provider-reported USD cost; absent in historical traces. */
  cost_usd: z.number().nonnegative().nullable().optional(),
  findings: z.number().int(),
  grounding: z.string(),
});
export type RunStats = z.infer<typeof RunStats>;

/**
 * HW2 controlled-experiment evidence for one run (absent for every ordinary
 * run). Written before dispatch (`dispatching`) and again at the end, so a
 * crash leaves the slot's state on record.
 */
export const ExperimentRunTrace = z.object({
  stack_id: z.string(),
  slot_id: z.string(),
  experiment: z.string(),
  condition: z.enum(['with', 'without']),
  /** The separately authorized spending phase this slot ran under. */
  phase: z.enum(['exploration', 'confirmatory']),
  manifest_fingerprint: z.string(),
  /** `refused` = stopped before any model request (zero cost). */
  dispatch_state: z.enum(['refused', 'dispatching', 'completed', 'failed']),
  refusal_reason: z.string().nullable(),
  /** sha256 of the exact diff text the review used, and the frozen fixture hash it must equal. */
  diff_sha256: z.string().nullable(),
  expected_diff_sha256: z.string(),
  /** sha256 of the request with the Skill slot replaced by a fixed sentinel. */
  non_skill_fingerprint: z.string().nullable(),
  /** sha256 of the Skill slot alone (the linked skill blocks, in order). */
  skill_fingerprint: z.string().nullable(),
  /** The frozen non-Skill fingerprint this slot had to match (required in the confirmatory phase). */
  expected_non_skill_fingerprint: z.string().nullable(),
  routing: z.object({ order: z.array(z.string()), only: z.array(z.string()), allow_fallbacks: z.literal(false) }),
  preflight: z
    .object({
      input_upper_bound: z.number().int(),
      output_cap: z.number().int(),
      price_input_per_token: z.number(),
      price_output_per_token: z.number(),
      request_fee_usd: z.number(),
      context_length: z.number().int().nullable(),
      max_completion_tokens: z.number().int().nullable(),
      worst_case_usd: z.number(),
      reservation_usd: z.number(),
      price_source: z.string(),
    })
    .nullable(),
  /** False when a dispatched request's usage or cost is not known: reserve its full worst case. */
  usage_known: z.boolean(),
  /** One record per attempt as the provider reported it (StructuredAttemptTelemetry). */
  attempts: z.array(z.record(z.string(), z.unknown())),
});
export type ExperimentRunTrace = z.infer<typeof ExperimentRunTrace>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  log: z.array(RunLogLine),
  /** HW2 experiment evidence; absent for ordinary runs. */
  experiment: ExperimentRunTrace.nullish(),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  findings_count: z.number().int().nullable(),
  severity_counts: z.object({ CRITICAL: z.number().int(), WARNING: z.number().int(), SUGGESTION: z.number().int() }).nullish(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
