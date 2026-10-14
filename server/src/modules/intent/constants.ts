/** Per-request classifier timeout: each provider HTTP request is aborted after this. */
export const INTENT_TIMEOUT_MS = 30_000;
/**
 * Extra margin for the whole derivation's deadline (retries included). At the
 * deadline the service aborts the in-flight request, not just stops waiting.
 */
export const INTENT_TIMEOUT_MARGIN_MS = 5_000;
/** One structured-output retry; a slow or failing classifier must not delay reviews for long. */
export const INTENT_MAX_RETRIES = 1;
/** Generation endpoints can bill a model call; GET never does. */
export const INTENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
