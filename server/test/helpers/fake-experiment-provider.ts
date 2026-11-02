import type {
  LLMProvider,
  ModelInfo,
  OpenRouterEndpointInfo,
  StructuredAttemptTelemetry,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { AttemptRecorder, ProviderOutputError, type LifecycleStructuredRequest } from '@devdigest/reviewer-core';

export const FAKE_MODEL = 'deepseek/deepseek-v4-flash';
export const FAKE_ENDPOINT: OpenRouterEndpointInfo = {
  providerName: 'DeepInfra',
  tag: 'deepinfra',
  quantization: 'fp8',
  contextLength: 128_000,
  maxCompletionTokens: 16_384,
  pricing: { prompt: 0.00000014, completion: 0.00000028, request: 0 },
};

/**
 * A synthetic, length-stopped review: the shape of the preserved Item B v3
 * truncated slot (output cut mid-string at the cap), with made-up text.
 */
export const TRUNCATED_OUTPUT = `{"verdict":"comment","summary":"Synthetic partial review","score":40,"findings":[{"id":"f1","severity":"WARNING","category":"tests","title":"Synthetic finding cut at the cap","file":"src/billing/discount.test.ts","start_line":5,"end_line":7,"rationale":"The answer stops here mid-sente`;

/** The usage the v3 truncated slot reported (input, the 4,000-token cap, cost); public numbers. */
export const TRUNCATED_USAGE = { tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 };

export type FakeMode =
  | 'ok'
  | 'fail-after-dispatch'
  | 'hold'
  | 'truncate'
  | 'http-429'
  /** A 429 shaped like the recorded v4 one: DeepInfra's shared pool, no response ID, no usage. */
  | 'http-429-shared-pool'
  /** The same 429, but carrying a response ID (not a pre-generation refusal). */
  | 'http-429-with-response-id'
  /** A 429 from OpenRouter itself (`openrouter_key_limit`), not the upstream. */
  | 'http-429-openrouter'
  /** An upstream 429 with a limit_source outside the v5 allowlist. */
  | 'http-429-other-limit';

const THROTTLE_DETAIL = {
  'http-429-shared-pool': { origin: 'upstream_provider', providerName: 'DeepInfra', limitSource: 'upstream_provider_shared_pool' },
  'http-429-with-response-id': { origin: 'upstream_provider', providerName: 'DeepInfra', limitSource: 'upstream_provider_shared_pool' },
  'http-429-openrouter': { origin: 'openrouter', providerName: null, limitSource: 'openrouter_key_limit' },
  'http-429-other-limit': { origin: 'upstream_provider', providerName: 'DeepInfra', limitSource: 'upstream_provider_rate_limit' },
} as const;

/**
 * Stands in for OpenRouter: reports one attempt the way the real provider
 * does (experiment telemetry and the stage lifecycle), and costs nothing.
 * - `truncate`: a 200 with finish_reason=length, its usage, and a
 *   ProviderOutputError carrying the partial text;
 * - `http-429`: an HTTP 429 with no response and no usage;
 * - `http-429-shared-pool`, `-with-response-id`, `-openrouter`, `-other-limit`: HTTP 429s
 *   with the structured error detail the real extractor writes.
 * `script` sets the mode of each next request in turn (then `mode`).
 */
export class FakeExperimentProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  requests: StructuredRequest<unknown>[] = [];
  mode: FakeMode = 'ok';
  /** Modes for the next requests, consumed one per request; `mode` applies once it is empty. */
  script: FakeMode[] = [];
  private release?: () => void;
  held = new Promise<void>((resolve) => (this.release = resolve));
  endpoints: OpenRouterEndpointInfo[] = [FAKE_ENDPOINT];
  /** The raw `openrouter_metadata` a response carries (provider-controlled). */
  routerMetadataRaw: unknown = null;

  releaseHeld() {
    this.release?.();
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  /** When set, the endpoints read fails with it (a provider-controlled message). */
  endpointsError: Error | null = null;
  async listEndpoints(): Promise<OpenRouterEndpointInfo[]> {
    if (this.endpointsError) throw this.endpointsError;
    return this.endpoints;
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
  async completeStructured<T>(req: LifecycleStructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const mode = this.script.shift() ?? this.mode;
    const tracked = new AttemptRecorder(req.lifecycle).submit('initial');
    if (mode === 'hold') await this.held;
    const throttle = mode in THROTTLE_DETAIL ? THROTTLE_DETAIL[mode as keyof typeof THROTTLE_DETAIL] : null;
    const http429 = mode === 'http-429' || throttle !== null;
    const failed = mode === 'fail-after-dispatch' || http429;
    const truncated = mode === 'truncate';
    const usage = truncated ? TRUNCATED_USAGE : { tokensIn: 900, tokensOut: 120, costUsd: 0.0002 };
    const attempt: StructuredAttemptTelemetry = {
      sequence: 1,
      dispatch: 'dispatched',
      outcome: mode === 'fail-after-dispatch' ? 'network_error' : http429 ? 'http_error' : truncated ? 'truncated' : 'valid',
      failureReason: mode === 'fail-after-dispatch' ? 'socket hang up' : http429 ? '429 Provider returned error' : truncated ? 'output reached the max_tokens cap' : null,
      httpStatus: mode === 'fail-after-dispatch' ? null : http429 ? 429 : 200,
      startedAt: new Date().toISOString(),
      durationMs: 5,
      requested: { model: req.model, routing: req.experiment?.routing ?? null, maxTokens: req.experiment?.maxTokens ?? null },
      responseId: mode === 'http-429-with-response-id' ? 'gen-1793471676-synthetic0429' : failed ? null : 'gen-1793471676-synthetic0001',
      generationIdHeader: null,
      servedModel: failed ? null : FAKE_MODEL,
      finishReason: failed ? null : truncated ? 'length' : 'stop',
      tokensIn: failed ? null : usage.tokensIn,
      tokensOut: failed ? null : usage.tokensOut,
      costUsd: failed ? null : usage.costUsd,
      router: failed ? null : { selected: [{ provider: 'DeepInfra', model: FAKE_MODEL }], attempt: 1, attemptsCount: 1, requested: FAKE_MODEL, strategy: 'direct' },
      generation: null,
      routerMetadataRaw: failed ? null : this.routerMetadataRaw,
      errorDetail: throttle
        ? { origin: throttle.origin, code: 429, message: 'Provider returned error', errorType: null, providerCode: null, providerName: throttle.providerName, limitSource: throttle.limitSource, upstreamRawPresent: false, requestId: null, retryAfter: null, rateLimit: {}, redacted: false }
        : null,
    };
    req.onAttempt?.(attempt);
    if (mode === 'fail-after-dispatch') {
      tracked.failed('network_error');
      throw new Error('socket hang up');
    }
    if (http429) {
      tracked.failed('http_error', { http_status: 429 });
      throw new Error('429 Provider returned error');
    }
    tracked.received({
      response_id: 'gen-1793471676-synthetic0001',
      finish_reason: truncated ? 'length' : 'stop',
      http_status: 200,
      usage: { tokens_in: usage.tokensIn, tokens_out: usage.tokensOut, cost_usd: usage.costUsd },
    });
    if (truncated) {
      tracked.failed('truncated', { finish_reason: 'length' });
      throw new ProviderOutputError('output reached the max_tokens cap (finish_reason=length) for Review; experiment mode does not reprompt', {
        kind: 'truncated',
        text: TRUNCATED_OUTPUT,
        usage,
        finishReason: 'length',
        responseId: 'gen-1793471676-synthetic0001',
        attempts: 1,
      });
    }
    return {
      data: { verdict: 'approve', summary: 'ok', score: 100, findings: [] } as T,
      model: req.model,
      tokensIn: 900,
      tokensOut: 120,
      providerCostUsd: 0.0002,
      costUsd: 0.0002,
      raw: '{}',
      attempts: 1,
    };
  }
}
