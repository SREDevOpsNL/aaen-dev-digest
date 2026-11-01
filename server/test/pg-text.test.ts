import { describe, expect, it } from 'vitest';
import { PG_SAFE_CYCLE_MARKER, PG_SAFE_DEPTH_MARKER, PG_SAFE_MAX_DEPTH, pgSafeDeep, pgSafeText } from '../src/db/pg-text.js';

describe('pgSafeDeep (text Postgres can store)', () => {
  it('replaces U+0000 and unpaired surrogates, keys included, and keeps paired ones', () => {
    expect(pgSafeText('a\u0000b \uD800 c \uDC00 😀')).toBe('a�b � c � 😀');
    expect(pgSafeDeep({ 'k\u0000': ['x\u0000', 1, null, true] })).toEqual({ 'k�': ['x�', 1, null, true] });
  });

  it('is depth-bounded: a pathologically deep value is cut with a marker, never a stack overflow', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 200_000; i++) deep = { next: deep };
    const out = pgSafeDeep({ routerMetadataRaw: deep }) as Record<string, unknown>;
    let node: unknown = out;
    let depth = 0;
    while (node && typeof node === 'object') {
      node = (node as Record<string, unknown>)[depth === 0 ? 'routerMetadataRaw' : 'next'];
      depth++;
    }
    expect(node).toBe(PG_SAFE_DEPTH_MARKER);
    expect(depth).toBe(PG_SAFE_MAX_DEPTH);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('is cycle-safe: a reference back to an ancestor becomes a marker; a shared (non-cyclic) value is kept', () => {
    const shared = { v: 'x' };
    const cyclic: Record<string, unknown> = { a: shared, b: shared };
    cyclic.self = cyclic;
    const out = pgSafeDeep(cyclic) as Record<string, unknown>;
    expect(out.self).toBe(PG_SAFE_CYCLE_MARKER);
    expect(out.a).toEqual({ v: 'x' });
    expect(out.b).toEqual({ v: 'x' });
  });
});
