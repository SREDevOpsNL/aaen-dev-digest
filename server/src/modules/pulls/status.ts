import type { PrStatus } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown over each agent's latest successful review run, and a
 * review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

/** A successful review of a PR, as the FINDINGS column sees it. */
export interface CompletedReview {
  id: string;
  prId: string;
  /** `coalesce(reviews.agent_id, agent_runs.agent_id)`; null = no agent recorded. */
  agentId: string | null;
  /** When the review's run started (`agent_runs.ran_at`). */
  ranAt: Date | null;
  createdAt: Date;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders reviews by how recent their run is: the run that started later wins
 * (even if it finished earlier), then the review written later, then the
 * higher review id so ties resolve the same way every time. Positive when `a`
 * is newer.
 */
export function compareReviewRuns(a: CompletedReview, b: CompletedReview): number {
  return (
    (a.ranAt?.getTime() ?? 0) - (b.ranAt?.getTime() ?? 0) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    compareText(a.id, b.id)
  );
}

/**
 * The FINDINGS column's sources: each agent's latest successful review of each
 * PR, keyed by review id. Reviews with no agent on the review or its run form a
 * single unattributed group. An agent's latest review replaces its older ones
 * even when it has no findings.
 */
export function latestReviewPerAgent<T extends CompletedReview>(reviews: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const review of reviews) {
    const key = `${review.prId}:${review.agentId ?? ''}`;
    const current = latest.get(key);
    if (!current || compareReviewRuns(review, current) > 0) latest.set(key, review);
  }
  return new Map([...latest.values()].map((review) => [review.id, review]));
}

/** Preview order: severity (CRITICAL first), then the newer run, then file and line. */
export function sortFindingPreviews<P extends { severity: string; file: string; start_line: number }>(
  items: { preview: P; review: CompletedReview }[],
): P[] {
  const rank = (severity: string) => SEVERITY_RANK[severity] ?? Object.keys(SEVERITY_RANK).length;
  return [...items]
    .sort(
      (a, b) =>
        rank(a.preview.severity) - rank(b.preview.severity) ||
        compareReviewRuns(b.review, a.review) ||
        compareText(a.preview.file, b.preview.file) ||
        a.preview.start_line - b.preview.start_line,
    )
    .map((item) => item.preview);
}
