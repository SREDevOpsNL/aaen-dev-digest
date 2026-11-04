import { createHash } from 'node:crypto';
import { safeIdentifier } from './lifecycle.js';

/** Bound on the partial text a ProviderOutputError carries (UTF-8 bytes). */
export const PARTIAL_OUTPUT_MAX_BYTES = 16 * 1024;

/** `text` cut to at most `maxBytes` UTF-8 bytes, never inside a character. */
export function boundUtf8(text: string, maxBytes: number): { text: string; totalBytes: number; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, totalBytes: bytes.length, truncated: false };
  let end = Math.max(0, maxBytes);
  // Back off continuation bytes (10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString('utf8'), totalBytes: bytes.length, truncated: true };
}

export interface ProviderOutputUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  /** Provider-reported USD cost; null when not reported (never 0 for unknown). */
  costUsd: number | null;
}

/**
 * A provider answered, but its output is not a usable review: it was cut at
 * the output cap (`truncated`) or failed schema validation (`schema_invalid`).
 *
 * It carries what the response actually reported, so a caller can record the
 * failure honestly: the bounded partial text, the usage, the finish reason and
 * the response id. The partial text is evidence only and must never be parsed
 * into findings.
 *
 * The evidence fields are non-enumerable, so a structured logger that
 * serializes the error object (pino's `err` serializer copies enumerable
 * properties) writes the message, never the partial text. The message is the
 * same text the plain Error carried before.
 */
export class ProviderOutputError extends Error {
  declare readonly kind: 'truncated' | 'schema_invalid';
  declare readonly partialText: string;
  declare readonly partialTotalBytes: number;
  declare readonly partialSha256: string;
  declare readonly usage: ProviderOutputUsage;
  declare readonly finishReason: string | null;
  declare readonly responseId: string | null;
  /** Structured attempts the adapter made for this request (reprompts included). */
  declare readonly attempts: number;

  constructor(
    message: string,
    evidence: {
      kind: 'truncated' | 'schema_invalid';
      text: string;
      usage: ProviderOutputUsage;
      /** Provider-controlled: kept only when it is a plain token (`safeIdentifier`). */
      finishReason: unknown;
      responseId: unknown;
      attempts: number;
    },
  ) {
    super(message);
    this.name = 'ProviderOutputError';
    const bounded = boundUtf8(evidence.text, PARTIAL_OUTPUT_MAX_BYTES);
    const hidden = (value: unknown) => ({ value, enumerable: false, writable: false, configurable: false });
    Object.defineProperties(this, {
      kind: hidden(evidence.kind),
      partialText: hidden(bounded.text),
      partialTotalBytes: hidden(bounded.totalBytes),
      partialSha256: hidden(createHash('sha256').update(evidence.text, 'utf8').digest('hex')),
      usage: hidden({ ...evidence.usage }),
      finishReason: hidden(safeIdentifier(evidence.finishReason)),
      responseId: hidden(safeIdentifier(evidence.responseId)),
      attempts: hidden(evidence.attempts),
    });
  }

  /** Whether the carried text is a prefix of the full output (the full output exceeded the bound). */
  get partialTruncated(): boolean {
    return Buffer.byteLength(this.partialText, 'utf8') < this.partialTotalBytes;
  }
}

/**
 * A review the engine refuses to start, before any provider request: a
 * configuration it cannot honour (e.g. experiment mode with a strategy that
 * would make more than one request). `code` is stable for traces.
 */
export class ReviewRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewRefusedError';
  }
}
