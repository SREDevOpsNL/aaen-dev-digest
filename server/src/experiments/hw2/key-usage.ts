import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Independent check of what the dedicated experiment key really spent. The
 * key's own usage, as OpenRouter reports it (`GET /api/v1/key`), is recorded
 * once before the first paid slot (the opening reading) and read again after
 * a phase. Provider reporting can lag, so a settlement reads until the value
 * stops changing; until then the result is `pending`, never a pass. The key
 * itself is never logged or stored, only the usage figures.
 */

export const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';

export interface KeyUsage {
  /** USD spent on the key since it was created. */
  usage: number;
  /** The key's hard limit (USD), or null when it has none. */
  limit: number | null;
  limit_remaining: number | null;
}

export interface KeyUsageRecord extends KeyUsage {
  at: string;
  kind: 'opening' | 'settlement';
  detail?: Record<string, unknown>;
}

/** Read the key's usage; throws with the HTTP status only, never echoing the key. */
export async function readKeyUsage(apiKey: string, fetchImpl: typeof fetch = (...a) => fetch(...a), timeoutMs = 15_000): Promise<KeyUsage> {
  const res = await fetchImpl(KEY_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`OpenRouter key usage request failed with HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { usage?: unknown; limit?: unknown; limit_remaining?: unknown } };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const usage = num(body.data?.usage);
  if (usage === null) throw new Error('OpenRouter key usage response has no numeric usage');
  return { usage, limit: num(body.data?.limit), limit_remaining: num(body.data?.limit_remaining) };
}

/** Append-only log of key-usage readings beside the shared ledger (fsync per line). */
export class KeyUsageLog {
  readonly file: string;
  constructor(readonly dir: string) {
    this.file = join(dir, 'key-usage.jsonl');
  }
  records(): KeyUsageRecord[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as KeyUsageRecord);
  }
  opening(): KeyUsageRecord | null {
    return this.records().find((r) => r.kind === 'opening') ?? null;
  }
  append(record: Omit<KeyUsageRecord, 'at'>): KeyUsageRecord {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const full = { at: new Date().toISOString(), ...record };
    const fd = openSync(this.file, 'a', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(full)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return full;
  }
}

/**
 * Read until `stableReads` consecutive readings agree, within `windowMs`.
 * Returns `settled` with that value, or `pending` with the last reading when
 * the window ends first (or a read keeps failing).
 */
export async function settleKeyUsage(deps: {
  read: () => Promise<KeyUsage>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  stableReads?: number;
  intervalMs?: number;
  windowMs?: number;
}): Promise<{ state: 'settled' | 'pending'; reading: KeyUsage | null; reads: number }> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const stable = deps.stableReads ?? 3;
  const deadline = now() + (deps.windowMs ?? 300_000);
  let last: KeyUsage | null = null;
  let same = 0;
  let reads = 0;
  while (now() <= deadline) {
    const reading = await deps.read().catch(() => null);
    reads++;
    if (reading) {
      same = last && Math.abs(reading.usage - last.usage) < 1e-12 ? same + 1 : 1;
      last = reading;
      if (same >= stable) return { state: 'settled', reading, reads };
    }
    await sleep(deps.intervalMs ?? 30_000);
  }
  return { state: 'pending', reading: last, reads };
}

/**
 * Whether the key's settled usage is explained by the ledger: at least the
 * opening plus every cost the ledger knows, at most the opening plus the
 * conservative total (unknown costs at their full reservation). Anything
 * above means spend the ledger does not account for.
 */
export function keyUsageVerdict(input: { opening: number; observed: number; confirmed: number; conservative: number }): { ok: boolean; reason: string } {
  const eps = 1e-9;
  const delta = input.observed - input.opening;
  if (delta < input.confirmed - eps) {
    return { ok: false, reason: `key usage rose $${delta.toFixed(8)}, less than the $${input.confirmed.toFixed(8)} the ledger confirms (reporting may still lag)` };
  }
  if (delta > input.conservative + eps) {
    return { ok: false, reason: `key usage rose $${delta.toFixed(8)}, more than the conservative ledger total $${input.conservative.toFixed(8)}: unaccounted spend` };
  }
  return { ok: true, reason: `key usage rose $${delta.toFixed(8)}, within [$${input.confirmed.toFixed(8)}, $${input.conservative.toFixed(8)}]` };
}
