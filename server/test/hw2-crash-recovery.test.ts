import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ExperimentApi } from '../src/experiments/hw2/api.js';
import { spent } from '../src/experiments/hw2/budget.js';
import { experimentsRoot, revokeCapability, writeCapability } from '../src/experiments/hw2/cli.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { reconcile, runSlot, type SlotRun } from '../src/experiments/hw2/runner.js';
import { ProcessOwner, type OwnedChild } from './helpers/owned-process.js';

/**
 * Crash recovery and concurrency of the paid-slot lifecycle, with real
 * processes killed by SIGKILL and a loopback stand-in for the stack API (no
 * model, no network beyond 127.0.0.1). What must hold:
 * - one runner at a time on the shared ledger; a dead runner's lock is never
 *   stolen;
 * - a crash after authorization leaves a capability with no reserved slot,
 *   which can be revoked;
 * - a crash after the reservation or after dispatch leaves a slot that blocks
 *   every new authorization, is charged at its full reservation once
 *   reconciled (`ambiguous`), and is never sent again, even if the provider
 *   answers late.
 */
const cli = fileURLToPath(new URL('../src/experiments/hw2/cli.ts', import.meta.url));
const runnerTs = fileURLToPath(new URL('../src/experiments/hw2/runner.ts', import.meta.url));
const ledgerTs = fileURLToPath(new URL('../src/experiments/hw2/ledger.ts', import.meta.url));
const apiTs = fileURLToPath(new URL('../src/experiments/hw2/api.ts', import.meta.url));
// Each worker is one node process (`node --import tsx -e`), not the `tsx` CLI:
// the CLI runs the script in an inner node and relays only SIGINT and SIGTERM,
// so a SIGKILL on it left the worker running (a lock holder forever, a runner
// polling for 600 s that could still append to the ledger). The owner tags
// every worker, kills what is still alive after each test, and checks that
// nothing carrying its marker survives.
const owner = new ProcessOwner();
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  try {
    await owner.cleanupAll();
  } finally {
    for (const c of cleanups.splice(0).reverse()) await c();
  }
  expect(await owner.settledLeftovers()).toEqual([]);
});
function home() {
  const h = mkdtempSync(join(tmpdir(), 'hw2-crash-'));
  cleanups.push(() => rmSync(h, { recursive: true, force: true }));
  return h;
}

/** A SIGKILL at the crash point: the worker itself dies, and nothing it started outlives it. */
async function killed(c: OwnedChild) {
  expect(await c.kill('SIGKILL')).toEqual({ code: null, signal: 'SIGKILL' });
  expect(await owner.settledLeftovers()).toEqual([]);
}

/** Loopback stand-in for the stack API. Counts every dispatch; a run never settles until `settleLate`. */
async function fakeStack(opts: { holdLinks?: boolean } = {}) {
  const state = { dispatches: 0, linkRequests: 0, settled: false };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'POST' && /\/agents\/[^/]+\/skills$/.test(req.url!)) {
        state.linkRequests++;
        if (opts.holdLinks) return; // never answers: the runner is killed here, after its reservation
        return send(200, []);
      }
      if (req.method === 'PATCH') return send(200, []);
      if (req.method === 'GET' && /\/agents\/[^/]+\/skills$/.test(req.url!)) return send(200, []);
      if (req.method === 'POST' && req.url === '/experiments/runs') {
        state.dispatches++;
        return send(202, { run_id: 'run-crash', slot_id: JSON.parse(body).slot_id });
      }
      if (req.method === 'GET' && req.url!.startsWith('/experiments/slots/')) {
        if (state.dispatches === 0) return send(200, { arm: null, runs: [] });
        return send(200, {
          arm: null,
          runs: [
            state.settled
              ? { run_id: 'run-crash', status: 'done', cost_usd: 0.0002, experiment: { dispatch_state: 'completed', usage_known: true } }
              : { run_id: 'run-crash', status: 'running', cost_usd: null, experiment: { dispatch_state: 'dispatching' } },
          ],
        });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, state };
}

const SLOT: SlotRun = {
  slot: { slot_id: 'x-18-with-1', index: 0, phase: 'exploration', experiment: '18', condition: 'with', trial: 1 },
  prId: 'pr-502',
  agentId: 'agent-api',
  skillIds: ['skill-breaking'],
  manifestFingerprint: 'f'.repeat(64),
  expectedDiffSha256: 'd'.repeat(64),
  reservationUsd: 0.01,
  expectedNonSkillFingerprint: null,
};

/** A runner process: takes the shared ledger lock and runs SLOT against the stack at `url`. */
const runnerScript = (h: string, url: string) => `
  Promise.all([import(${JSON.stringify(ledgerTs)}), import(${JSON.stringify(runnerTs)}), import(${JSON.stringify(apiTs)})]).then(async ([l, r, a]) => {
    const ledger = new l.Ledger(${JSON.stringify(join(h, '.devdigest', 'hw2-experiments'))});
    ledger.acquire({ pid: process.pid, stackId: 'hw2f-crash01' });
    console.log('locked');
    await r.runSlot({ api: new a.ExperimentApi(${JSON.stringify(url)}), ledger, log: () => {}, capabilityToken: 't', stackId: 'hw2f-crash01', pollIntervalMs: 20, pollTimeoutMs: 600000 }, ${JSON.stringify(SLOT)});
  });`;

async function waitForState(h: string, slotId: string, state: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const slot = new Ledger(experimentsRoot(h)).slots().get(slotId);
    if (slot?.state === state) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`slot ${slotId} never reached ${state}`);
}

const lockFile = (h: string) => join(experimentsRoot(h), 'runner.lock');
const lockHolderPid = (h: string) => (JSON.parse(readFileSync(lockFile(h), 'utf8')) as { pid: number }).pid;

describe('paid-slot lifecycle: concurrency and crash recovery (real processes, SIGKILL)', () => {
  it('two runner processes: the second is refused while the first holds the shared lock, and a dead holder is never displaced', async () => {
    const h = home();
    const root = JSON.stringify(experimentsRoot(h));
    const holder = owner.spawnTsx(`import(${JSON.stringify(ledgerTs)}).then((l) => { new l.Ledger(${root}).acquire({ pid: process.pid, stackId: 'hw2f-a' }); console.log('locked'); setInterval(() => {}, 1000); })`);
    await holder.ready('locked');
    // The lock names the very process the test kills below.
    expect(lockHolderPid(h)).toBe(holder.pid);
    const second = owner.spawnTsx(`import(${JSON.stringify(ledgerTs)}).then((l) => { try { new l.Ledger(${root}).acquire({ pid: process.pid, stackId: 'hw2f-b' }); console.log('acquired'); } catch (e) { console.log('refused: ' + e.message); } })`);
    expect(await second.exited).toEqual({ code: 0, signal: null });
    expect(second.output()).toMatch(/refused: Another runner holds .*runner\.lock/);

    await killed(holder);
    // The dead runner's lock stays: recovery is an operator decision, never automatic.
    expect(existsSync(lockFile(h))).toBe(true);
    expect(() => new Ledger(experimentsRoot(h)).acquire({ pid: process.pid, stackId: 'hw2f-c' })).toThrow(/Another runner holds/);
  }, 60_000);

  it('a crash right after authorization leaves a capability with no slot: it can be revoked, then authorized again', async () => {
    const h = home();
    const proc = owner.spawnTsx(
      `import(${JSON.stringify(cli)}).then((m) => { m.writeCapability({ stackId: 'hw2f-crash01', phase: 'exploration', budgetUsd: 0.01, hours: 1, home: ${JSON.stringify(h)}, ceilingUsd: 0.05 }); console.log('authorized'); process.kill(process.pid, 'SIGKILL'); })`,
    );
    await proc.ready('authorized');
    // It died by its own SIGKILL, right after authorizing.
    expect(await proc.exited).toEqual({ code: null, signal: 'SIGKILL' });
    const capDir = join(experimentsRoot(h), 'hw2f-crash01');
    expect(existsSync(join(capDir, 'capability.json'))).toBe(true);
    expect(new Ledger(experimentsRoot(h)).slots().size).toBe(0);

    // Its existence blocks a second stack (its spend is in no ledger yet)…
    expect(() => writeCapability({ stackId: 'hw2f-crash02', phase: 'exploration', budgetUsd: 0.01, hours: 1, home: h, ceilingUsd: 0.05 })).toThrow(/live capability/);
    // …and, with no slot reserved under it, it can be revoked.
    expect(revokeCapability({ stackId: 'hw2f-crash01', home: h }).removed).toHaveLength(2);
    expect(existsSync(join(capDir, 'capability.json'))).toBe(false);
    expect(() => writeCapability({ stackId: 'hw2f-crash02', phase: 'exploration', budgetUsd: 0.01, hours: 1, home: h, ceilingUsd: 0.05 })).not.toThrow();
  }, 60_000);

  it('a crash after dispatch: the slot blocks authorization, is reconciled ambiguous at its reservation, and is never sent again, even when the provider answers late', async () => {
    const h = home();
    const stack = await fakeStack();
    const runner = owner.spawnTsx(runnerScript(h, stack.url));
    await runner.ready('locked');
    expect(lockHolderPid(h)).toBe(runner.pid);
    await waitForState(h, SLOT.slot.slot_id, 'dispatched');
    await killed(runner);
    expect(stack.state.dispatches).toBe(1);

    const root = experimentsRoot(h);
    expect(new Ledger(root).unresolved().map((s) => s.slot_id)).toEqual(['x-18-with-1']);
    expect(() => writeCapability({ stackId: 'hw2f-crash02', phase: 'exploration', budgetUsd: 0.01, hours: 1, home: h, ceilingUsd: 0.5 })).toThrow(/Reconcile first/);
    expect(() => revokeCapability({ stackId: 'hw2f-crash01', home: h })).toThrow(/Reconcile first/);
    expect(() => new Ledger(root).acquire({ pid: process.pid, stackId: 'hw2f-crash01' })).toThrow(/Another runner holds/);

    // The operator confirms the runner is gone and removes its lock; recovery reconciles.
    rmSync(lockFile(h));
    const ledger = new Ledger(root);
    ledger.acquire({ pid: process.pid, stackId: 'hw2f-crash01' });
    cleanups.push(() => ledger.release());
    const deps = { api: new ExperimentApi(stack.url), ledger, log: () => {}, capabilityToken: 't', stackId: 'hw2f-crash01' };
    await reconcile(deps);
    const slot = ledger.slots().get('x-18-with-1')!;
    expect(slot.state).toBe('ambiguous');
    expect(spent(ledger.slots().values())).toBeCloseTo(0.01, 12);

    // The provider answers late: the ledger keeps the conservative outcome, and nothing is re-sent.
    stack.state.settled = true;
    await reconcile(deps);
    expect(ledger.slots().get('x-18-with-1')!.state).toBe('ambiguous');
    await expect(runSlot(deps, SLOT)).rejects.toThrow(/never replayed/);
    expect(stack.state.dispatches).toBe(1);

    // Reconciled, it no longer blocks: authorization counts it at its reservation.
    expect(() => writeCapability({ stackId: 'hw2f-crash02', phase: 'exploration', budgetUsd: 0.005, hours: 1, home: h, ceilingUsd: 0.014 })).toThrow(/Ceiling/);
    expect(() => writeCapability({ stackId: 'hw2f-crash02', phase: 'exploration', budgetUsd: 0.005, hours: 1, home: h, ceilingUsd: 0.015 })).not.toThrow();
  }, 60_000);

  it('a crash after the reservation but before any request is still charged in full and never sent', async () => {
    const h = home();
    const stack = await fakeStack({ holdLinks: true });
    const runner = owner.spawnTsx(runnerScript(h, stack.url));
    await runner.ready('locked');
    expect(lockHolderPid(h)).toBe(runner.pid);
    await waitForState(h, SLOT.slot.slot_id, 'reserved');
    await killed(runner);
    expect(stack.state.dispatches).toBe(0);

    rmSync(lockFile(h));
    const ledger = new Ledger(experimentsRoot(h));
    ledger.acquire({ pid: process.pid, stackId: 'hw2f-crash01' });
    cleanups.push(() => ledger.release());
    const deps = { api: new ExperimentApi(stack.url), ledger, log: () => {}, capabilityToken: 't' };
    await reconcile(deps);
    // The runner cannot prove nothing was sent, so the reservation stays charged.
    expect(ledger.slots().get('x-18-with-1')!.state).toBe('ambiguous');
    expect(spent(ledger.slots().values())).toBeCloseTo(0.01, 12);
    await expect(runSlot(deps, SLOT)).rejects.toThrow(/never replayed/);
    expect(stack.state.dispatches).toBe(0);
  }, 60_000);
});
