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
  /** Callers-of-changed-symbols digest (T1.3); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (T3); null when absent. Enables per-slot token
      attribution in the run trace. */
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

/**
 * Whether a run's usage is known: `none` = nothing was dispatched (zero by
 * construction); `measured` = every dispatched request reported its tokens
 * (cost may still be null when the provider does not report it); `unknown` =
 * at least one dispatched request's usage was not reported.
 */
export const UsageState = z.enum(['none', 'measured', 'unknown']);
export type UsageState = z.infer<typeof UsageState>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  /** Null only when `usage_state` is `unknown` (never a fallback zero). */
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** Authoritative provider-reported USD cost; absent in historical traces. */
  cost_usd: z.number().nonnegative().nullable().optional(),
  findings: z.number().int(),
  grounding: z.string(),
  /** Absent in traces written before it existed. */
  usage_state: UsageState.optional(),
});
export type RunStats = z.infer<typeof RunStats>;

/** Tokens and USD cost as reported; null = not reported. */
export const TraceUsage = z.object({
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  /** Breakdown exactly as the response or generation record named it; null when absent, never derived. */
  detail: z
    .object({
      reasoning_tokens: z.number().nullish(),
      native_prompt_tokens: z.number().nullish(),
      native_completion_tokens: z.number().nullish(),
      normalized_prompt_tokens: z.number().nullish(),
      normalized_completion_tokens: z.number().nullish(),
    })
    .optional(),
});
export type TraceUsage = z.infer<typeof TraceUsage>;

/**
 * One provider attempt of a stage, as the adapter reported it. `phase` is the
 * furthest phase reached: `submitted` means only that the adapter handed the
 * request to its HTTP client, NOT that the provider received or processed it;
 * `response_received` means a response arrived (`response_id` when the
 * provider sent one); `usage_verified` means a generation or billing record
 * was found (`verified_usage`).
 */
export const TraceAttempt = z.object({
  attempt: z.number().int().positive(),
  retry: z.enum(['initial', 'structured_retry', 'transport_retry']),
  phase: z.enum(['submitted', 'response_received', 'usage_verified']),
  submitted_at: z.string(),
  response_id: z.string().nullable(),
  finish_reason: z.string().nullable(),
  http_status: z.number().int().nullable(),
  /** Null while it has not failed (a completed stage's last attempt succeeded). */
  failure: z.enum(['schema_invalid', 'truncated', 'http_error', 'network_error', 'timeout', 'cancelled']).nullable(),
  /** As the response reported it (counted once per attempt); null without a response. */
  usage: TraceUsage.nullable(),
  /** As the generation record reported it; null when none was found. */
  verified_usage: TraceUsage.nullable(),
});
export type TraceAttempt = z.infer<typeof TraceAttempt>;

/**
 * One provider request of a run (single pass: one; map-reduce: one per
 * chunk, in order). Each distinct assembly is stored once: in the top-level
 * `prompt_assembly` when its digest equals `prompt_assembly_sha256`, else in
 * `assembly` on the first stage with that digest. `assembly_complete` is
 * false when the stored copy was cut or omitted by the size bound; the byte
 * count and sha256 are always of the full assembly.
 */
export const TraceStage = z.object({
  stage_id: z.string(),
  kind: z.enum(['single', 'map', 'reduce']),
  index: z.number().int().nonnegative(),
  count: z.number().int().positive(),
  label: z.string(),
  state: z.enum(['prepared', 'completed', 'failed', 'cancelled']),
  assembly_sha256: z.string(),
  assembly_bytes: z.number().int().nonnegative(),
  assembly_complete: z.boolean(),
  stored_assembly_bytes: z.number().int().nonnegative().optional(),
  assembly: PromptAssembly.optional(),
  usage_state: UsageState,
  usage: TraceUsage,
  attempts: z.array(TraceAttempt),
});
export type TraceStage = z.infer<typeof TraceStage>;

/**
 * Whether the run reached a provider. `not_dispatched`: stopped before any
 * provider request (`refusal` says why). `dispatched`: at least one request
 * was handed to a provider adapter; see `stages[].attempts` for what the
 * provider acknowledged. `completed`: the run succeeded.
 */
export const TraceDispatch = z.object({
  state: z.enum(['not_dispatched', 'dispatched', 'completed']),
  refusal: z.object({ code: z.string(), reason: z.string() }).optional(),
});
export type TraceDispatch = z.infer<typeof TraceDispatch>;

/**
 * Where `prompt_assembly` comes from. `dispatched_request`: the assembly
 * passed to the provider (map-reduce: every section but `user` is shared by
 * all chunks; the per-chunk requests are in `stages[]`). `agent_config`: the
 * agent's system prompt only; nothing was sent. `unrecorded`: no evidence of
 * the request survived (e.g. the process died before the trace was written).
 */
export const PromptAssemblySource = z.enum(['dispatched_request', 'agent_config', 'unrecorded']);
export type PromptAssemblySource = z.infer<typeof PromptAssemblySource>;

/**
 * Output a provider returned that is not a usable review (cut at the output
 * cap, or schema-invalid). Evidence only: never parsed into findings, kept in
 * `run_traces` only, never logged or streamed.
 */
export const PartialOutput = z.object({
  kind: z.enum(['truncated', 'schema_invalid']),
  stage_id: z.string(),
  text: z.string(),
  provider_incomplete: z.literal(true),
  finish_reason: z.string().nullable(),
  response_id: z.string().nullable(),
  /** UTF-8 bytes of the full output. */
  total_bytes: z.number().int().nonnegative(),
  /** Present when `text` is a prefix cut at this many bytes. */
  truncated_at_bytes: z.number().int().nonnegative().optional(),
  /** sha256 of the full output. */
  sha256: z.string(),
});
export type PartialOutput = z.infer<typeof PartialOutput>;

/** Written by the boot reaper for a run whose process died before its terminal write. */
export const TracePersistence = z.object({
  state: z.literal('reaped'),
  at: z.string(),
  note: z.string(),
});
export type TracePersistence = z.infer<typeof TracePersistence>;

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
  // Lifecycle evidence. All optional: a trace without them was written before
  // they existed and is classified at read time, never rewritten.
  dispatch: TraceDispatch.optional(),
  prompt_assembly_source: PromptAssemblySource.optional(),
  /** sha256 of the top-level `prompt_assembly` (see `TraceStage`). */
  prompt_assembly_sha256: z.string().optional(),
  stages: z.array(TraceStage).optional(),
  partial_output: PartialOutput.nullish(),
  persistence: TracePersistence.optional(),
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
