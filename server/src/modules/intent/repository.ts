import { and, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { IntentAnalysis, IntentEvidenceStats } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrIntentRow } from './helpers.js';

export interface IntentSuccess {
  prId: string;
  derivationId: string;
  startedAt: Date;
  analysis: IntentAnalysis;
  evidence: IntentEvidenceStats;
  headSha: string;
  contextHash: string;
  issueHash: string;
  promptVersion: number;
  linkedIssue: { number: number; title: string } | null;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Provider-reported; null = unknown (never coerced to 0). */
  providerCostUsd: number | null;
}

/** Legacy `intent` column (non-null since before L03): a one-line summary. */
function legacySummary(analysis: IntentAnalysis): string {
  return analysis.supported_points[0]?.statement ?? analysis.claimed_purpose ?? '';
}

/**
 * Persistence for the PR intent cache. Ordering and failure rules live in SQL:
 * - a result is written only if its derivation started no earlier than the one
 *   already stored, so an older result never overwrites a newer one;
 * - a failure never replaces a valid analysis, it only records the error;
 * - spend is accumulated per PR even when a result is superseded.
 */
export class IntentRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /** Store a successful derivation. Returns false when a newer derivation already won. */
  async saveSuccess(s: IntentSuccess): Promise<boolean> {
    const costKnown = s.providerCostUsd !== null;
    const values = {
      intent: legacySummary(s.analysis),
      inScope: s.analysis.in_scope,
      outOfScope: s.analysis.out_of_scope,
      status: 'ready',
      analysis: s.analysis,
      evidence: s.evidence,
      headSha: s.headSha,
      contextHash: s.contextHash,
      issueHash: s.issueHash,
      promptVersion: s.promptVersion,
      linkedIssueNumber: s.linkedIssue?.number ?? null,
      linkedIssueTitle: s.linkedIssue?.title ?? null,
      derivationId: s.derivationId,
      provider: s.provider,
      model: s.model,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      providerCostUsd: s.providerCostUsd,
      derivedAt: new Date(),
      startedAt: s.startedAt,
      lastError: null,
      lastAttemptAt: s.startedAt,
    };
    const written = await this.db
      .insert(t.prIntent)
      .values({
        prId: s.prId,
        ...values,
        totalTokensIn: s.tokensIn,
        totalTokensOut: s.tokensOut,
        totalProviderCostUsd: s.providerCostUsd ?? 0,
        totalCostComplete: costKnown,
      })
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: {
          ...values,
          totalTokensIn: sql`${t.prIntent.totalTokensIn} + ${s.tokensIn}`,
          totalTokensOut: sql`${t.prIntent.totalTokensOut} + ${s.tokensOut}`,
          totalProviderCostUsd: sql`${t.prIntent.totalProviderCostUsd} + ${s.providerCostUsd ?? 0}`,
          totalCostComplete: sql`${t.prIntent.totalCostComplete} AND ${costKnown}`,
        },
        // Typed operators bind the Date through the column type (a raw sql`` Date param is rejected).
        setWhere: or(isNull(t.prIntent.startedAt), lte(t.prIntent.startedAt, s.startedAt)),
      })
      .returning({ prId: t.prIntent.prId });
    if (written.length > 0) return true;
    // Superseded by a newer derivation: keep its result, still account for this spend.
    await this.addSpend(s.prId, s.tokensIn, s.tokensOut, s.providerCostUsd);
    return false;
  }

  /**
   * Record a failed attempt. A valid analysis is kept untouched; without one,
   * the row's status becomes the failure kind so the UI can explain it.
   * `mayHaveBilled` marks the cumulative cost as incomplete (a call was made
   * but its cost is unknown).
   */
  async saveFailure(
    prId: string,
    f: { status: 'failed' | 'skipped_no_key'; error: string; at: Date; mayHaveBilled: boolean },
  ): Promise<void> {
    await this.db
      .insert(t.prIntent)
      .values({
        prId,
        intent: '',
        status: f.status,
        lastError: f.error,
        lastAttemptAt: f.at,
        totalCostComplete: !f.mayHaveBilled,
      })
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: {
          status: sql`CASE WHEN ${t.prIntent.analysis} IS NOT NULL THEN ${t.prIntent.status} ELSE ${f.status} END`,
          lastError: f.error,
          lastAttemptAt: f.at,
          totalCostComplete: sql`${t.prIntent.totalCostComplete} AND ${!f.mayHaveBilled}`,
        },
      });
  }

  private async addSpend(prId: string, tokensIn: number, tokensOut: number, cost: number | null) {
    await this.db
      .update(t.prIntent)
      .set({
        totalTokensIn: sql`${t.prIntent.totalTokensIn} + ${tokensIn}`,
        totalTokensOut: sql`${t.prIntent.totalTokensOut} + ${tokensOut}`,
        totalProviderCostUsd: sql`${t.prIntent.totalProviderCostUsd} + ${cost ?? 0}`,
        totalCostComplete: sql`${t.prIntent.totalCostComplete} AND ${cost !== null}`,
      })
      .where(and(eq(t.prIntent.prId, prId), isNotNull(t.prIntent.startedAt)));
  }
}
