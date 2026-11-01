import { afterEach, describe, expect, it } from 'vitest';
import { canScanProcesses, leftovers, ProcessOwner } from './helpers/owned-process.js';

/**
 * The ownership helper behind the crash-recovery tests: every child it
 * starts is reaped, whatever way the test ends, and nothing carrying its
 * marker survives. Plain node children (no tsx, no network).
 */
const node = process.execPath;
const forever = `console.log('ready'); setInterval(() => {}, 1000);`;

let owner = new ProcessOwner();
afterEach(async () => {
  await owner.cleanupAll();
  expect(await owner.settledLeftovers()).toEqual([]);
  owner = new ProcessOwner();
});

describe('ProcessOwner', () => {
  it('can see its own children on this host (otherwise every leftover check below is vacuous)', async () => {
    if (!canScanProcesses()) return; // no /proc: leftovers() reports nothing, by design
    const c = owner.spawn(node, ['-e', forever]);
    await c.ready('ready');
    expect(owner.leftovers()).toEqual([c.pid]);
    // Another owner's marker does not match it.
    expect(leftovers(new ProcessOwner().marker)).toEqual([]);
  });

  it('normal completion: the child exits on its own and cleanup has nothing to do', async () => {
    const c = owner.spawn(node, ['-e', `console.log('ready'); process.exitCode = 0;`]);
    await c.ready('ready');
    expect(await c.exited).toEqual({ code: 0, signal: null });
    expect(c.hasExited()).toBe(true);
    // Killing an exited child sends nothing and returns its recorded exit.
    expect(await c.kill()).toEqual({ code: 0, signal: null });
    await owner.cleanupAll();
    expect(owner.leftovers()).toEqual([]);
  });

  it('an assertion failure in the test body: the finally still kills the child', async () => {
    const local = new ProcessOwner();
    let pid: number | undefined;
    const body = async () => {
      const c = local.spawn(node, ['-e', forever]);
      pid = c.pid;
      await c.ready('ready');
      expect(c.output()).toContain('a line the child never prints');
    };
    await expect(
      (async () => {
        try {
          await body();
        } finally {
          await local.cleanupAll();
        }
      })(),
    ).rejects.toThrow(/a line the child never prints/);
    expect(pid).toBeTypeOf('number');
    expect(await local.settledLeftovers()).toEqual([]);
  });

  it('a timeout: a child that never exits is killed by cleanup within the bound', async () => {
    const c = owner.spawn(node, ['-e', `setInterval(() => {}, 1000);`]);
    await expect(c.ready('never printed', 300)).rejects.toThrow(/printed no "never printed" within 300 ms/);
    expect(c.hasExited()).toBe(false);
    const start = Date.now();
    await owner.cleanupAll(2_000);
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(await c.exited).toEqual({ code: null, signal: 'SIGKILL' });
    expect(await owner.settledLeftovers()).toEqual([]);
  });

  describe('a real vitest timeout', () => {
    let timedOut: { marker: string; pid: number | undefined } | undefined;
    it.fails('the test times out while its child runs', async () => {
      const c = owner.spawn(node, ['-e', forever]);
      timedOut = { marker: owner.marker, pid: c.pid };
      await c.ready('ready');
      await new Promise(() => {}); // never settles: vitest's timeout ends the test
    }, 1_000);
    it('afterEach reaped the timed-out test\'s child', () => {
      expect(timedOut?.pid).toBeTypeOf('number');
      expect(leftovers(timedOut!.marker)).toEqual([]);
    });
  });

  it('a child that ignores SIGTERM: kill() reports the missed bound instead of hanging, and cleanup still reaps it', async () => {
    const c = owner.spawn(node, ['-e', `process.on('SIGTERM', () => {}); ${forever}`]);
    await c.ready('ready');
    await expect(c.kill('SIGTERM', 300)).rejects.toThrow(/did not exit within 300 ms of SIGTERM/);
    await owner.cleanupAll();
    expect(await c.exited).toEqual({ code: null, signal: 'SIGKILL' });
  });

  it('an interrupted child: killed from outside mid-run, it is reaped without error', async () => {
    const c = owner.spawn(node, ['-e', forever]);
    await c.ready('ready');
    process.kill(c.pid!, 'SIGKILL'); // the child this test started, by its own pid
    expect(await c.exited).toEqual({ code: null, signal: 'SIGKILL' });
    await expect(owner.cleanupAll()).resolves.toBeUndefined();
    expect(await owner.settledLeftovers()).toEqual([]);
  });

  it('parent cancellation: aborting the signal kills the child', async () => {
    const ac = new AbortController();
    const c = owner.spawn(node, ['-e', forever], { signal: ac.signal });
    await c.ready('ready');
    ac.abort();
    expect(await c.exited).toEqual({ code: null, signal: 'SIGKILL' });
    // Already aborted before the spawn: the child is killed at once.
    const late = owner.spawn(node, ['-e', forever], { signal: ac.signal });
    expect((await late.exited).signal).toBe('SIGKILL');
    expect(await owner.settledLeftovers()).toEqual([]);
  });

  it('partial startup failure: a child that exits before its ready line is reported, not waited on', async () => {
    const c = owner.spawn(node, ['-e', `process.stderr.write('config missing'); process.exit(3);`]);
    const start = Date.now();
    await expect(c.ready('ready', 20_000)).rejects.toThrow(/exited \(code 3, signal null\) before "ready": config missing/);
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(await owner.settledLeftovers()).toEqual([]);
  });

  it('a command that cannot start is reported and cleanup does not hang', async () => {
    const c = owner.spawn('/nonexistent/devdigest-test-binary', []);
    await expect(c.ready('ready')).rejects.toThrow(/exited \(code null, signal null\)/);
    expect(c.pid).toBeUndefined();
    await expect(owner.cleanupAll()).resolves.toBeUndefined();
  });

  it('leftovers() finds a process that escaped its owner, and only reports it', async () => {
    if (!canScanProcesses()) return;
    // A grandchild inherits the marker; it is not ours to signal, so it exits on its own after a moment.
    const c = owner.spawn(node, [
      '-e',
      `const g = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore', detached: true }); g.unref(); console.log('ready ' + g.pid);`,
    ]);
    const out = await c.ready('ready ');
    const grandchild = Number(/ready (\d+)/.exec(out)![1]);
    await c.exited;
    expect(owner.leftovers()).toEqual([grandchild]);
    expect(await owner.settledLeftovers(10_000)).toEqual([]);
  });
});
