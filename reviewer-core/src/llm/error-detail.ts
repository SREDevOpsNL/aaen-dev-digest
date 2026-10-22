import type { AttemptErrorDetail, StructuredAttemptTelemetry } from '@devdigest/shared';

/**
 * Minimized, sanitized diagnostics for a failed HW2 experiment request.
 *
 * The OpenAI SDK (v4) parses an error response into `err.error` (the body's
 * inner `error` object), `err.headers` and `err.request_id`. OpenRouter puts
 * its diagnosis in `error.metadata` (`error_type`, `provider_code`,
 * `provider_name`, `limit_source`, and sometimes `raw`, the upstream's
 * verbatim payload). Only fixed, allowlisted fields are read; nothing is
 * walked recursively or serialized, every value is bounded, and free text has
 * secrets (including the request's own key) redacted. `raw` is never kept.
 */

const MESSAGE_MAX = 300;
const TOKEN_MAX = 64;
const REQUEST_ID_MAX = 128;
/** Free text is cut to this length before any pattern runs, so input size cannot slow redaction. */
const SCAN_MAX = 2_000;
/** Header names kept from an error response; everything else is dropped. */
export const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
] as const;

const REDACTED = '[redacted]';
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(api[_-]?key|access[_-]?token|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, `$1$2${REDACTED}`],
  [/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/g, `$1?${REDACTED}`],
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, REDACTED],
];
/** Characters allowed in identifiers, codes, names and header values. */
const TOKEN = /^[A-Za-z0-9 ._:/()+,-]+$/;

type Bag = { redacted: boolean };

/** Property read that survives getters that throw and non-object inputs. */
function get(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function header(headers: unknown, name: string): unknown {
  if (headers === null || headers === undefined) return undefined;
  try {
    const getter = get(headers, 'get');
    if (typeof getter === 'function') return (getter as (n: string) => unknown).call(headers, name);
  } catch {
    return undefined;
  }
  return get(headers, name);
}

/**
 * Free text made safe to persist: control characters removed, secrets and the
 * given exact values redacted, whitespace collapsed, at most `max` characters.
 */
export function sanitizeText(value: unknown, max: number, secrets: readonly string[] = [], bag: Bag = { redacted: false }): string | null {
  if (typeof value !== 'string') return null;
  let text = value.length > SCAN_MAX ? value.slice(0, SCAN_MAX) : value;
  if (text.length !== value.length) bag.redacted = true;
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      text = text.split(secret).join(REDACTED);
      bag.redacted = true;
    }
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    const next = text.replace(pattern, replacement);
    if (next !== text) bag.redacted = true;
    text = next;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > max) {
    text = `${text.slice(0, max - 1)}…`;
    bag.redacted = true;
  }
  return text.length > 0 ? text : null;
}

/** A key-like value inside an identifier: an `sk-` key, a bearer credential, or one of `secrets`. */
function looksSecret(text: string, secrets: readonly string[]): boolean {
  return /\bsk-[A-Za-z0-9_-]{8,}/.test(text) || /bearer/i.test(text) || secrets.some((s) => s.length >= 8 && text.includes(s));
}

/** A code, name, id or header value: kept only when short, plain and not key-like, otherwise dropped. */
function token(value: unknown, max: number, secrets: readonly string[], bag: Bag): string | null {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : null;
  if (text === null || text.length === 0) return null;
  if (text.length > max || !TOKEN.test(text) || looksSecret(text, secrets)) {
    bag.redacted = true;
    return null;
  }
  return text;
}

function code(value: unknown, secrets: readonly string[], bag: Bag): number | string | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value < 10_000 ? value : null;
  return token(value, TOKEN_MAX, secrets, bag);
}

/** `error.message` when it is text; anything else present is dropped, and flagged. */
function messageOf(body: object | null, secrets: readonly string[], bag: Bag): string | null {
  const value = get(body, 'message');
  const text = sanitizeText(value, MESSAGE_MAX, secrets, bag);
  if (text === null && value !== undefined && value !== null && value !== '') bag.redacted = true;
  return text;
}

/**
 * The diagnostics of one failed request. `errorBody` is the inner `error`
 * object (the SDK's `err.error`, or `body.error` of an HTTP 200), `headers`
 * the response headers, `requestId` the SDK's request id. Never throws.
 */
export function attemptErrorDetail(input: {
  errorBody?: unknown;
  headers?: unknown;
  requestId?: unknown;
  /** Exact values that must never be persisted (the request's API key). */
  secrets?: readonly string[];
}): AttemptErrorDetail {
  const secrets = (input.secrets ?? []).filter((s): s is string => typeof s === 'string');
  const bag: Bag = { redacted: false };
  try {
    const body = input.errorBody !== null && typeof input.errorBody === 'object' ? input.errorBody : null;
    const metadata = get(body, 'metadata');
    const meta = metadata !== null && typeof metadata === 'object' ? metadata : null;
    const providerName = token(get(meta, 'provider_name'), TOKEN_MAX, secrets, bag);
    const providerCode = token(get(meta, 'provider_code'), TOKEN_MAX, secrets, bag);
    const limitSource = token(get(meta, 'limit_source'), TOKEN_MAX, secrets, bag);
    const rateLimit: Record<string, string> = {};
    for (const name of RATE_LIMIT_HEADERS) {
      const value = token(header(input.headers, name), TOKEN_MAX, secrets, bag);
      if (value !== null) rateLimit[name] = value;
    }
    const requestId = token(input.requestId ?? header(input.headers, 'x-request-id'), REQUEST_ID_MAX, secrets, bag);
    return {
      origin:
        providerName !== null || providerCode !== null
          ? 'upstream_provider'
          : limitSource?.startsWith('openrouter_')
            ? 'openrouter'
            : body
              ? 'unattributed'
              : 'no_body',
      code: code(get(body, 'code'), secrets, bag),
      message: messageOf(body, secrets, bag),
      errorType: token(get(meta, 'error_type'), TOKEN_MAX, secrets, bag),
      providerCode,
      providerName,
      limitSource,
      upstreamRawPresent: get(meta, 'raw') !== undefined && get(meta, 'raw') !== null,
      requestId,
      retryAfter: token(header(input.headers, 'retry-after'), TOKEN_MAX, secrets, bag),
      rateLimit,
      redacted: bag.redacted,
    };
  } catch {
    return emptyErrorDetail();
  }
}

/**
 * The telemetry of an HTTP 200 that carried no generation, only an `error`
 * body. The response and its `openrouter_metadata` describe a failure, so
 * nothing arbitrary from them is kept:
 * - no raw `openrouter_metadata`;
 * - ids, model names, provider names and strategies only as bounded, plain
 *   tokens (an unsafe one becomes null, or `[redacted]` where a string is
 *   required);
 * - counts and costs only as finite, non-negative numbers.
 * Never throws. A successful generation keeps its telemetry unchanged.
 */
export function failedResponseTelemetry(
  t: Pick<StructuredAttemptTelemetry, 'responseId' | 'generationIdHeader' | 'servedModel' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'router' | 'generation'>,
  secrets: readonly string[] = [],
): Pick<StructuredAttemptTelemetry, 'responseId' | 'generationIdHeader' | 'servedModel' | 'finishReason' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'router' | 'generation' | 'routerMetadataRaw'> {
  const bag: Bag = { redacted: false };
  const tok = (value: unknown, max = TOKEN_MAX) => token(value, max, secrets, bag);
  const required = (value: unknown) => tok(value) ?? REDACTED;
  const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);
  const usd = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
  try {
    const router = t.router;
    const generation = t.generation;
    return {
      routerMetadataRaw: null,
      responseId: tok(t.responseId, REQUEST_ID_MAX),
      generationIdHeader: tok(t.generationIdHeader, REQUEST_ID_MAX),
      servedModel: tok(t.servedModel),
      finishReason: null,
      tokensIn: count(t.tokensIn),
      tokensOut: count(t.tokensOut),
      costUsd: usd(t.costUsd),
      router: router
        ? {
            selected: (Array.isArray(router.selected) ? router.selected : []).map((s) => ({ provider: required(get(s, 'provider')), model: required(get(s, 'model')) })),
            attempt: count(router.attempt),
            attemptsCount: count(router.attemptsCount),
            requested: tok(router.requested),
            strategy: tok(router.strategy),
          }
        : null,
      generation: generation
        ? {
            status: generation.status === 'found' || generation.status === 'not_found' ? generation.status : 'unavailable',
            providerName: tok(generation.providerName),
            model: tok(generation.model),
            finishReason: tok(generation.finishReason),
            tokensPrompt: count(generation.tokensPrompt),
            tokensCompletion: count(generation.tokensCompletion),
            totalCost: usd(generation.totalCost),
            providerResponses: (Array.isArray(generation.providerResponses) ? generation.providerResponses : []).map((r) => ({
              providerName: tok(get(r, 'providerName')),
              endpointId: tok(get(r, 'endpointId'), REQUEST_ID_MAX),
              modelPermaslug: tok(get(r, 'modelPermaslug')),
              status: count(get(r, 'status')),
            })),
          }
        : null,
    };
  } catch {
    return { routerMetadataRaw: null, responseId: null, generationIdHeader: null, servedModel: null, finishReason: null, tokensIn: null, tokensOut: null, costUsd: null, router: null, generation: null };
  }
}

/** The detail when nothing could be read safely. */
export function emptyErrorDetail(): AttemptErrorDetail {
  return {
    origin: 'no_body',
    code: null,
    message: null,
    errorType: null,
    providerCode: null,
    providerName: null,
    limitSource: null,
    upstreamRawPresent: false,
    requestId: null,
    retryAfter: null,
    rateLimit: {},
    redacted: true,
  };
}

/**
 * The error an experiment request throws in place of the SDK's: only a
 * sanitized message and the HTTP status, so the raw body and headers the SDK
 * error carries never reach a run row, a trace, a log or a report.
 */
export class ExperimentRequestError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ExperimentRequestError';
    this.status = status ?? undefined;
  }
}
