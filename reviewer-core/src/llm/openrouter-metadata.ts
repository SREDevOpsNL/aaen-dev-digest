/**
 * Pure parsers for OpenRouter's own provenance metadata, used by the HW2
 * experiment mode of OpenRouterProvider. Nothing here infers a provider from
 * the request: a field the response did not carry stays null.
 *
 * Shapes follow OpenRouter's API reference (chat completion `openrouter_metadata`
 * with `X-OpenRouter-Metadata: enabled`; `GET /generation?id=`; model endpoints).
 * Exploration (Gate 3) confirms the live shapes before anything is frozen.
 */
import type {
  GenerationMetadataSummary,
  OpenRouterEndpointInfo,
  RouterMetadataSummary,
  StructuredExperimentOptions,
} from '@devdigest/shared';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Generation ids as `/generation?id=` accepts them. */
export const GENERATION_ID = /^gen-[0-9A-Za-z-]+$/;

/** Summarize `openrouter_metadata`; null when the response carried none. */
export function summarizeRouterMetadata(raw: unknown): RouterMetadataSummary | null {
  if (!isObject(raw)) return null;
  const endpoints = isObject(raw.endpoints) ? raw.endpoints : null;
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available
    .filter((entry): entry is Json => isObject(entry) && entry.selected === true)
    .map((entry) => ({ provider: str(entry.provider) ?? '', model: str(entry.model) ?? '' }));
  return {
    selected,
    attempt: num(raw.attempt),
    attemptsCount: Array.isArray(raw.attempts) ? raw.attempts.length : null,
    requested: str(raw.requested),
    strategy: str(raw.strategy),
  };
}

/** Summarize a `GET /generation` body (`{ data: {...} }`). */
export function summarizeGeneration(body: unknown): GenerationMetadataSummary {
  const data = isObject(body) && isObject(body.data) ? body.data : null;
  if (!data) return emptyGeneration('unavailable');
  const responses = Array.isArray(data.provider_responses) ? data.provider_responses : [];
  return {
    status: 'found',
    providerName: str(data.provider_name),
    model: str(data.model),
    finishReason: str(data.finish_reason),
    tokensPrompt: num(data.tokens_prompt),
    tokensCompletion: num(data.tokens_completion),
    totalCost: num(data.total_cost),
    providerResponses: responses.filter(isObject).map((entry) => ({
      providerName: str(entry.provider_name),
      endpointId: str(entry.endpoint_id),
      modelPermaslug: str(entry.model_permaslug),
      status: num(entry.status),
    })),
  };
}

export function emptyGeneration(status: 'not_found' | 'unavailable'): GenerationMetadataSummary {
  return {
    status,
    providerName: null,
    model: null,
    finishReason: null,
    tokensPrompt: null,
    tokensCompletion: null,
    totalCost: null,
    providerResponses: [],
  };
}

/** Parse `GET /models/{author}/{slug}/endpoints` (prices are USD-per-token strings). */
export function parseEndpoints(body: unknown): OpenRouterEndpointInfo[] {
  const data = isObject(body) && isObject(body.data) ? body.data : null;
  const endpoints = Array.isArray(data?.endpoints) ? data.endpoints : [];
  return endpoints.filter(isObject).flatMap((entry) => {
    const pricing = isObject(entry.pricing) ? entry.pricing : null;
    const prompt = num(pricing?.prompt);
    const completion = num(pricing?.completion);
    const providerName = str(entry.provider_name);
    if (!providerName || prompt === null || completion === null || prompt < 0 || completion < 0) return [];
    return [
      {
        providerName,
        tag: str(entry.tag),
        quantization: str(entry.quantization),
        contextLength: num(entry.context_length),
        maxCompletionTokens: num(entry.max_completion_tokens),
        pricing: { prompt, completion, request: Math.max(num(pricing?.request) ?? 0, 0) },
      },
    ];
  });
}

/**
 * Why an experiment request must be refused before dispatch, or null when it
 * is well formed: zero retries in both layers, exactly one frozen provider in
 * `order` and `only`, fallbacks off, a positive output bound, metadata on.
 */
export function experimentOptionsProblem(options: StructuredExperimentOptions): string | null {
  if (typeof options.slotId !== 'string' || options.slotId.length === 0) return 'an experiment slot id is required';
  if (options.transportMaxRetries !== 0) return 'transport retries must be 0';
  if (options.maxRetries !== 0) return 'structured-output retries must be 0';
  const { order, only, allowFallbacks } = options.routing;
  if (order.length !== 1 || !order[0]) return 'provider.order must hold exactly one provider';
  if (only.length !== 1 || only[0] !== order[0]) return 'provider.only must equal the one-item provider.order';
  if (allowFallbacks !== false) return 'provider fallbacks must be disabled';
  if (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0) return 'maxTokens must be a positive integer';
  if (options.routerMetadata !== true) return 'router metadata must be requested';
  return null;
}
