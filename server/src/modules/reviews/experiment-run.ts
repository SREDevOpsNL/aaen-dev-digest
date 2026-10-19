import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExperimentRunTrace,
  IntentRunSnapshot,
  LLMProvider,
  OpenRouterEndpointInfo,
  StructuredAttemptTelemetry,
  StructuredExperimentOptions,
} from '@devdigest/shared';
import type { ReviewPromptInput } from '@devdigest/reviewer-core';
import type { AgentRow } from '../../db/rows.js';
import type * as schema from '../../db/schema.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import {
  effectivePriceLimits,
  experimentBody,
  experimentOptions,
  inputUpperBound,
  preflight,
  requestFingerprints,
  type ExperimentRunContext,
} from '../_shared/experiment.js';

/**
 * HW2 experiment slot preparation for the review executor. Every check runs
 * before any model request; a failed check throws ExperimentRefusedError, which
 * carries the trace block so the refusal (at zero cost) is on record.
 */

export class ExperimentRefusedError extends Error {
  constructor(
    readonly reason: string,
    readonly block: ExperimentRunTrace,
  ) {
    super(`Experiment refused before dispatch: ${reason}`);
    this.name = 'ExperimentRefusedError';
  }
}

export interface ExperimentSlot {
  block: ExperimentRunTrace;
  options: StructuredExperimentOptions;
  attempts: StructuredAttemptTelemetry[];
}

/** The per-batch part: the context plus the hash of the diff actually loaded. */
export interface ExperimentBatch {
  ctx: ExperimentRunContext;
  diffSha256: string;
}

type ListEndpoints = { listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> };
const canListEndpoints = (llm: LLMProvider): llm is LLMProvider & ListEndpoints =>
  typeof (llm as Partial<ListEndpoints>).listEndpoints === 'function';

export function initialBlock(batch: ExperimentBatch): ExperimentRunTrace {
  const { config, request } = batch.ctx;
  return {
    stack_id: config.stackId,
    slot_id: request.slot_id,
    experiment: request.experiment,
    condition: request.condition,
    manifest_fingerprint: request.manifest_fingerprint,
    dispatch_state: 'refused',
    refusal_reason: null,
    diff_sha256: batch.diffSha256,
    expected_diff_sha256: request.expected_diff_sha256,
    non_skill_fingerprint: null,
    skill_fingerprint: null,
    routing: { order: [config.provider], only: [config.provider], allow_fallbacks: false },
    preflight: null,
    usage_known: true,
    attempts: [],
  };
}

export async function prepareExperimentSlot(args: {
  batch: ExperimentBatch;
  agent: AgentRow;
  repo: typeof schema.repos.$inferSelect;
  cloneDir: string;
  intent: IntentRunSnapshot;
  llm: LLMProvider;
  tokenizer: Tokenizer;
  promptInput: ReviewPromptInput;
  sessionId: string;
}): Promise<ExperimentSlot> {
  const { batch, agent, repo, intent, llm } = args;
  const { config, request } = batch.ctx;
  const block = initialBlock(batch);
  const refuse = (reason: string): never => {
    throw new ExperimentRefusedError(reason, { ...block, dispatch_state: 'refused', refusal_reason: reason });
  };

  if (agent.provider !== 'openrouter' || agent.model !== config.model) {
    refuse(`agent must use openrouter/${config.model} (has ${agent.provider}/${agent.model})`);
  }
  if (agent.strategy !== 'single-pass') refuse(`agent strategy must be single-pass (has ${agent.strategy})`);
  if (agent.repoIntel !== false) refuse('agent repo intel must be off');
  if (existsSync(join(args.cloneDir, repo.owner, repo.name))) {
    refuse(`a clone of ${repo.fullName} exists in the clone directory; the review would not use the frozen patches`);
  }
  if (batch.diffSha256 !== request.expected_diff_sha256) {
    refuse(`runtime diff sha256 ${batch.diffSha256} does not equal the frozen fixture hash ${request.expected_diff_sha256}`);
  }
  if (intent.source !== 'cache' || intent.status !== 'used') {
    refuse(`intent must come from a fresh cache (source=${intent.source}, status=${intent.status})`);
  }
  if (!canListEndpoints(llm)) refuse('the provider cannot report endpoint prices and limits');

  const options = experimentOptions(config);
  const fingerprints = requestFingerprints(args.promptInput, config.model, options, args.sessionId);
  block.non_skill_fingerprint = fingerprints.nonSkill;
  block.skill_fingerprint = fingerprints.skill;

  let live: OpenRouterEndpointInfo[];
  try {
    live = await (llm as LLMProvider & ListEndpoints).listEndpoints(config.model);
  } catch (err) {
    return refuse(`live endpoint prices unavailable: ${(err as Error).message}`);
  }
  const limits = effectivePriceLimits(config, live);
  if (!limits) return refuse(`no live endpoint matches the frozen provider ${config.provider}`);

  const bodyJson = JSON.stringify(experimentBody(args.promptInput, config.model, options, args.sessionId));
  const bound = inputUpperBound(bodyJson, args.tokenizer.count(bodyJson));
  const decision = preflight({ inputUpperBound: bound, outputCap: config.maxOutputTokens, limits, reservationUsd: request.reservation_usd });
  block.preflight = {
    input_upper_bound: bound,
    output_cap: config.maxOutputTokens,
    price_input_per_token: limits.prices.input,
    price_output_per_token: limits.prices.output,
    request_fee_usd: limits.prices.request,
    context_length: limits.contextLength,
    max_completion_tokens: limits.maxCompletionTokens,
    worst_case_usd: decision.worstCaseUsd ?? 0,
    reservation_usd: request.reservation_usd,
    price_source: limits.source,
  };
  if (!decision.ok) refuse(decision.reason);

  return { block: { ...block, dispatch_state: 'dispatching' }, options, attempts: [] };
}

/** Whether every dispatched attempt reported its tokens and cost. */
export function usageKnown(attempts: StructuredAttemptTelemetry[]): boolean {
  return attempts.every((a) => a.dispatch === 'refused' || (a.tokensIn !== null && a.tokensOut !== null && a.costUsd !== null));
}

/** Final block: the attempts as reported and whether their usage is complete. */
export function finishBlock(slot: ExperimentSlot, state: 'completed' | 'failed', reason: string | null = null): ExperimentRunTrace {
  return {
    ...slot.block,
    dispatch_state: state,
    refusal_reason: reason,
    usage_known: usageKnown(slot.attempts),
    attempts: slot.attempts as unknown as Array<Record<string, unknown>>,
  };
}

/** Known totals of the attempts, or null when any dispatched attempt did not report them. */
export function attemptTotals(attempts: StructuredAttemptTelemetry[]): { tokensIn: number | null; tokensOut: number | null; costUsd: number | null } {
  if (!usageKnown(attempts)) return { tokensIn: null, tokensOut: null, costUsd: null };
  const sum = (pick: (a: StructuredAttemptTelemetry) => number | null) => attempts.reduce((n, a) => n + (pick(a) ?? 0), 0);
  return { tokensIn: sum((a) => a.tokensIn), tokensOut: sum((a) => a.tokensOut), costUsd: sum((a) => a.costUsd) };
}
