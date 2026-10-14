import {
  IntentAnalysisRaw,
  type IntentAnalysis,
  type IntentEvidenceStats,
  type LLMProvider,
  type StructuredRequest,
  type UnifiedDiff,
} from '@devdigest/shared';
import { buildIntentEvidence, type ExtraFile, type IntentEvidenceLimits } from './evidence.js';
import { buildIntentMessages, INTENT_PROMPT_VERSION, type IntentClaims } from './prompt.js';
import { validateIntent } from './validate.js';

/**
 * Derive a PR's intent with one structured classifier call. NOT pure: it calls
 * the injected LLMProvider (like `reviewPullRequest`). Everything else — the
 * evidence pack, the prompt, and citation validation — is deterministic.
 */

/**
 * Output budget for the classifier. Reasoning models count reasoning tokens
 * against it: at 1,500, deepseek-v4-flash often stopped with
 * finish_reason=length and empty or truncated JSON. The prompt also asks for a
 * short answer, so this is headroom, not the expected size.
 */
export const DEFAULT_INTENT_MAX_TOKENS = 4_000;

/**
 * Low reasoning effort by default: with unlimited reasoning, deepseek-v4-flash
 * spent all 4,000 tokens reasoning and returned empty content in 3 of 3 calls;
 * with low effort it finished with valid output (about 1,900 tokens).
 */
export const DEFAULT_INTENT_REASONING = { effort: 'low' } as const;

export interface DeriveIntentInput extends IntentClaims {
  llm: LLMProvider;
  model: string;
  diff: UnifiedDiff;
  /** Files the PR reports that have no parsed hunks (listed, never excerpted). */
  extraFiles?: ExtraFile[];
  limits?: Partial<IntentEvidenceLimits>;
  sessionId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
  /** Reasoning control passed to providers that support it (default: low effort). */
  reasoning?: StructuredRequest<unknown>['reasoning'];
}

export interface DeriveIntentOutcome {
  analysis: IntentAnalysis;
  evidence: IntentEvidenceStats;
  promptVersion: number;
  /** The model the provider reports having used. */
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Provider-reported USD cost; null when not reported, 0 when reported as zero. */
  providerCostUsd: number | null;
  raw: string;
}

export async function deriveIntent(input: DeriveIntentInput): Promise<DeriveIntentOutcome> {
  const evidence = buildIntentEvidence(input.diff, {
    ...(input.extraFiles ? { extraFiles: input.extraFiles } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
  });
  const result = await input.llm.completeStructured({
    model: input.model,
    schema: IntentAnalysisRaw,
    schemaName: 'Intent',
    messages: buildIntentMessages(input, evidence),
    temperature: 0,
    maxTokens: input.maxTokens ?? DEFAULT_INTENT_MAX_TOKENS,
    reasoning: input.reasoning ?? DEFAULT_INTENT_REASONING,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  const { analysis, invalidCitations } = validateIntent(result.data, evidence.sampled);
  return {
    analysis,
    evidence: { ...evidence.stats, invalid_citations: invalidCitations.length },
    promptVersion: INTENT_PROMPT_VERSION,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    providerCostUsd: result.providerCostUsd,
    raw: result.raw,
  };
}
