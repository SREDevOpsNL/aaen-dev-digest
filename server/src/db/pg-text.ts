/**
 * Text Postgres can store. A `text` column rejects U+0000, and a `jsonb`
 * value rejects the `\u0000` escape and unpaired UTF-16 surrogates (which
 * JSON.stringify emits as `\udXXX`). Provider output, prompts and error
 * messages can contain either, and one such character would make a whole
 * terminal transaction roll back. Each is replaced with U+FFFD before a write;
 * hashes recorded in a trace are of the original text.
 */
const INVALID_PG_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function pgSafeText(text: string): string {
  return text.replace(INVALID_PG_TEXT, '�');
}

/** `value` with every string in it (keys included) made storable; plain objects and arrays only. */
export function pgSafeDeep<T>(value: T): T {
  if (typeof value === 'string') return pgSafeText(value) as T;
  if (Array.isArray(value)) return value.map((v) => pgSafeDeep(v)) as T;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[pgSafeText(k)] = pgSafeDeep(v);
    return out as T;
  }
  return value;
}
