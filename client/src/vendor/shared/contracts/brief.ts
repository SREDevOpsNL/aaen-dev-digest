import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Intent Layer (L03) ----
// The classifier answers "why was this PR opened?" from bounded evidence. Its
// raw output is validated before anyone sees it: every cited line must be one
// the model was actually shown. Citations prove presence, not correctness.

/** A cited range in the sampled diff excerpts (`new` = head side, `old` = base side). */
export const IntentEvidenceRef = z.object({
  file: z.string(),
  side: z.enum(['new', 'old']),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type IntentEvidenceRef = z.infer<typeof IntentEvidenceRef>;

export const IntentConfidence = z.enum(['low', 'medium', 'high']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const IntentPoint = z.object({
  statement: z.string(),
  evidence: z.array(IntentEvidenceRef),
});
export type IntentPoint = z.infer<typeof IntentPoint>;

export const IntentDiscrepancy = z.object({
  kind: z.enum(['unsupported_claim', 'undeclared_change']),
  statement: z.string(),
  evidence: z.array(IntentEvidenceRef),
});
export type IntentDiscrepancy = z.infer<typeof IntentDiscrepancy>;

/** What the classifier model returns (structured output). */
export const IntentAnalysisRaw = z.object({
  /** What the author claims (title, description, linked issue); empty when nothing is claimed. */
  claimed_purpose: z.string(),
  /** What the evidence supports, each point with citations into the sampled excerpts. */
  supported_points: z.array(IntentPoint),
  discrepancies: z.array(IntentDiscrepancy),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence,
});
export type IntentAnalysisRaw = z.infer<typeof IntentAnalysisRaw>;

export const UnverifiedStatement = z.object({
  statement: z.string(),
  origin: z.enum(['supported_point', 'discrepancy']),
  reason: z.enum(['no_citation', 'file_not_sampled', 'lines_not_sampled', 'invalid_range']),
});
export type UnverifiedStatement = z.infer<typeof UnverifiedStatement>;

/** Validated analysis — what reviewers, traces and the UI receive. Never filled by the model. */
export const IntentAnalysis = IntentAnalysisRaw.extend({
  unverified_statements: z.array(UnverifiedStatement),
});
export type IntentAnalysis = z.infer<typeof IntentAnalysis>;

/** Size of the evidence the classifier saw, for display and the trace. */
export const IntentEvidenceStats = z.object({
  files_listed: z.number().int(),
  files_excerpted: z.number().int(),
  truncated: z.boolean(),
  invalid_citations: z.number().int(),
});
export type IntentEvidenceStats = z.infer<typeof IntentEvidenceStats>;

export const IntentStaleReason = z.enum(['head_changed', 'context_changed', 'prompt_changed', 'legacy']);
export type IntentStaleReason = z.infer<typeof IntentStaleReason>;

/**
 * `GET /pulls/:id/intent` — the PR-level cached intent. `missing` means nothing
 * has been generated yet; `failed` / `skipped_no_key` only appear when no valid
 * analysis exists (a failed recompute keeps the previous analysis and reports
 * `last_error` instead).
 */
export const PrIntentView = z.object({
  pr_id: z.string(),
  state: z.enum(['missing', 'ready', 'failed', 'skipped_no_key']),
  stale: z.boolean(),
  stale_reasons: z.array(IntentStaleReason),
  analysis: IntentAnalysis.nullable(),
  head_sha: z.string().nullable(),
  current_head_sha: z.string(),
  linked_issue: z.object({ number: z.number().int(), title: z.string() }).nullable(),
  evidence: IntentEvidenceStats.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  derived_at: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** Provider-reported cost of the derivation shown; null when unknown, 0 when reported as zero. */
  provider_cost_usd: z.number().nonnegative().nullable(),
  last_error: z.string().nullable(),
  last_attempt_at: z.string().nullable(),
});
export type PrIntentView = z.infer<typeof PrIntentView>;

/**
 * The exact intent a review run used, copied into its immutable trace. A later
 * Recompute changes the PR cache, never this snapshot. Classifier cost here is
 * shared pre-work for the batch (`attribution: 'shared'`): it is not part of
 * the run's own cost, and aggregators must dedupe by `derivation_id`.
 */
export const IntentRunSnapshot = z.object({
  /** `cache` = reused, `derived` = generated for this batch, `none` = reviewed without intent. */
  source: z.enum(['cache', 'derived', 'none']),
  status: z.enum(['used', 'skipped_no_key', 'failed', 'not_started']),
  derivation_id: z.string().nullable(),
  head_sha: z.string().nullable(),
  prompt_version: z.number().int().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  derived_at: z.string().nullable(),
  analysis: IntentAnalysis.nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  provider_cost_usd: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
  attribution: z.literal('shared'),
});
export type IntentRunSnapshot = z.infer<typeof IntentRunSnapshot>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
