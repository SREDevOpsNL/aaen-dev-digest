import type { StructuredRequest } from '@devdigest/shared';

/**
 * Request lifecycle evidence, reported by a provider adapter per attempt.
 *
 * The engine prepares one stage per provider request (single pass: one; map:
 * one per chunk) and hands the adapter an `AttemptLifecycle` carrying that
 * stage's id. The adapter numbers its own attempts (1, 2, …) under the stage,
 * so a structured-output retry or a transport retry is a further attempt of
 * the SAME stage, never a second dispatch of a different prompt.
 *
 * Phases, in order:
 * - `submitted`: the adapter handed the request to its HTTP client. This is
 *   NOT evidence that the provider received or processed it.
 * - `response_received`: an HTTP response arrived (with the provider's
 *   response id when it sent one) and its reported usage.
 * - `usage_verified`: a generation or billing record was found for it (only
 *   where the adapter has one, e.g. OpenRouter's experiment-mode lookup).
 * - `failed`: the attempt ended without a usable answer (`outcome` says how).
 *
 * Usage is reported once per attempt, on `response_received`; `failed` never
 * carries usage, so a consumer that sums response usage counts each response
 * exactly once.
 */
export type AttemptPhase = 'submitted' | 'response_received' | 'usage_verified' | 'failed';
export type AttemptRetryKind = 'initial' | 'structured_retry' | 'transport_retry';
export type AttemptOutcome =
  | 'schema_invalid'
  | 'truncated'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'cancelled';

/**
 * Token breakdown fields, recorded exactly as the response or record named
 * them; null (or absent) when it did not report them, never derived.
 * - `reasoning_tokens`: the response's `usage.completion_tokens_details.reasoning_tokens`,
 *   or the generation record's `native_tokens_reasoning`.
 * - `native_*`: the generation record's `native_tokens_prompt` / `native_tokens_completion`
 *   (the upstream's own counts).
 * - `normalized_*`: the generation record's `tokens_prompt` / `tokens_completion`
 *   (OpenRouter-normalized counts).
 */
export interface AttemptTokenDetail {
  reasoning_tokens?: number | null;
  native_prompt_tokens?: number | null;
  native_completion_tokens?: number | null;
  normalized_prompt_tokens?: number | null;
  normalized_completion_tokens?: number | null;
}

/** Tokens and USD cost as one response (or one record) reported them; null = not reported. */
export interface AttemptUsage {
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  /** Breakdown fields, when the response or record carried any. */
  detail?: AttemptTokenDetail;
}

export interface AttemptLifecycleEvent {
  /** 1-based, per stage. */
  attempt: number;
  phase: AttemptPhase;
  retry: AttemptRetryKind;
  /** ISO time the phase was observed. */
  at: string;
  /** The provider's response id (`response_received`), when it sent one. */
  response_id?: string | null;
  finish_reason?: string | null;
  http_status?: number | null;
  /** `response_received`: the response's usage; `usage_verified`: the record's. */
  usage?: AttemptUsage;
  /** `failed` only. Never free text from the provider. */
  outcome?: AttemptOutcome;
}

export interface AttemptLifecycle {
  readonly stageId: string;
  report(event: AttemptLifecycleEvent): void;
}

/** A structured request that may carry the engine's stage lifecycle sink. */
export type LifecycleStructuredRequest<T> = StructuredRequest<T> & { lifecycle?: AttemptLifecycle };

/** One attempt of a stage, as seen by the adapter. Every method is safe to call: a sink error never breaks a request. */
export interface AttemptHandle {
  readonly attempt: number;
  received(patch: { response_id: string | null; finish_reason?: string | null; http_status?: number | null; usage: AttemptUsage }): void;
  verified(usage: AttemptUsage): void;
  failed(outcome: AttemptOutcome, patch?: { http_status?: number | null; finish_reason?: string | null; response_id?: string | null }): void;
}

/**
 * Numbers an adapter's attempts under one stage and reports their phases.
 * Without a lifecycle sink it does nothing, so adapters call it unconditionally.
 */
export class AttemptRecorder {
  private count = 0;

  constructor(private readonly lifecycle: AttemptLifecycle | undefined) {}

  /** The adapter is about to hand a request to its HTTP client. */
  submit(retry: AttemptRetryKind): AttemptHandle {
    const attempt = ++this.count;
    const emit = (event: Omit<AttemptLifecycleEvent, 'attempt' | 'retry' | 'at'>) => {
      if (!this.lifecycle) return;
      try {
        this.lifecycle.report({ attempt, retry, at: new Date().toISOString(), ...event });
      } catch {
        // Evidence collection must never change the request's outcome.
      }
    };
    emit({ phase: 'submitted' });
    return {
      attempt,
      received: (patch) => emit({ phase: 'response_received', ...patch }),
      verified: (usage) => emit({ phase: 'usage_verified', usage }),
      failed: (outcome, patch = {}) => emit({ phase: 'failed', outcome, ...patch }),
    };
  }
}

/** A finite, non-negative number, else null (a reported usage field that is absent or malformed is unknown). */
export function reportedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
