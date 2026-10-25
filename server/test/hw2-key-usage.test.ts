import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_ENDPOINT, KeyUsageLog, keyUsageVerdict, readKeyUsage, settleKeyUsage, type KeyUsage } from '../src/experiments/hw2/key-usage.js';

/**
 * The dedicated key's own usage is the independent check of the ledger:
 * recorded once before the first paid slot, settled after a phase. Reporting
 * can lag, so a settlement that never stops changing is `pending`, not a pass.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const KEY = 'sk-or-v1-' + 'a'.repeat(48);
const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('reading the key usage', () => {
  it('reads usage, limit and remaining from GET /api/v1/key with the key as a bearer token', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: new Headers(init?.headers).get('authorization') };
      return new Response(JSON.stringify({ data: { usage: 0.00040788, limit: 2, limit_remaining: 1.99959212, label: 'hw2' } }));
    }) as unknown as typeof fetch;
    expect(await readKeyUsage(KEY, fetchImpl)).toEqual({ usage: 0.00040788, limit: 2, limit_remaining: 1.99959212 });
    expect(seen).toEqual({ url: KEY_ENDPOINT, auth: `Bearer ${KEY}` });
  });

  it('fails with the status only, never echoing the key', async () => {
    const err = await readKeyUsage(KEY, respond(401, { error: { message: `bad key ${KEY}` } })).catch((e: Error) => e);
    expect((err as Error).message).toBe('OpenRouter key usage request failed with HTTP 401');
    expect((err as Error).message).not.toContain(KEY);
    await expect(readKeyUsage(KEY, respond(200, { data: {} }))).rejects.toThrow(/no numeric usage/);
  });
});

describe('settling the key usage (provider reporting can lag)', () => {
  const series = (values: number[]) => {
    let i = 0;
    return async (): Promise<KeyUsage> => ({ usage: values[Math.min(i++, values.length - 1)]!, limit: 2, limit_remaining: null });
  };
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it('is settled once three consecutive reads agree', async () => {
    const c = clock();
    const result = await settleKeyUsage({ read: series([0.1, 0.10021, 0.10021, 0.10021]), ...c, intervalMs: 1000, windowMs: 60_000 });
    expect(result).toMatchObject({ state: 'settled', reading: { usage: 0.10021 }, reads: 4 });
  });

  it('stays pending while the value keeps moving within the window', async () => {
    const c = clock();
    const result = await settleKeyUsage({ read: series([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), ...c, intervalMs: 1000, windowMs: 4000 });
    expect(result.state).toBe('pending');
  });

  it('a read that keeps failing is pending, never settled', async () => {
    const c = clock();
    const result = await settleKeyUsage({ read: async () => Promise.reject(new Error('down')), ...c, intervalMs: 1000, windowMs: 3000 });
    expect(result).toMatchObject({ state: 'pending', reading: null });
  });
});

describe('verdict: is the key usage explained by the ledger?', () => {
  const opening = 0.00040788;
  it('passes between opening + confirmed and opening + conservative', () => {
    expect(keyUsageVerdict({ opening, observed: opening + 0.0004, confirmed: 0.0004, conservative: 0.0204 }).ok).toBe(true);
    expect(keyUsageVerdict({ opening, observed: opening + 0.0204, confirmed: 0.0004, conservative: 0.0204 }).ok).toBe(true);
  });
  it('fails above the conservative total: spend the ledger does not account for', () => {
    const v = keyUsageVerdict({ opening, observed: opening + 0.03, confirmed: 0.0004, conservative: 0.0204 });
    expect(v).toMatchObject({ ok: false });
    expect(v.reason).toMatch(/unaccounted spend/);
  });
  it('fails below the confirmed costs (reporting has not caught up)', () => {
    expect(keyUsageVerdict({ opening, observed: opening + 0.0001, confirmed: 0.0004, conservative: 0.0204 }).reason).toMatch(/may still lag/);
  });
});

describe('key-usage log', () => {
  it('appends readings (mode 0600) and finds the opening one', () => {
    const d = mkdtempSync(join(tmpdir(), 'hw2-keylog-'));
    dirs.push(d);
    const log = new KeyUsageLog(d);
    expect(log.opening()).toBeNull();
    log.append({ kind: 'opening', usage: 0.1, limit: 2, limit_remaining: 1.9 });
    log.append({ kind: 'settlement', usage: 0.2, limit: 2, limit_remaining: 1.8 });
    expect(log.opening()).toMatchObject({ kind: 'opening', usage: 0.1 });
    expect(log.records()).toHaveLength(2);
    expect(statSync(log.file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(log.records())).not.toContain('sk-or');
  });
});
