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

export type FakeMode = 'ok' | 'fail-after-dispatch' | 'hold' | 'truncate' | 'http-429';

/**
 * Stands in for OpenRouter: reports one attempt the way the real provider
 * does (experiment telemetry and the stage lifecycle), and costs nothing.
 * - `truncate`: a 200 with finish_reason=length, its usage, and a
 *   ProviderOutputError carrying the partial text;
 * - `http-429`: an HTTP 429 with no response and no usage.
 */
export class FakeExperimentProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  requests: StructuredRequest<unknown>[] = [];
  mode: FakeMode = 'ok';
  private release?: () => void;
  held = new Promise<void>((resolve) => (this.release = resolve));
  endpoints: OpenRouterEndpointInfo[] = [FAKE_ENDPOINT];

  releaseHeld() {
    this.release?.();
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async listEndpoints(): Promise<OpenRouterEndpointInfo[]> {
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
    const tracked = new AttemptRecorder(req.lifecycle).submit('initial');
    if (this.mode === 'hold') await this.held;
    const failed = this.mode === 'fail-after-dispatch' || this.mode === 'http-429';
    const truncated = this.mode === 'truncate';
    const usage = truncated ? TRUNCATED_USAGE : { tokensIn: 900, tokensOut: 120, costUsd: 0.0002 };
    const attempt: StructuredAttemptTelemetry = {
      sequence: 1,
      dispatch: 'dispatched',
      outcome: this.mode === 'fail-after-dispatch' ? 'network_error' : this.mode === 'http-429' ? 'http_error' : truncated ? 'truncated' : 'valid',
      failureReason: this.mode === 'fail-after-dispatch' ? 'socket hang up' : this.mode === 'http-429' ? '429 Provider returned error' : truncated ? 'output reached the max_tokens cap' : null,
      httpStatus: this.mode === 'fail-after-dispatch' ? null : this.mode === 'http-429' ? 429 : 200,
      startedAt: new Date().toISOString(),
      durationMs: 5,
      requested: { model: req.model, routing: req.experiment?.routing ?? null, maxTokens: req.experiment?.maxTokens ?? null },
      responseId: failed ? null : 'gen-1793471676-synthetic0001',
      generationIdHeader: null,
      servedModel: failed ? null : FAKE_MODEL,
      finishReason: failed ? null : truncated ? 'length' : 'stop',
      tokensIn: failed ? null : usage.tokensIn,
      tokensOut: failed ? null : usage.tokensOut,
      costUsd: failed ? null : usage.costUsd,
      router: failed ? null : { selected: [{ provider: 'DeepInfra', model: FAKE_MODEL }], attempt: 1, attemptsCount: 1, requested: FAKE_MODEL, strategy: 'direct' },
      generation: null,
      routerMetadataRaw: null,
      errorDetail: null,
    };
    req.onAttempt?.(attempt);
    if (this.mode === 'fail-after-dispatch') {
      tracked.failed('network_error');
      throw new Error('socket hang up');
    }
    if (this.mode === 'http-429') {
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
