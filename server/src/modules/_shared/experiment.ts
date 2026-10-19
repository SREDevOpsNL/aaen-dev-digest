import { createHash } from 'node:crypto';
import {
  REVIEW_SCHEMA_NAME,
  experimentRequestBody,
  singlePassMessages,
  type ReviewPromptInput,
} from '@devdigest/reviewer-core';
import { Review as ReviewSchema } from '@devdigest/shared';
import type { OpenRouterEndpointInfo, StructuredExperimentOptions } from '@devdigest/shared';
import type { ExperimentConfig } from '../../platform/config.js';

/**
 * HW2 controlled-experiment policy shared by the experiments module (start a
 * slot) and the review executor (run it). Pure: no I/O, no database.
 */

/** What the runner asks for one scheduled slot. */
export interface ExperimentRunRequest {
  slot_id: string;
  experiment: string;
  condition: 'with' | 'without';
  manifest_fingerprint: string;
  /** The most this slot may cost; the preflight refuses a worst case above it. */
  reservation_usd: number;
  /** sha256 of the frozen fixture diff; the runtime diff must equal it. */
  expected_diff_sha256: string;
}

export interface ExperimentRunContext {
  config: ExperimentConfig;
  request: ExperimentRunRequest;
  /** Called once when the run has finished (any outcome); releases the in-flight gate. */
  onSettled?: () => void;
}

/** Replaces the Skill slot in the non-Skill fingerprint, in both conditions alike. */
export const SKILL_SLOT_SENTINEL = '<<HW2 SKILL SLOT>>';
/** Documented allowance for chat-template and framing tokens not in the serialized body. */
export const CHAT_TEMPLATE_ALLOWANCE_TOKENS = 512;
/** Contingency multiplier on the worst case (plan rev. 4.3, budget). */
export const COST_CONTINGENCY = 1.5;

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sort(item)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function experimentOptions(config: ExperimentConfig): StructuredExperimentOptions {
  return {
    transportMaxRetries: 0,
    maxRetries: 0,
    routing: { order: [config.provider], only: [config.provider], allowFallbacks: false },
    maxTokens: config.maxOutputTokens,
    routerMetadata: true,
    generationLookup: config.generationLookup,
  };
}

/** The exact chat-completion body this slot will send (same builders the engine uses). */
export function experimentBody(
  input: ReviewPromptInput,
  model: string,
  options: StructuredExperimentOptions,
  sessionId?: string,
) {
  return experimentRequestBody(
    {
      model,
      messages: singlePassMessages(input),
      schema: ReviewSchema,
      schemaName: REVIEW_SCHEMA_NAME,
      temperature: 0,
      ...(sessionId ? { sessionId } : {}),
    },
    options,
  );
}

/**
 * Fingerprints built from the explicit request model, never by cutting text:
 * `nonSkill` hashes the full request with the Skill slot replaced by a fixed
 * sentinel (so it is identical across conditions exactly when every other
 * input is), `skill` hashes the Skill slot alone.
 */
export function requestFingerprints(
  input: ReviewPromptInput,
  model: string,
  options: StructuredExperimentOptions,
  sessionId?: string,
): { nonSkill: string; skill: string } {
  const sentinel = experimentBody({ ...input, skills: [SKILL_SLOT_SENTINEL] }, model, options, sessionId);
  return {
    nonSkill: sha256(canonicalJson(sentinel)),
    skill: sha256(canonicalJson(input.skills ?? [])),
  };
}

/**
 * Upper bound on input tokens: the larger of the tokenizer's count and the
 * UTF-8 byte length (a token is never shorter than one byte) of the serialized
 * body, plus the chat-template allowance.
 */
export function inputUpperBound(bodyJson: string, tokenizerCount: number): number {
  return Math.max(tokenizerCount, Buffer.byteLength(bodyJson, 'utf8')) + CHAT_TEMPLATE_ALLOWANCE_TOKENS;
}

export interface PriceLimits {
  prices: { input: number; output: number; request: number };
  contextLength: number | null;
  maxCompletionTokens: number | null;
  source: string;
}

/**
 * Prices and limits for the frozen provider: the more expensive of the frozen
 * config and the live endpoints that match the routing slug (and the frozen
 * display name, when set), with the tightest limits. Null when no live
 * endpoint matches, so the preflight fails closed.
 */
export function effectivePriceLimits(config: ExperimentConfig, live: OpenRouterEndpointInfo[]): PriceLimits | null {
  const slug = config.provider.toLowerCase();
  const base = slug.split('/')[0]!;
  const matching = live.filter((endpoint) => {
    const tag = endpoint.tag?.toLowerCase() ?? null;
    const slugMatch = tag === slug || (tag !== null && tag.split('/')[0] === base) || endpoint.providerName.toLowerCase() === base;
    return slugMatch && (config.providerName === null || endpoint.providerName === config.providerName);
  });
  if (matching.length === 0) return null;
  const max = (values: number[]) => Math.max(...values);
  const minKnown = (values: Array<number | null>) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length > 0 ? Math.min(...known) : null;
  };
  return {
    prices: {
      input: max([config.prices.input, ...matching.map((e) => e.pricing.prompt)]),
      output: max([config.prices.output, ...matching.map((e) => e.pricing.completion)]),
      request: max([config.prices.request, ...matching.map((e) => e.pricing.request)]),
    },
    contextLength: minKnown(matching.map((e) => e.contextLength)),
    maxCompletionTokens: minKnown(matching.map((e) => e.maxCompletionTokens)),
    source: `max(frozen config, ${matching.length} live endpoint(s): ${matching.map((e) => e.tag ?? e.providerName).join(', ')})`,
  };
}

export type PreflightDecision =
  | { ok: true; worstCaseUsd: number }
  | { ok: false; worstCaseUsd: number | null; reason: string };

/** Worst case = (input bound × input price + output cap × output price + request fee) × contingency. */
export function preflight(args: {
  inputUpperBound: number;
  outputCap: number;
  limits: PriceLimits;
  reservationUsd: number;
}): PreflightDecision {
  const { inputUpperBound: input, outputCap, limits, reservationUsd } = args;
  const worstCaseUsd =
    (input * limits.prices.input + outputCap * limits.prices.output + limits.prices.request) * COST_CONTINGENCY;
  if (limits.contextLength === null) return { ok: false, worstCaseUsd, reason: 'context length unknown' };
  if (input + outputCap > limits.contextLength) {
    return { ok: false, worstCaseUsd, reason: `input bound ${input} + output cap ${outputCap} exceeds the context length ${limits.contextLength}` };
  }
  if (limits.maxCompletionTokens !== null && outputCap > limits.maxCompletionTokens) {
    return { ok: false, worstCaseUsd, reason: `output cap ${outputCap} exceeds the endpoint's max completion tokens ${limits.maxCompletionTokens}` };
  }
  if (!(reservationUsd > 0) || worstCaseUsd > reservationUsd) {
    return { ok: false, worstCaseUsd, reason: `worst case $${worstCaseUsd.toFixed(6)} exceeds the slot reservation $${reservationUsd}` };
  }
  return { ok: true, worstCaseUsd };
}
