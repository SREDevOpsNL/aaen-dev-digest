import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StructuredAttemptTelemetry } from '@devdigest/shared';

export type ReceiptState = 'claimed' | 'dispatching' | 'model_finished' | 'model_result' | 'persisted' | 'failed';
export interface ExtractionReceiptEvent {
  at: string;
  state: ReceiptState;
  capability_id: string;
  slot_id: string;
  request_sha256: string;
  attempt?: Omit<StructuredAttemptTelemetry, 'routerMetadataRaw'>;
  cost_usd?: number | null;
  candidate_ids?: string[];
  candidate_digest?: string;
  model_result?: unknown;
  model_raw?: string;
  reason?: string;
}

const SLOT = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** Append-only operation evidence, separate from the authoritative global spending ledger. */
export class ExtractionReceipts {
  readonly dir: string;

  constructor(root = join(homedir(), '.devdigest', 'hw2-experiments')) {
    this.dir = join(root, 'conventions-receipts');
  }

  private path(slotId: string): string {
    if (!SLOT.test(slotId)) throw new Error('Invalid extraction slot id');
    return join(this.dir, `${slotId}.jsonl`);
  }

  private ensureDir(): void {
    const parent = join(this.dir, '..');
    for (const dir of [parent, this.dir]) {
      if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
      if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) {
        throw new Error('Receipt directory must be a real private directory');
      }
    }
  }

  private write(path: string, event: ExtractionReceiptEvent, exclusive: boolean): void {
    const flags = (exclusive ? constants.O_CREAT | constants.O_EXCL : constants.O_APPEND) |
      constants.O_WRONLY | constants.O_NOFOLLOW;
    const fd = openSync(path, flags, 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new Error('Receipt path is not a regular file');
      writeSync(fd, `${JSON.stringify(event)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const dirFd = openSync(this.dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  }

  /** Exclusive, durable claim before any model request. Existing/symlinked paths always refuse replay. */
  claim(binding: { capability_id: string; slot_id: string; request_sha256: string }): void {
    this.ensureDir();
    this.write(this.path(binding.slot_id), { at: new Date().toISOString(), state: 'claimed', ...binding }, true);
  }

  append(slotId: string, event: Omit<ExtractionReceiptEvent, 'at' | 'slot_id'>): void {
    const current = this.read(slotId);
    if (current.length === 0) throw new Error('Missing receipt claim');
    if (current[0]!.capability_id !== event.capability_id ||
        current[0]!.request_sha256 !== event.request_sha256) throw new Error('Receipt binding mismatch');
    if (current.some((item) => item.state === 'persisted' || item.state === 'failed')) {
      throw new Error('Receipt is terminal');
    }
    this.write(this.path(slotId), { at: new Date().toISOString(), slot_id: slotId, ...event }, false);
  }

  read(slotId: string): ExtractionReceiptEvent[] {
    const path = this.path(slotId);
    if (!existsSync(path)) return [];
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe receipt path');
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as ExtractionReceiptEvent);
  }
}

/** Never persist the unbounded router payload; the provider summary and sanitized error are retained. */
export function receiptAttempt(attempt: StructuredAttemptTelemetry): Omit<StructuredAttemptTelemetry, 'routerMetadataRaw'> {
  const { routerMetadataRaw: _raw, ...safe } = attempt;
  return safe;
}
