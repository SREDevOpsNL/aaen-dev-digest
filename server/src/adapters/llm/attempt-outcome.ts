import type { AttemptOutcome } from '@devdigest/reviewer-core';
import { TimeoutError } from '../../platform/resilience.js';

/** The HTTP status an SDK error carries, else null. Never reads the error's message or body. */
export function httpStatusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

/**
 * How a provider request that produced no usable response ended, from the
 * error's type and status only (its message can carry upstream text).
 */
export function transportOutcome(err: unknown): AttemptOutcome {
  if (err instanceof TimeoutError) return 'timeout';
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'APIUserAbortError' || name === 'AbortError') return 'cancelled';
  if (name === 'APIConnectionTimeoutError') return 'timeout';
  return httpStatusOf(err) !== null ? 'http_error' : 'network_error';
}
