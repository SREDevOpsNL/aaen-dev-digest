import { describe, it, expect, vi } from 'vitest';
import {
  contextHash,
  derivationStartedAt,
  identifyLinkedIssue,
  issueHash,
  staleReasons,
  toView,
  type PrIntentRow,
} from '../src/modules/intent/helpers.js';

const repo = { owner: 'acme', name: 'payments-api' };

describe('identifyLinkedIssue', () => {
  it('accepts a closing keyword pointing at one issue in this repository', () => {
    expect(identifyLinkedIssue('Fixes #12', repo)).toEqual({ status: 'identified', number: 12 });
    expect(identifyLinkedIssue('This resolves: #7.', repo)).toEqual({ status: 'identified', number: 7 });
    expect(identifyLinkedIssue('closes acme/payments-api#3', repo)).toEqual({ status: 'identified', number: 3 });
    expect(identifyLinkedIssue('Fixes #12 and also fixes #12', repo)).toEqual({ status: 'identified', number: 12 });
  });

  it('never treats a bare #N mention as the linked issue', () => {
    expect(identifyLinkedIssue('See #471 for background', repo)).toEqual({ status: 'none' });
    expect(identifyLinkedIssue('#5 is related', repo)).toEqual({ status: 'none' });
    expect(identifyLinkedIssue(null, repo)).toEqual({ status: 'none' });
  });

  it('ignores other repositories and reports several targets as ambiguous', () => {
    expect(identifyLinkedIssue('Fixes other/repo#9', repo)).toEqual({ status: 'none' });
    expect(identifyLinkedIssue('Fixes #1, closes #2', repo)).toEqual({ status: 'ambiguous' });
  });
});

describe('fingerprints', () => {
  const base = {
    title: 'Add rate limiting',
    body: 'Closes #471',
    files: [
      { path: 'b.ts', additions: 1, deletions: 0 },
      { path: 'a.ts', additions: 2, deletions: 1 },
    ],
    linkedIssueNumber: 471,
  };

  it('is independent of file order but sensitive to every input', () => {
    const h = contextHash(base);
    expect(contextHash({ ...base, files: [...base.files].reverse() })).toBe(h);
    expect(contextHash({ ...base, body: 'Closes #472' })).not.toBe(h);
    expect(contextHash({ ...base, title: 'x' })).not.toBe(h);
    expect(contextHash({ ...base, files: [base.files[0]!] })).not.toBe(h);
    expect(contextHash({ ...base, linkedIssueNumber: null })).not.toBe(h);
  });

  it('distinguishes issue content and the no-issue case', () => {
    expect(issueHash({ number: 1, title: 't', body: 'a' })).not.toBe(issueHash({ number: 1, title: 't', body: 'b' }));
    expect(issueHash(null)).toBe(issueHash(null));
  });
});

describe('staleness and view', () => {
  const current = { headSha: 'h2', contextHash: 'c1', promptVersion: 1 };
  const row = {
    prId: 'p',
    status: 'ready',
    analysis: {
      claimed_purpose: '',
      supported_points: [],
      discrepancies: [],
      in_scope: [],
      out_of_scope: [],
      confidence: 'low',
      unverified_statements: [],
    },
    headSha: 'h2',
    contextHash: 'c1',
    promptVersion: 1,
    linkedIssueNumber: null,
    linkedIssueTitle: null,
    providerCostUsd: 0,
  } as unknown as PrIntentRow;

  it('reports each reason a cached intent no longer matches', () => {
    expect(staleReasons(row, current)).toEqual([]);
    expect(staleReasons({ ...row, headSha: 'h1' }, current)).toEqual(['head_changed']);
    expect(staleReasons({ ...row, contextHash: 'c0' }, current)).toEqual(['context_changed']);
    expect(staleReasons({ ...row, promptVersion: 0 }, current)).toEqual(['prompt_changed']);
    expect(staleReasons({ ...row, status: 'legacy' }, current)).toEqual(['legacy']);
  });

  it('maps rows to view states without losing a valid analysis', () => {
    expect(toView('p', undefined, current).state).toBe('missing');
    expect(toView('p', row, current)).toMatchObject({ state: 'ready', stale: false, provider_cost_usd: 0 });
    // A failed recompute keeps the analysis: still ready, with the error alongside.
    expect(toView('p', { ...row, lastError: 'timeout' }, current)).toMatchObject({ state: 'ready', last_error: 'timeout' });
    expect(toView('p', { ...row, analysis: null, status: 'failed' }, current).state).toBe('failed');
    expect(toView('p', { ...row, analysis: null, status: 'skipped_no_key' }, current).state).toBe('skipped_no_key');
  });
});

describe('derivationStartedAt', () => {
  it('keeps increasing when the wall clock steps backwards or stands still', () => {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: now + 7_000 });
    try {
      const first = derivationStartedAt();
      vi.setSystemTime(now); // the clock steps back 7 s
      const second = derivationStartedAt();
      const third = derivationStartedAt(); // same wall-clock millisecond
      expect(second.getTime()).toBeGreaterThan(first.getTime());
      expect(third.getTime()).toBeGreaterThan(second.getTime());
      vi.setSystemTime(now + 60_000); // follows the wall clock again once it is ahead
      expect(derivationStartedAt().getTime()).toBe(now + 60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
