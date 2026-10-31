import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Append-only, crash-safe experiment ledger (JSONL, fsync per line) outside
 * any container storage, plus an exclusive runner lock. A slot's reservation
 * is on disk before its request is sent; on restart every slot that was
 * reserved or dispatched without a terminal record is reconciled before any
 * further paid request, and an unresolved one is `ambiguous`: charged at its
 * full reservation and never replayed.
 */

export type SlotState = 'reserved' | 'dispatched' | 'completed' | 'failed' | 'refused' | 'ambiguous';

export interface LedgerEvent {
  at: string;
  slot_id: string;
  state: SlotState;
  phase: 'exploration' | 'confirmatory';
  /** The full worst-case reservation for this slot (USD). */
  reservation_usd: number;
  run_id?: string | null;
  /** Provider-reported cost when known; null = unknown. */
  cost_usd?: number | null;
  detail?: Record<string, unknown>;
  /** The stack that recorded the event (the ledger is shared by every stack). */
  stack_id?: string;
}

export interface SlotRecord {
  slot_id: string;
  state: SlotState;
  phase: LedgerEvent['phase'];
  reservation_usd: number;
  run_id: string | null;
  cost_usd: number | null;
  events: LedgerEvent[];
}

const TERMINAL: ReadonlySet<SlotState> = new Set(['completed', 'failed', 'refused', 'ambiguous']);
export const isTerminal = (state: SlotState) => TERMINAL.has(state);

export class Ledger {
  readonly file: string;
  private readonly lockFile: string;
  private locked = false;

  constructor(readonly dir: string) {
    this.file = join(dir, 'ledger.jsonl');
    this.lockFile = join(dir, 'runner.lock');
  }

  /** Exclusive lock (O_EXCL). A stale lock is never stolen: the operator must investigate it. */
  acquire(owner: { pid: number; stackId: string }): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    let fd: number;
    try {
      fd = openSync(this.lockFile, 'wx', 0o600);
    } catch {
      const holder = existsSync(this.lockFile) ? readFileSync(this.lockFile, 'utf8') : 'unknown';
      throw new Error(`Another runner holds ${this.lockFile} (${holder.trim()}); refusing to spend against the same ledger`);
    }
    writeSync(fd, JSON.stringify({ ...owner, at: new Date().toISOString() }));
    fsyncSync(fd);
    closeSync(fd);
    this.locked = true;
  }

  release(): void {
    if (this.locked) unlinkSync(this.lockFile);
    this.locked = false;
  }

  /** Append one event and fsync it before returning. */
  append(event: Omit<LedgerEvent, 'at'>): LedgerEvent {
    if (!this.locked) throw new Error('Ledger is not locked by this runner');
    const full: LedgerEvent = { at: new Date().toISOString(), ...event };
    const fd = openSync(this.file, 'a', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(full)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return full;
  }

  events(): LedgerEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEvent);
  }

  /** Latest state per slot; a slot never leaves a terminal state. */
  slots(): Map<string, SlotRecord> {
    const records = new Map<string, SlotRecord>();
    for (const event of this.events()) {
      const current = records.get(event.slot_id);
      if (current && isTerminal(current.state)) {
        current.events.push(event); // recorded for audit, does not change the outcome
        continue;
      }
      records.set(event.slot_id, {
        slot_id: event.slot_id,
        state: event.state,
        phase: event.phase,
        reservation_usd: event.reservation_usd,
        run_id: event.run_id ?? current?.run_id ?? null,
        cost_usd: event.cost_usd ?? null,
        events: [...(current?.events ?? []), event],
      });
    }
    return records;
  }

  /** Slots that need reconciliation before any further paid request. */
  unresolved(): SlotRecord[] {
    return [...this.slots().values()].filter((slot) => !isTerminal(slot.state));
  }
}
