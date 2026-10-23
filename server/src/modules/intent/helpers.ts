import { createHash } from 'node:crypto';
import type { IntentStaleReason, PrIntentView } from '@devdigest/shared';
import { MAX_LINKED_ISSUE_CHARS } from '@devdigest/reviewer-core';
import type * as t from '../../db/schema.js';

export type PrIntentRow = typeof t.prIntent.$inferSelect;

/**
 * Closing keywords GitHub itself recognises. A bare `#N` is only a mention, so
 * it never counts as the PR's linked issue.
 */
const CLOSING_REF =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:([\w.-]+)\/([\w.-]+))?#(\d+)\b/gi;

export type LinkedIssueRef =
  | { status: 'identified'; number: number }
  | { status: 'none' | 'ambiguous' };

/**
 * The PR's linked issue, only when reliably identified: a closing keyword
 * pointing at exactly one issue in this repository. Cross-repository targets
 * are ignored; two or more distinct targets are ambiguous.
 */
export function identifyLinkedIssue(
  body: string | null | undefined,
  repo: { owner: string; name: string },
): LinkedIssueRef {
  if (!body) return { status: 'none' };
  const numbers = new Set<number>();
  for (const match of body.matchAll(CLOSING_REF)) {
    const [, owner, name, num] = match;
    if (owner && name) {
      const same =
        owner.toLowerCase() === repo.owner.toLowerCase() &&
        name.toLowerCase() === repo.name.toLowerCase();
      if (!same) continue;
    }
    numbers.add(Number(num));
  }
  if (numbers.size === 0) return { status: 'none' };
  if (numbers.size > 1) return { status: 'ambiguous' };
  return { status: 'identified', number: [...numbers][0]! };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Fingerprint of the synchronized local PR context the intent depends on:
 * title, description, the reported file list, and which issue is linked.
 * Computed from the database only, so checking freshness never calls GitHub.
 */
export function contextHash(input: {
  title: string;
  body: string | null | undefined;
  files: { path: string; additions: number; deletions: number }[];
  linkedIssueNumber: number | null;
}): string {
  const files = [...input.files]
    .map((f) => [f.path, f.additions, f.deletions] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return sha256(
    JSON.stringify({
      title: input.title,
      body: input.body ?? '',
      files,
      issue: input.linkedIssueNumber,
    }),
  );
}

let lastStartMs = 0;

/**
 * Start time of a derivation attempt, strictly increasing within this process.
 * The cache keeps the derivation that started last (the repository's
 * `started_at` guard), so this must not follow the wall clock backwards: an
 * NTP step, a VM resume or WSL2's periodic clock jumps would otherwise let an
 * older derivation overwrite a newer one, and a review batch inject it. Two
 * attempts never share a stamp either.
 */
export function derivationStartedAt(): Date {
  lastStartMs = Math.max(Date.now(), lastStartMs + 1);
  return new Date(lastStartMs);
}

/** Fingerprint of the linked-issue content the classifier saw ('' when none). */
export function issueHash(
  issue: { number: number; title: string; body?: string | null } | null,
): string {
  if (!issue) return sha256('');
  return sha256(`${issue.number}\n${issue.title}\n${(issue.body ?? '').slice(0, MAX_LINKED_ISSUE_CHARS)}`);
}

/** Why a stored analysis no longer matches the PR (empty when fresh). */
export function staleReasons(
  row: PrIntentRow,
  current: { headSha: string; contextHash: string; promptVersion: number },
): IntentStaleReason[] {
  if (!row.analysis) return [];
  if (row.status === 'legacy') return ['legacy'];
  const reasons: IntentStaleReason[] = [];
  if (row.headSha !== current.headSha) reasons.push('head_changed');
  if (row.contextHash !== current.contextHash) reasons.push('context_changed');
  if (row.promptVersion !== current.promptVersion) reasons.push('prompt_changed');
  return reasons;
}

export function toView(
  prId: string,
  row: PrIntentRow | undefined,
  current: { headSha: string; contextHash: string; promptVersion: number },
): PrIntentView {
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  if (!row) {
    return {
      pr_id: prId,
      state: 'missing',
      stale: false,
      stale_reasons: [],
      analysis: null,
      head_sha: null,
      current_head_sha: current.headSha,
      linked_issue: null,
      evidence: null,
      provider: null,
      model: null,
      derived_at: null,
      tokens_in: null,
      tokens_out: null,
      provider_cost_usd: null,
      last_error: null,
      last_attempt_at: null,
    };
  }
  const reasons = staleReasons(row, current);
  const state: PrIntentView['state'] = row.analysis
    ? 'ready'
    : row.status === 'skipped_no_key'
      ? 'skipped_no_key'
      : row.status === 'failed'
        ? 'failed'
        : 'missing';
  return {
    pr_id: prId,
    state,
    stale: reasons.length > 0,
    stale_reasons: reasons,
    analysis: row.analysis ?? null,
    head_sha: row.headSha,
    current_head_sha: current.headSha,
    linked_issue:
      row.linkedIssueNumber !== null && row.linkedIssueTitle !== null
        ? { number: row.linkedIssueNumber, title: row.linkedIssueTitle }
        : null,
    evidence: row.evidence ?? null,
    provider: row.provider,
    model: row.model,
    derived_at: iso(row.derivedAt),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    provider_cost_usd: row.providerCostUsd,
    last_error: row.lastError,
    last_attempt_at: iso(row.lastAttemptAt),
  };
}
