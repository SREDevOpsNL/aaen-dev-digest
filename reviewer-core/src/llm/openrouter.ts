import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  GenerationMetadataSummary,
  OpenRouterEndpointInfo,
  StructuredAttemptTelemetry,
  StructuredExperimentOptions,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { toJsonSchema, parseWithRepair } from './structured.js';
import {
  GENERATION_ID,
  emptyGeneration,
  experimentOptionsProblem,
  parseEndpoints,
  summarizeGeneration,
  summarizeRouterMetadata,
} from './openrouter-metadata.js';
import { ExperimentRequestError, attemptErrorDetail, failedResponseTelemetry, sanitizeText } from './error-detail.js';

/** Bound on a persisted failure reason. */
const FAILURE_REASON_MAX = 500;

/** Default per-request timeout of the SDK client (also the ceiling for `StructuredRequest.timeoutMs`). */
export const OPENROUTER_DEFAULT_TIMEOUT_MS = 90_000;
/** Default timeout of one `GET /generation` read. */
export const GENERATION_LOOKUP_READ_TIMEOUT_MS = 5_000;

/**
 * The longest a generation lookup with `policy` can take: its delays between
 * reads plus one read's timeout. The lookup stops at this deadline whatever
 * the reads do, so the attempt is reported at most this long after the response.
 */
export function generationLookupDeadlineMs(
  policy: { attempts: number; delayMs: number },
  readTimeoutMs: number = GENERATION_LOOKUP_READ_TIMEOUT_MS,
): number {
  return (Math.max(policy.attempts, 1) - 1) * policy.delayMs + readTimeoutMs;
}

/**
 * The single OpenAI-compatible structured provider, owned by the engine because
 * BOTH consumers need it: the CI runner (the GitHub Action runs reviewer-core
 * directly) and the studio server's openrouter path. Centralizing it here means
 * session grouping, the no-choices guard, request timeouts, and the
 * parse-with-repair loop live in ONE place instead of being duplicated.
 *
 * OpenRouter is OpenAI-compatible, so we drive it with the OpenAI SDK pointed at
 * its baseURL. Only completeStructured is needed by reviewPullRequest; the rest
 * are stubs. Cost attribution is INJECTED (`estimateCost`) so the engine stays
 * free of a pricing table — the server passes its own, the runner passes none.
 */

const NOT_SUPPORTED = 'OpenRouterProvider only implements completeStructured';

export interface OpenRouterProviderOptions {
  /** OpenAI-compatible base URL (default: OpenRouter). */
  baseURL?: string;
  /** Provider id for traces/gating (default 'openrouter'). */
  id?: 'openai' | 'openrouter';
  /**
   * Per-request timeout (ms) — the SDK retries on timeout/5xx/429 with backoff.
   * Also the ceiling for `StructuredRequest.timeoutMs`.
   */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected cost estimator; returns USD or null when the model is unknown. */
  estimateCost?: (model: string, tokensIn: number, tokensOut: number) => number | null;
  /** HTTP for the metadata endpoints (generation lookup, model endpoints); tests inject one. */
  fetchImpl?: typeof fetch;
  /** Delay between generation-lookup polls; tests inject one. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock for the generation-lookup deadline; tests inject one. */
  now?: () => number;
  /** Timeout of one generation-lookup read (default `GENERATION_LOOKUP_READ_TIMEOUT_MS`). */
  generationLookupReadTimeoutMs?: number;
}

/**
 * The exact chat-completion body an experiment request sends: also what the
 * studio's preflight serializes to bound the input tokens before dispatch.
 */
export function experimentRequestBody(
  req: Pick<StructuredRequest<unknown>, 'model' | 'messages' | 'schema' | 'schemaName' | 'temperature' | 'sessionId' | 'reasoning'>,
  options: StructuredExperimentOptions,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const jsonSchema = toJsonSchema(req.schema, req.schemaName);
  return {
    model: req.model,
    messages: [...req.messages],
    temperature: req.temperature ?? 0,
    max_tokens: options.maxTokens,
    response_format: {
      type: 'json_schema' as const,
      json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
    },
    ...(req.sessionId ? { session_id: req.sessionId } : {}),
    ...(req.reasoning ? { reasoning: req.reasoning } : {}),
    usage: { include: true },
    provider: {
      order: options.routing.order,
      only: options.routing.only,
      allow_fallbacks: false,
      // Never route to an endpoint that would ignore a parameter of this
      // request (above all the strict json_schema response format): OpenRouter
      // filters such providers out instead of letting them drop it silently.
      require_parameters: true,
    },
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
}

export class OpenRouterProvider implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;
  private timeoutMs: number;
  private estimateCost?: OpenRouterProviderOptions['estimateCost'];
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private lookupReadTimeoutMs: number;

  constructor(apiKey: string, opts: OpenRouterProviderOptions = {}) {
    this.id = opts.id ?? 'openrouter';
    this.apiKey = apiKey;
    this.baseURL = opts.baseURL ?? 'https://openrouter.ai/api/v1';
    this.estimateCost = opts.estimateCost;
    this.timeoutMs = opts.timeoutMs ?? OPENROUTER_DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.lookupReadTimeoutMs = opts.generationLookupReadTimeoutMs ?? GENERATION_LOOKUP_READ_TIMEOUT_MS;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: this.timeoutMs,
      maxRetries: opts.maxRetries ?? 2,
    });
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.experiment) return this.completeExperiment(req);
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let providerCostUsd = 0;
    let hasAnyProviderCost = false;
    let hasCompleteProviderCost = this.id === 'openrouter';
    let lastRaw = '';
    const options = this.requestOptions(req);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      // A cancelled call starts no further (billable) attempt.
      req.signal?.throwIfAborted();
      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: req.model,
        messages,
        temperature: req.temperature ?? 0,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
        },
        // OpenRouter session grouping — extra body field (spread is exempt from
        // excess-property checks). Only sent when talking to OpenRouter.
        ...(this.id === 'openrouter' && req.sessionId ? { session_id: req.sessionId } : {}),
        ...(this.id === 'openrouter' && req.reasoning ? { reasoning: req.reasoning } : {}),
        // OpenRouter usage accounting — ask it to return the REAL generation
        // cost (USD) in `usage.cost`, instead of estimating from a price book.
        ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
      };
      // Request options only when asked for, so existing callers send exactly what they did.
      const res = options
        ? await this.client.chat.completions.create(body, options)
        : await this.client.chat.completions.create(body);

      // OpenRouter can return HTTP 200 with no `choices` (an upstream provider
      // error / moderation / free-tier limit in the body) — surface it.
      const choice = res.choices?.[0];
      if (!choice) {
        const errMsg = (res as unknown as { error?: { message?: string } }).error?.message;
        throw new Error(`OpenRouter returned no choices for ${req.schemaName}${errMsg ? `: ${errMsg}` : ''}`);
      }
      lastRaw = choice.message?.content ?? '';
      tokensIn += res.usage?.prompt_tokens ?? 0;
      tokensOut += res.usage?.completion_tokens ?? 0;
      // `usage.cost` is an OpenRouter extension (USD), absent from the OpenAI SDK type.
      const apiCost = (res.usage as { cost?: number } | null | undefined)?.cost;
      if (typeof apiCost === 'number' && Number.isFinite(apiCost) && apiCost >= 0) {
        providerCostUsd += apiCost;
        hasAnyProviderCost = true;
      } else {
        hasCompleteProviderCost = false;
      }

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          providerCostUsd: hasCompleteProviderCost ? providerCostUsd : null,
          costUsd:
            (hasAnyProviderCost ? providerCostUsd : null) ??
            this.estimateCost?.(req.model, tokensIn, tokensOut) ??
            null,
          raw: lastRaw,
          attempts: attempt,
        };
      }
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({ role: 'user', content: parsed.repromptMessage });
    }
    throw new Error(`OpenRouter structured output failed schema validation for ${req.schemaName}`);
  }

  /**
   * HW2 experiment mode: exactly one HTTP request (SDK retries off, no
   * reprompt), routed to the one frozen provider with fallbacks disabled and
   * router metadata on. Every outcome, including a refusal before dispatch and
   * a thrown error, is reported through `req.onAttempt` before returning or
   * throwing. Provenance comes only from OpenRouter's metadata.
   */
  private async completeExperiment<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const options = req.experiment!;
    const started = Date.now();
    const base: StructuredAttemptTelemetry = {
      sequence: 1,
      dispatch: 'refused',
      outcome: 'refused',
      failureReason: null,
      httpStatus: null,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
      requested: { model: req.model, routing: options.routing, maxTokens: options.maxTokens },
      responseId: null,
      generationIdHeader: null,
      servedModel: null,
      finishReason: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      router: null,
      generation: null,
      routerMetadataRaw: null,
      errorDetail: null,
    };
    const report = (patch: Partial<StructuredAttemptTelemetry>) =>
      req.onAttempt?.({ ...base, ...patch, durationMs: Date.now() - started });

    const problem = this.id !== 'openrouter' ? 'experiment mode needs the OpenRouter provider' : experimentOptionsProblem(options);
    if (problem) {
      report({ failureReason: problem });
      throw new Error(`Experiment request refused before dispatch: ${problem}`);
    }
    if (req.signal?.aborted) {
      report({ outcome: 'cancelled', failureReason: 'cancelled before dispatch' });
      req.signal.throwIfAborted();
    }

    const body = experimentRequestBody(req, options);
    const requestOptions = {
      ...(this.requestOptions(req) ?? {}),
      maxRetries: 0,
      headers: { 'X-OpenRouter-Metadata': 'enabled' },
    };

    let data: OpenAI.Chat.ChatCompletion & { openrouter_metadata?: unknown };
    let headers: Headers | null = null;
    try {
      const result = await this.client.chat.completions.create(body, requestOptions).withResponse();
      data = result.data as typeof data;
      headers = result.response.headers;
    } catch (err) {
      const cancelled = req.signal?.aborted || err instanceof OpenAI.APIUserAbortError;
      const status = err instanceof OpenAI.APIError && typeof err.status === 'number' ? err.status : null;
      // The SDK error carries the raw body and headers: persist only sanitized, allowlisted parts.
      const secrets = [this.apiKey];
      const apiError = err instanceof OpenAI.APIError ? err : null;
      const errorDetail = cancelled
        ? null
        : attemptErrorDetail({
            errorBody: apiError?.error,
            headers: apiError?.headers,
            requestId: (apiError as { requestID?: unknown } | null)?.requestID ?? apiError?.request_id,
            secrets,
          });
      // With an HTTP status the SDK's message can be the JSON of the whole error
      // body (the upstream's raw payload included) or a non-JSON body verbatim,
      // so the reason is rebuilt from the sanitized detail. Without a status the
      // message is the SDK's or runtime's own text. A cancellation records a
      // fixed reason: the error it coincided with may be a provider response.
      const failureReason = cancelled
        ? 'cancelled during the request'
        : status !== null && errorDetail
          ? `${status} ${errorDetail.message ?? 'error without a message'}`
          : (sanitizeText(err instanceof Error ? err.message : null, FAILURE_REASON_MAX, secrets) ?? 'request failed');
      report({
        dispatch: 'dispatched',
        outcome: cancelled ? 'cancelled' : status !== null ? 'http_error' : 'network_error',
        httpStatus: status,
        failureReason,
        errorDetail,
      });
      if (cancelled) {
        // The SDK's abort error carries no status, body or headers. Any other
        // error that coincides with the caller's abort (an HTTP error answered
        // before the abort took effect) may, so it is replaced by the signal's
        // own reason, exactly as a cancellation before dispatch is.
        if (err instanceof OpenAI.APIUserAbortError) throw err;
        req.signal?.throwIfAborted();
        throw new OpenAI.APIUserAbortError();
      }
      throw new ExperimentRequestError(failureReason, status);
    }

    const usage = data.usage as (OpenAI.Completions.CompletionUsage & { cost?: number }) | undefined;
    const apiCost = usage?.cost;
    const cost = typeof apiCost === 'number' && Number.isFinite(apiCost) && apiCost >= 0 ? apiCost : null;
    const choice = data.choices?.[0];
    const responseId = typeof data.id === 'string' ? data.id : null;
    const generationIdHeader = headers?.get('x-generation-id') ?? null;
    const generationId = [responseId, generationIdHeader].find((id): id is string => !!id && GENERATION_ID.test(id)) ?? null;
    const dispatched: Partial<StructuredAttemptTelemetry> = {
      dispatch: 'dispatched',
      httpStatus: 200,
      responseId,
      generationIdHeader,
      servedModel: typeof data.model === 'string' ? data.model : null,
      finishReason: choice?.finish_reason ?? null,
      tokensIn: usage?.prompt_tokens ?? null,
      tokensOut: usage?.completion_tokens ?? null,
      costUsd: cost,
      router: summarizeRouterMetadata(data.openrouter_metadata),
      routerMetadataRaw: data.openrouter_metadata ?? null,
      generation: options.generationLookup
        ? generationId
          ? await this.lookupGeneration(generationId, options.generationLookup, req.signal)
          : emptyGeneration('unavailable')
        : null,
    };

    if (!choice) {
      // An HTTP 200 whose body holds only an `error` (an upstream failure after OpenRouter committed the status).
      const errorDetail = attemptErrorDetail({ errorBody: (data as unknown as { error?: unknown }).error, headers, secrets: [this.apiKey] });
      const reason = `OpenRouter returned no choices for ${req.schemaName}${errorDetail.message ? `: ${errorDetail.message}` : ''}`;
      // A failed generation: no raw `openrouter_metadata`, only bounded identifiers.
      const failed = failedResponseTelemetry(dispatched as StructuredAttemptTelemetry, [this.apiKey]);
      report({ ...dispatched, ...failed, outcome: 'http_error', failureReason: reason, errorDetail });
      throw new ExperimentRequestError(reason, null);
    }
    const raw = choice.message?.content ?? '';
    // A length stop is truncation even if what arrived happens to parse: the
    // answer was cut at the output cap, so it is not a complete review.
    if (choice.finish_reason === 'length') {
      const reason = `output reached the max_tokens cap (finish_reason=length) for ${req.schemaName}; experiment mode does not reprompt`;
      report({ ...dispatched, outcome: 'truncated', failureReason: reason });
      throw new Error(reason);
    }
    const parsed = parseWithRepair(req.schema, raw);
    if (!parsed.ok) {
      const reason = `structured output failed schema validation for ${req.schemaName} (finish_reason=${choice.finish_reason ?? 'unknown'}; experiment mode does not reprompt)`;
      report({ ...dispatched, outcome: 'schema_invalid', failureReason: reason });
      throw new Error(reason);
    }
    report({ ...dispatched, outcome: 'valid' });
    const tokensIn = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    return {
      data: parsed.data,
      model: req.model,
      tokensIn,
      tokensOut,
      providerCostUsd: cost,
      costUsd: cost ?? this.estimateCost?.(req.model, tokensIn, tokensOut) ?? null,
      raw,
      attempts: 1,
    };
  }

  /**
   * Bounded polling of `GET /generation?id=`: metadata reads only, never a
   * generation. The record lags the response by tens of seconds (29–38 s in
   * HW2 Gate 3), so these are read again:
   * - a 404, a 429 or a 5xx;
   * - a timed-out or failed read;
   * - a record that does not list its provider responses yet.
   *
   * Polling stops after `policy.attempts` reads, at `generationLookupDeadlineMs`
   * or on `signal`; any other answer ends it at once. Never throws and never
   * invents a record. The result is one of:
   * - `found`: OpenRouter's own record, with no provider responses if it never
   *   listed any;
   * - `not_found`: the last read was a 404;
   * - `unavailable`: otherwise.
   */
  private async lookupGeneration(
    id: string,
    policy: { attempts: number; delayMs: number },
    signal?: AbortSignal,
  ): Promise<GenerationMetadataSummary> {
    const deadline = this.now() + generationLookupDeadlineMs(policy, this.lookupReadTimeoutMs);
    let found: GenerationMetadataSummary | null = null;
    let missing: 'not_found' | 'unavailable' = 'not_found';
    for (let attempt = 1; attempt <= Math.max(policy.attempts, 1); attempt++) {
      if (attempt > 1) {
        if (this.now() + policy.delayMs >= deadline) break; // never wait past the deadline
        await this.sleep(policy.delayMs);
      }
      const remaining = deadline - this.now();
      if (signal?.aborted || remaining <= 0) break;
      try {
        const timeout = AbortSignal.timeout(Math.min(this.lookupReadTimeoutMs, remaining));
        const res = await this.fetchImpl(`${this.baseURL}/generation?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (res.status === 404) {
          missing = 'not_found'; // metadata can lag the response
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          missing = 'unavailable';
          continue;
        }
        if (!res.ok) return found ?? emptyGeneration('unavailable');
        const summary = summarizeGeneration(await res.json());
        if (summary.status !== 'found') return found ?? summary;
        found = summary;
        if (summary.providerResponses.length > 0) return summary;
      } catch {
        missing = 'unavailable';
      }
    }
    return found ?? emptyGeneration(signal?.aborted ? 'unavailable' : missing);
  }

  /** Per-provider endpoints of `model` with prices and limits (free metadata call). */
  async listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> {
    const res = await this.fetchImpl(`${this.baseURL}/models/${model}/endpoints`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models/${model}/endpoints returned ${res.status}`);
    return parseEndpoints(await res.json());
  }

  /**
   * SDK request options for `timeoutMs` and `signal`. The SDK aborts a request
   * that times out (then retries it) and aborts on `signal` without retrying.
   * The request timeout can shorten the provider's timeout, never extend it, so
   * a caller that already passed a longer `timeoutMs` keeps today's behaviour.
   */
  private requestOptions(req: StructuredRequest<unknown>): { timeout?: number; signal?: AbortSignal } | null {
    const timeout =
      req.timeoutMs !== undefined && req.timeoutMs > 0 ? Math.min(req.timeoutMs, this.timeoutMs) : undefined;
    if (timeout === undefined && !req.signal) return null;
    return { ...(timeout !== undefined ? { timeout } : {}), ...(req.signal ? { signal: req.signal } : {}) };
  }

  /**
   * List models with pricing from the OpenRouter `/models` endpoint (the OpenAI
   * SDK's models.list strips the `pricing` field, so we fetch raw). Prices are
   * converted from per-token to USD per 1M tokens; cheapest output first.
   */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      // OpenRouter uses -1 as a sentinel for variable-priced router pseudo-models
      // (openrouter/auto etc.) — treat negatives as "unknown" so they don't show
      // as $-1000000 and don't sort to the top of the cheapest list.
      const pricing =
        Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
          ? { promptPerM: prompt * 1_000_000, completionPerM: completion * 1_000_000 }
          : null;
      return {
        id: m.id,
        provider: 'openrouter' as const,
        label: m.name ?? null,
        pricing,
        contextLength: m.context_length ?? null,
      };
    });
    return models.sort(
      (a, b) => (a.pricing?.completionPerM ?? Infinity) - (b.pricing?.completionPerM ?? Infinity),
    );
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(NOT_SUPPORTED);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_SUPPORTED);
  }
}
