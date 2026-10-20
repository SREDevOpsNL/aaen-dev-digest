import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, boolean } from 'drizzle-orm/pg-core';
import type { IntentAnalysis, IntentEvidenceStats } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // ---- L03 Intent Layer cache (all additive; the three columns above stay
  // populated for compatibility). Rows written before L03 read as `legacy`. ----
  /** 'legacy' | 'ready' | 'failed' | 'skipped_no_key' — of the stored analysis, not of the last attempt. */
  status: text('status').notNull().default('legacy'),
  /** Validated IntentAnalysis (citations checked); null until a derivation succeeds. */
  analysis: jsonb('analysis').$type<IntentAnalysis>(),
  evidence: jsonb('evidence').$type<IntentEvidenceStats>(),
  /** Fingerprint of the stored analysis: head revision, local PR context, linked-issue content, prompt version. */
  headSha: text('head_sha'),
  contextHash: text('context_hash'),
  issueHash: text('issue_hash'),
  promptVersion: integer('prompt_version'),
  linkedIssueNumber: integer('linked_issue_number'),
  linkedIssueTitle: text('linked_issue_title'),
  /** The derivation that produced `analysis` and what it cost (provider-reported; null = unknown). */
  derivationId: uuid('derivation_id'),
  provider: text('provider'),
  model: text('model'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  providerCostUsd: doublePrecision('provider_cost_usd'),
  derivedAt: timestamp('derived_at', { withTimezone: true }),
  /** When that derivation STARTED — the ordering key: an older start never overwrites a newer one. */
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** Last failed attempt; a failure never replaces a valid analysis. */
  lastError: text('last_error'),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  /** Cumulative classifier spend for this PR across successful derivations. */
  totalTokensIn: integer('total_tokens_in').notNull().default(0),
  totalTokensOut: integer('total_tokens_out').notNull().default(0),
  totalProviderCostUsd: doublePrecision('total_provider_cost_usd').notNull().default(0),
  /** False once any derivation's provider cost was unknown (or a failed call may have been billed). */
  totalCostComplete: boolean('total_cost_complete').notNull().default(true),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
