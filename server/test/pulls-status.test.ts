/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  latestReviewPerAgent,
  rollupSeverities,
  sortFindingPreviews,
  STALE_DAYS,
  type CompletedReview,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

const at = (time: string) => new Date(`2026-10-20T${time}:00Z`);
function review(o: Partial<CompletedReview> & { id: string }): CompletedReview {
  return { prId: 'pr-1', agentId: 'agent-a', ranAt: at('12:00'), createdAt: at('12:05'), ...o };
}

describe('latestReviewPerAgent', () => {
  it("keeps one review per agent: the run that started last, even when it finished first", () => {
    const winners = latestReviewPerAgent([
      review({ id: 'a-1', ranAt: at('12:00'), createdAt: at('12:20') }),
      review({ id: 'a-2', ranAt: at('12:10'), createdAt: at('12:15') }),
      review({ id: 'b-1', agentId: 'agent-b' }),
    ]);
    expect([...winners.keys()].sort()).toEqual(['a-2', 'b-1']);
  });

  it('breaks ties on the review time, then on the review id', () => {
    expect([...latestReviewPerAgent([
      review({ id: 'r-1', createdAt: at('12:30') }),
      review({ id: 'r-2', createdAt: at('12:05') }),
    ]).keys()]).toEqual(['r-1']);
    expect([...latestReviewPerAgent([review({ id: 'r-2' }), review({ id: 'r-9' }), review({ id: 'r-5' })]).keys()])
      .toEqual(['r-9']);
  });

  it('groups reviews with no agent together and keeps PRs apart', () => {
    const winners = latestReviewPerAgent([
      review({ id: 'old', agentId: null, ranAt: at('11:00') }),
      review({ id: 'new', agentId: null, ranAt: at('12:00') }),
      review({ id: 'other-pr', prId: 'pr-2', agentId: null, ranAt: at('10:00') }),
    ]);
    expect([...winners.keys()].sort()).toEqual(['new', 'other-pr']);
  });
});

describe('sortFindingPreviews', () => {
  it('orders by severity, then the newer run, then file and line', () => {
    const older = review({ id: 'older', ranAt: at('11:00') });
    const newer = review({ id: 'newer', agentId: 'agent-b', ranAt: at('12:00') });
    const preview = (title: string, severity: string, file = 'a.ts', start_line = 1) =>
      ({ title, severity, file, start_line });
    expect(
      sortFindingPreviews([
        { preview: preview('suggestion', 'SUGGESTION'), review: newer },
        { preview: preview('older warning', 'WARNING'), review: older },
        { preview: preview('unknown', 'WEIRD'), review: newer },
        { preview: preview('newer warning, line 9', 'WARNING', 'b.ts', 9), review: newer },
        { preview: preview('newer warning, line 2', 'WARNING', 'b.ts', 2), review: newer },
        { preview: preview('critical', 'CRITICAL'), review: older },
      ]).map((p) => p.title),
    ).toEqual(['critical', 'newer warning, line 2', 'newer warning, line 9', 'older warning', 'suggestion', 'unknown']);
  });
});
