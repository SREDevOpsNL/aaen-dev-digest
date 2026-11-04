import { describe, it, expect } from 'vitest';
import { RunBus } from '../src/platform/sse.js';

describe('RunBus completion', () => {
  it('buffers but does not emit events published after complete()', () => {
    const bus = new RunBus();
    const seen: string[] = [];
    bus.subscribe('r1', (e) => seen.push(e.msg));

    bus.publish('r1', 'info', 'before');
    bus.complete('r1');
    bus.publish('r1', 'error', 'Run cancelled by user');

    // Live subscribers saw only the pre-completion event…
    expect(seen).toEqual(['before']);
    // …but the persisted trace (built from the buffer) keeps the late line.
    expect(bus.buffer('r1').map((e) => e.msg)).toEqual(['before', 'Run cancelled by user']);
    expect(bus.buffer('r1').map((e) => e.seq)).toEqual([1, 2]);
  });

  it('a late subscriber replays the full buffer and is told the run is done', async () => {
    const bus = new RunBus();
    bus.publish('r2', 'info', 'one');
    bus.complete('r2');
    bus.publish('r2', 'info', 'late');

    const seen: string[] = [];
    bus.subscribe('r2', (e) => seen.push(e.msg));
    const done = await new Promise<boolean>((resolve) => bus.onDone('r2', () => resolve(true)));

    expect(seen).toEqual(['one', 'late']);
    expect(done).toBe(true);
  });

  it('clears the in-memory cancel flag on complete (the database is authoritative)', () => {
    const bus = new RunBus();
    bus.cancel('r3');
    expect(bus.isCancelled('r3')).toBe(true);
    bus.complete('r3');
    expect(bus.isCancelled('r3')).toBe(false);
  });
});
