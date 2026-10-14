import type {
  IntentAnalysis,
  IntentAnalysisRaw,
  IntentDiscrepancy,
  IntentEvidenceRef,
  IntentPoint,
  UnverifiedStatement,
} from '@devdigest/shared';
import type { SampledLines } from './evidence.js';

/**
 * Citation-presence validation (pure). A citation is valid only when every
 * cited line was in the excerpts the classifier was shown. A valid citation
 * proves presence, not that the statement is correct. Statements without a
 * valid citation are kept as explicitly unverified, never presented as fact.
 */

export const INTENT_MAX_CITATION_SPAN = 40;

/** Output bounds so a verbose model cannot flood reviewers or the UI. */
export const INTENT_OUTPUT_LIMITS = {
  points: 8,
  discrepancies: 8,
  scopeItems: 10,
  statementChars: 400,
  scopeChars: 160,
  claimedChars: 600,
} as const;

type Reason = UnverifiedStatement['reason'];

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** null when valid, otherwise why it is not. */
export function checkCitation(
  ref: IntentEvidenceRef,
  sampled: Map<string, SampledLines>,
): Reason | null {
  const lines = sampled.get(ref.file);
  if (!lines) return 'file_not_sampled';
  if (
    !Number.isInteger(ref.start_line) ||
    !Number.isInteger(ref.end_line) ||
    ref.start_line < 1 ||
    ref.end_line < ref.start_line ||
    ref.end_line - ref.start_line + 1 > INTENT_MAX_CITATION_SPAN
  ) {
    return 'invalid_range';
  }
  const set = ref.side === 'new' ? lines.new : lines.old;
  for (let n = ref.start_line; n <= ref.end_line; n++) {
    if (!set.has(n)) return 'lines_not_sampled';
  }
  return null;
}

export interface IntentValidation {
  analysis: IntentAnalysis;
  invalidCitations: { statement: string; reason: Reason }[];
}

export function validateIntent(
  raw: IntentAnalysisRaw,
  sampled: Map<string, SampledLines>,
): IntentValidation {
  const unverified: UnverifiedStatement[] = [];
  const invalidCitations: IntentValidation['invalidCitations'] = [];

  function keepCited<T extends IntentPoint | IntentDiscrepancy>(
    item: T,
    origin: UnverifiedStatement['origin'],
  ): T | null {
    const statement = clip(item.statement, INTENT_OUTPUT_LIMITS.statementChars);
    const valid: IntentEvidenceRef[] = [];
    let firstReason: Reason | null = null;
    for (const ref of item.evidence) {
      const reason = checkCitation(ref, sampled);
      if (reason === null) valid.push(ref);
      else {
        invalidCitations.push({ statement, reason });
        firstReason ??= reason;
      }
    }
    if (valid.length > 0) return { ...item, statement, evidence: valid };
    unverified.push({ statement, origin, reason: firstReason ?? 'no_citation' });
    return null;
  }

  const supported = raw.supported_points
    .slice(0, INTENT_OUTPUT_LIMITS.points)
    .map((point) => keepCited(point, 'supported_point'))
    .filter((point): point is IntentPoint => point !== null);
  const discrepancies = raw.discrepancies
    .slice(0, INTENT_OUTPUT_LIMITS.discrepancies)
    .map((d) => keepCited(d, 'discrepancy'))
    .filter((d): d is IntentDiscrepancy => d !== null);
  const scope = (items: string[]) =>
    items
      .slice(0, INTENT_OUTPUT_LIMITS.scopeItems)
      .map((s) => clip(s, INTENT_OUTPUT_LIMITS.scopeChars))
      .filter((s) => s.length > 0);

  return {
    analysis: {
      claimed_purpose: clip(raw.claimed_purpose, INTENT_OUTPUT_LIMITS.claimedChars),
      supported_points: supported,
      discrepancies,
      in_scope: scope(raw.in_scope),
      out_of_scope: scope(raw.out_of_scope),
      // Nothing the evidence supports → the intent must not be trusted for prioritisation.
      confidence: supported.length === 0 ? 'low' : raw.confidence,
      unverified_statements: unverified,
    },
    invalidCitations,
  };
}
