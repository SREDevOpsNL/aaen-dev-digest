/**
 * @devdigest/reviewer-core — the review engine.
 *
 * Pure review logic shared by the server (local reviews in the studio) and the
 * agent-runner (CI). NO database, GitHub, or filesystem access; the only side
 * effect is an LLM call through an INJECTED LLMProvider (so it is mock-testable).
 *
 * Consumers wire it via a tsconfig path alias (`@devdigest/reviewer-core` →
 * `../reviewer-core/src`) and consume the TypeScript source directly (tsx in
 * dev, vitest in tests, @vercel/ncc bundle in the runner). The package itself
 * never emits JS — its `build` is a type-check.
 */

// Prompt assembly + prompt-injection hardening.
export {
  assemblePrompt,
  renderSkillsSection,
  wrapUntrusted,
  type PromptParts,
  type SkillsSection,
  type AssembledPrompt,
} from './prompt.js';

// Citation grounding — the mandatory mechanical gate for diff findings.
export { groundFindings, groundingSummary, type GroundingResult } from './grounding.js';

// Structured-output helpers (Zod → JSON Schema + parse-with-repair).
export {
  toJsonSchema,
  extractJson,
  parseWithRepair,
  type JsonSchema,
  type ParseResult,
} from './llm/structured.js';

// Map-reduce helpers (reduce partials, slice a file's diff).
export { reduceReviews, sliceDiff } from './review/reduce.js';

// The engine entry point: given (diff + resolved agent inputs + LLM) → grounded Review.
export {
  reviewPullRequest,
  reviewPromptParts,
  singlePassMessages,
  REVIEW_SCHEMA_NAME,
  type ReviewPromptInput,
  DEFAULT_MAP_THRESHOLD_LINES,
  DEFAULT_REVIEW_MAX_RETRIES,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
  type ReviewStrategy,
  type ReviewMode,
} from './review/run.js';

// Output: grounded Review → GitHubReviewPayload (body + inline comments + event).
export {
  toReviewPayload,
  gateTriggered,
  countBlockers,
  type ToReviewOptions,
} from './output/to-review.js';

// The single OpenAI-compatible structured provider (OpenRouter), shared by the
// CI runner and the server's openrouter path. Owns session grouping + guards.
export {
  OpenRouterProvider,
  experimentRequestBody,
  type OpenRouterProviderOptions,
} from './llm/openrouter.js';
// Pure parsers of OpenRouter's provenance metadata (HW2 experiment mode).
export {
  GENERATION_ID,
  experimentOptionsProblem,
  parseEndpoints,
  summarizeGeneration,
  summarizeRouterMetadata,
} from './llm/openrouter-metadata.js';

// Intent Layer (L03): bounded evidence → one classifier call → citation-checked
// analysis. deriveIntent calls the injected LLMProvider; the rest is pure.
export {
  buildIntentEvidence,
  DEFAULT_INTENT_EVIDENCE_LIMITS,
  MANIFEST_INCOMPLETE_NOTE,
  NO_HUNKS_LABEL,
  type ExtraFile,
  type IntentEvidence,
  type IntentEvidenceLimits,
  type SampledLines,
} from './intent/evidence.js';
export {
  checkCitation,
  validateIntent,
  INTENT_MAX_CITATION_SPAN,
  INTENT_OUTPUT_LIMITS,
  type IntentValidation,
} from './intent/validate.js';
export {
  buildIntentMessages,
  renderIntentForReview,
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_PROMPT,
  MAX_LINKED_ISSUE_CHARS,
  type IntentClaims,
} from './intent/prompt.js';
export {
  deriveIntent,
  DEFAULT_INTENT_MAX_TOKENS,
  DEFAULT_INTENT_REASONING,
  type DeriveIntentInput,
  type DeriveIntentOutcome,
} from './intent/derive.js';
export { INTENT_SCOPE_POLICY } from './prompt.js';
