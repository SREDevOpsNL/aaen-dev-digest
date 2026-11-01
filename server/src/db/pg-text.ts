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

/** Nesting below which a trace value is replaced instead of walked. */
export const PG_SAFE_MAX_DEPTH = 64;
export const PG_SAFE_DEPTH_MARKER = '[omitted: nested too deep]';
export const PG_SAFE_CYCLE_MARKER = '[omitted: circular reference]';

/**
 * `value` with every string in it (keys included) made storable; plain
 * objects and arrays only. Bounded and cycle-safe: a value nested deeper than
 * PG_SAFE_MAX_DEPTH, or one that refers back to an ancestor, is replaced with
 * a marker string, so provider metadata of any shape cannot overflow the
 * stack (and fail the write, and its retry).
 */
export function pgSafeDeep<T>(value: T): T {
  return walk(value, 0, new Set()) as T;
}

function walk(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (typeof value === 'string') return pgSafeText(value);
  const container = Array.isArray(value) || (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  if (!container) return value;
  const obj = value as object;
  if (ancestors.has(obj)) return PG_SAFE_CYCLE_MARKER;
  if (depth >= PG_SAFE_MAX_DEPTH) return PG_SAFE_DEPTH_MARKER;
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((v) => walk(v, depth + 1, ancestors));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[pgSafeText(k)] = walk(v, depth + 1, ancestors);
    return out;
  } finally {
    ancestors.delete(obj);
  }
}
