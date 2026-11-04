import { sanitizeErrorText } from '@devdigest/reviewer-core';
import type { SecretsProvider } from '@devdigest/shared';

/** Bound on an error message persisted in agent_runs.error, a trace or a refusal reason. */
export const ERROR_TEXT_MAX = 500;

/**
 * An error's message as a run record, stream or log may show it: credential
 * shapes, control characters and the configured keys (`secrets`, any shape)
 * redacted, at most `max` characters. Never throws: a message getter that
 * throws, or a non-string message, yields a fixed text, so a terminal write
 * can never be skipped because of the error it records.
 */
export function errorText(err: unknown, secrets: readonly string[] = [], max: number = ERROR_TEXT_MAX): string {
  try {
    return sanitizeErrorText((err as { message?: unknown } | null)?.message, max, secrets) ?? 'error without a message';
  } catch {
    return 'error whose message could not be read';
  }
}

/** The configured provider and GitHub keys that error text must never carry. */
const REDACTED_SECRET_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_PAT'] as const;

/**
 * The configured key values, for redaction only: never logged, streamed or
 * persisted. A key that cannot be read is skipped (the credential patterns
 * still apply).
 */
export async function configuredSecrets(secrets: SecretsProvider): Promise<string[]> {
  const values: string[] = [];
  for (const key of REDACTED_SECRET_KEYS) {
    try {
      const value = await secrets.get(key);
      if (typeof value === 'string' && value.length >= 8) values.push(value);
    } catch {
      // unreadable: nothing to redact by value
    }
  }
  return values;
}
