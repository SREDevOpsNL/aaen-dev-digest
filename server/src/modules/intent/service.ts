import { randomUUID } from 'node:crypto';
import type { IntentAnalysis, IntentRunSnapshot, PrIntentView, UnifiedDiff } from '@devdigest/shared';
import { deriveIntent, INTENT_PROMPT_VERSION } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { ConfigError, NotFoundError } from '../../platform/errors.js';
import { withAbortableTimeout } from '../../platform/resilience.js';
import type * as schema from '../../db/schema.js';
import { ReviewRepository, type PullRow } from '../reviews/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentRepository } from './repository.js';
import {
  contextHash,
  identifyLinkedIssue,
  issueHash,
  staleReasons,
  toView,
  type LinkedIssueRef,
  type PrIntentRow,
} from './helpers.js';
import { INTENT_MAX_RETRIES, INTENT_TIMEOUT_MARGIN_MS, INTENT_TIMEOUT_MS } from './constants.js';

type RepoRow = typeof schema.repos.$inferSelect;
type PrFileRow = typeof schema.prFiles.$inferSelect;
type LinkedIssue = { number: number; title: string; body: string | null };

interface PrContext {
  workspaceId: string;
  pull: PullRow;
  repo: RepoRow;
  files: PrFileRow[];
  linked: LinkedIssueRef;
  contextHash: string;
}

export type DerivationResult =
  | {
      ok: true;
      derivationId: string;
      analysis: IntentAnalysis;
      /** The revision, context and linked-issue content this result was derived for. */
      headSha: string;
      contextHash: string;
      issueHash: string;
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      providerCostUsd: number | null;
      derivedAt: Date;
    }
  | { ok: false; status: 'failed' | 'skipped_no_key' | 'superseded'; error: string };

/** Minimal logger the review executor passes in (RunLogger-compatible). */
export interface IntentLog {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * In-flight derivations per PR, shared by every IntentService instance of one
 * container: first-open, Recompute and review batches all join the same call,
 * so concurrent requests never pay for the classifier twice. (The API runs one
 * process per database; the started_at guard in the repository covers the rest.)
 */
const inflight = new WeakMap<Container, Map<string, Promise<DerivationResult>>>();
// Deployment note: the API supports one process per database (see the product
// boundary), so this in-process map plus the started_at ordering guard in the
// repository is the coordination. Several API instances could each pay for a
// derivation of the same revision; that topology is not supported.

/**
 * PR intent (L03). Reading never calls a model. Generation happens on first
 * open (ensure), on Recompute, and once per review batch when the cache is
 * missing or stale. A failed generation never replaces a valid cached intent.
 */
export class IntentService {
  private intents: IntentRepository;
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.intents = new IntentRepository(container.db);
    this.reviews = new ReviewRepository(container.db);
  }

  /** Cached intent and its freshness. Never calls a model or GitHub. */
  async view(workspaceId: string, prId: string): Promise<PrIntentView> {
    const ctx = await this.context(workspaceId, prId);
    return this.toView(ctx, await this.intents.get(prId));
  }

  /**
   * First-open generation: derives only when nothing usable is cached. A stale,
   * failed or skipped intent is left as is — the user decides with Recompute.
   */
  async ensure(workspaceId: string, prId: string): Promise<PrIntentView> {
    const ctx = await this.context(workspaceId, prId);
    const row = await this.intents.get(prId);
    if (!row || (!row.analysis && row.status === 'legacy')) await this.derive(ctx);
    return this.toView(ctx, await this.intents.get(prId));
  }

  /** Explicit recompute. On failure the previous valid analysis stays, with `last_error` set. */
  async recompute(workspaceId: string, prId: string): Promise<PrIntentView> {
    const ctx = await this.context(workspaceId, prId);
    await this.derive(ctx);
    return this.toView(ctx, await this.intents.get(prId));
  }

  /**
   * Intent for a review batch. Reuses a fresh cache (including an unchanged
   * linked issue); otherwise refreshes once. If that fails the batch reviews
   * without intent — a stale intent is never used. Never throws.
   */
  async forReviewBatch(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    log?: IntentLog,
  ): Promise<IntentRunSnapshot> {
    try {
      const ctx = await this.contextFor(workspaceId, pull, repo);
      // The batch reads the linked issue once and uses that content for the
      // freshness check, the derivation and the injection check alike.
      const issue = ctx.linked.status === 'identified' ? await this.fetchIssue(ctx, ctx.linked.number) : null;
      if (ctx.linked.status === 'identified' && !issue) {
        log?.info(`PR intent: linked issue #${ctx.linked.number} unavailable; freshness checked against local context only`);
      }
      // Unreadable issue: judge by local context only (as before).
      const issueMatches = (stored: string | null) => !issue || issueHash(issue) === stored;
      const row = await this.intents.get(pull.id);
      if (row?.analysis && staleReasons(row, this.current(ctx)).length === 0) {
        if (issueMatches(row.issueHash)) {
          log?.info('PR intent: reusing the cached intent for this head');
          return snapshotFromRow(row);
        }
        log?.info('PR intent: the linked issue changed — refreshing');
      } else {
        log?.info(row?.analysis ? 'PR intent: cached intent is stale — refreshing' : 'PR intent: deriving');
      }
      const result = await this.derive(ctx, diff, issue);
      if (result.ok) {
        // Inject only an intent derived for exactly this revision, context and issue content.
        if (result.headSha === pull.headSha && result.contextHash === ctx.contextHash && issueMatches(result.issueHash)) {
          return snapshotFromDerivation(result, INTENT_PROMPT_VERSION);
        }
        log?.warn('PR intent: derived for a different revision — reviewing without intent');
        return noneSnapshot('superseded', 'derived intent does not match this revision');
      }
      if (result.status === 'superseded') {
        // This batch's derivation lost to a newer one. Never inject the superseded
        // result; use the cache only if the winner is for this same revision.
        const latest = await this.intents.get(pull.id);
        if (
          latest?.analysis &&
          latest.headSha === pull.headSha &&
          latest.contextHash === ctx.contextHash &&
          latest.promptVersion === INTENT_PROMPT_VERSION &&
          issueMatches(latest.issueHash)
        ) {
          log?.info('PR intent: a newer derivation for this revision is cached; using it');
          return snapshotFromRow(latest);
        }
        log?.warn('PR intent: superseded by a derivation for another revision — reviewing without intent');
        return noneSnapshot('superseded', result.error);
      }
      log?.warn(`PR intent unavailable (${result.status}): ${result.error} — reviewing without intent`);
      return noneSnapshot(result.status, result.error);
    } catch (err) {
      log?.warn(`PR intent unavailable: ${(err as Error).message} — reviewing without intent`);
      return noneSnapshot('failed', (err as Error).message);
    }
  }

  // ---- internals -----------------------------------------------------------

  private async context(workspaceId: string, prId: string): Promise<PrContext> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return this.contextFor(workspaceId, pull, repo);
  }

  private async contextFor(workspaceId: string, pull: PullRow, repo: RepoRow): Promise<PrContext> {
    const files = await this.reviews.getPrFiles(pull.id);
    const linked = identifyLinkedIssue(pull.body, { owner: repo.owner, name: repo.name });
    return {
      workspaceId,
      pull,
      repo,
      files,
      linked,
      contextHash: contextHash({
        title: pull.title,
        body: pull.body,
        files,
        linkedIssueNumber: linked.status === 'identified' ? linked.number : null,
      }),
    };
  }

  private current(ctx: PrContext) {
    return { headSha: ctx.pull.headSha, contextHash: ctx.contextHash, promptVersion: INTENT_PROMPT_VERSION };
  }

  private toView(ctx: PrContext, row: PrIntentRow | undefined): PrIntentView {
    return toView(ctx.pull.id, row, this.current(ctx));
  }

  private async fetchIssue(ctx: PrContext, n: number): Promise<LinkedIssue | null> {
    try {
      const gh = await this.container.github();
      const issue = await gh.getIssue({ owner: ctx.repo.owner, name: ctx.repo.name }, n);
      return { number: issue.number, title: issue.title, body: issue.body ?? null };
    } catch {
      return null; // GitHub unavailable: degrade to no issue context
    }
  }

  /**
   * Single flight per PR *revision*: callers asking for the same head SHA,
   * context and linked-issue content share one classifier call. A request for
   * an updated PR or an edited linked issue has a different key, so it never
   * joins work started with older inputs. The issue is read before the key
   * (pass `issue` when the caller already read it; `undefined` = read it here).
   */
  private async derive(ctx: PrContext, diff?: UnifiedDiff, issue?: LinkedIssue | null): Promise<DerivationResult> {
    const startedAt = new Date();
    const linkedIssue =
      issue !== undefined
        ? issue
        : ctx.linked.status === 'identified'
          ? await this.fetchIssue(ctx, ctx.linked.number)
          : null;
    let byKey = inflight.get(this.container);
    if (!byKey) {
      byKey = new Map();
      inflight.set(this.container, byKey);
    }
    const key = `${ctx.pull.id}:${ctx.pull.headSha}:${ctx.contextHash}:${issueHash(linkedIssue)}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const run = this.runDerivation(ctx, linkedIssue, startedAt, diff).finally(() => byKey.delete(key));
    byKey.set(key, run);
    return run;
  }

  private async runDerivation(
    ctx: PrContext,
    issue: LinkedIssue | null,
    startedAt: Date,
    diff?: UnifiedDiff,
  ): Promise<DerivationResult> {
    const choice = await resolveFeatureModel(this.container, ctx.workspaceId, 'review_intent');
    let llm;
    try {
      llm = await this.container.llm(choice.provider);
    } catch (err) {
      const error = (err as Error).message;
      const status = err instanceof ConfigError ? 'skipped_no_key' : 'failed';
      await this.intents.saveFailure(ctx.pull.id, { status, error, at: startedAt, mayHaveBilled: false });
      return { ok: false, status, error };
    }

    let called = false;
    try {
      const d = diff ?? (await loadDiff(this.container, this.reviews, ctx.workspaceId, ctx.pull, ctx.repo));
      const inDiff = new Set(d.files.map((f) => f.path));
      const extraFiles = ctx.files
        .filter((f) => !inDiff.has(f.path))
        .map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }));
      called = true;
      // The deadline aborts the classifier request itself (no orphaned call
      // keeps running, and possibly billing, after the derivation has failed).
      const out = await withAbortableTimeout(
        (signal) =>
          deriveIntent({
            llm,
            model: choice.model,
            diff: d,
            title: ctx.pull.title,
            description: ctx.pull.body,
            linkedIssue: issue,
            extraFiles,
            timeoutMs: INTENT_TIMEOUT_MS,
            maxRetries: INTENT_MAX_RETRIES,
            sessionId: `${ctx.repo.owner}/${ctx.repo.name}#${ctx.pull.number}:intent`,
            signal,
          }),
        INTENT_TIMEOUT_MS + INTENT_TIMEOUT_MARGIN_MS,
      );
      const derivationId = randomUUID();
      const derivedIssueHash = issueHash(issue);
      const stored = await this.intents.saveSuccess({
        prId: ctx.pull.id,
        derivationId,
        startedAt,
        analysis: out.analysis,
        evidence: out.evidence,
        headSha: ctx.pull.headSha,
        contextHash: ctx.contextHash,
        issueHash: derivedIssueHash,
        promptVersion: out.promptVersion,
        linkedIssue: issue ? { number: issue.number, title: issue.title } : null,
        provider: choice.provider,
        model: out.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        providerCostUsd: out.providerCostUsd,
      });
      // A derivation that started later already won the cache: this result is
      // superseded and must not be used (its spend is still recorded).
      if (!stored) {
        return { ok: false, status: 'superseded', error: 'superseded by a newer derivation for this PR' };
      }
      return {
        ok: true,
        derivationId,
        analysis: out.analysis,
        headSha: ctx.pull.headSha,
        contextHash: ctx.contextHash,
        issueHash: derivedIssueHash,
        provider: choice.provider,
        model: out.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        providerCostUsd: out.providerCostUsd,
        derivedAt: new Date(),
      };
    } catch (err) {
      const error = (err as Error).message;
      // An interrupted (timed-out or aborted) request may still have been
      // billed by the provider with no usage returned: mark the cost unknown.
      await this.intents.saveFailure(ctx.pull.id, { status: 'failed', error, at: startedAt, mayHaveBilled: called });
      return { ok: false, status: 'failed', error };
    }
  }
}

function snapshotFromRow(row: PrIntentRow): IntentRunSnapshot {
  return {
    source: 'cache',
    status: 'used',
    derivation_id: row.derivationId,
    head_sha: row.headSha,
    prompt_version: row.promptVersion,
    provider: row.provider,
    model: row.model,
    derived_at: row.derivedAt ? row.derivedAt.toISOString() : null,
    analysis: row.analysis,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    provider_cost_usd: row.providerCostUsd,
    error: null,
    attribution: 'shared',
  };
}

function snapshotFromDerivation(
  d: Extract<DerivationResult, { ok: true }>,
  promptVersion: number,
): IntentRunSnapshot {
  return {
    source: 'derived',
    status: 'used',
    derivation_id: d.derivationId,
    head_sha: d.headSha,
    prompt_version: promptVersion,
    provider: d.provider,
    model: d.model,
    derived_at: d.derivedAt.toISOString(),
    analysis: d.analysis,
    tokens_in: d.tokensIn,
    tokens_out: d.tokensOut,
    provider_cost_usd: d.providerCostUsd,
    error: null,
    attribution: 'shared',
  };
}

export function noneSnapshot(
  status: Exclude<IntentRunSnapshot['status'], 'used'>,
  error: string | null,
): IntentRunSnapshot {
  return {
    source: 'none',
    status,
    derivation_id: null,
    head_sha: null,
    prompt_version: null,
    provider: null,
    model: null,
    derived_at: null,
    analysis: null,
    tokens_in: null,
    tokens_out: null,
    provider_cost_usd: null,
    error,
    attribution: 'shared',
  };
}
