import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API_REQUEST_TIMEOUT_MS, ExperimentApi } from '../src/experiments/hw2/api.js';
import { spent } from '../src/experiments/hw2/budget.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import { runSlot, type SlotRun } from '../src/experiments/hw2/runner.js';

/**
 * The runner's client for the local stack, against a loopback server that
 * stops answering. Without a timeout of its own, fetch waits for its 300 s
 * headers timeout, far past the runner's slot deadline.
 */
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); })));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function stack(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => handler(req, res));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const never = () => {};

describe('stack API requests are bounded', () => {
  it('the default bound covers the slowest route and stays far below fetch\'s own 300 s', () => {
    expect(API_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000 * 2);
    expect(API_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it('no response headers: the request fails at its timeout', async () => {
    const api = new ExperimentApi(await stack(never), undefined, 200);
    const started = Date.now();
    await expect(api.get('/experiments/identity')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('headers but a body that never ends: the same timeout covers the body', async () => {
    const api = new ExperimentApi(
      await stack((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"runs":');
      }),
      undefined,
      200,
    );
    const started = Date.now();
    await expect(api.get('/experiments/slots/x')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a poll gets only what is left of the runner deadline, not the full request timeout', async () => {
    const base = await stack((req, res) => {
      if (req.method === 'POST') {
        res.writeHead(req.url === '/experiments/runs' ? 202 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url === '/experiments/runs' ? { run_id: 'run-1' } : {}));
      }
      if (req.method === 'GET' && req.url === '/agents/agent/skills') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
      }
      // every poll hangs
    });
    const dir = mkdtempSync(join(tmpdir(), 'hw2-api-timeout-'));
    dirs.push(dir);
    const ledger = new Ledger(dir);
    ledger.acquire({ pid: process.pid, stackId: 'hw2f-apitime2' });
    try {
      const run: SlotRun = {
        slot: { slot_id: 'x-17-with-1', index: 0, phase: 'exploration', experiment: '17', condition: 'with', trial: 1 },
        prId: 'pr', agentId: 'agent', skillIds: [], manifestFingerprint: 'f'.repeat(64), expectedDiffSha256: 'd'.repeat(64),
        reservationUsd: 0.01, expectedNonSkillFingerprint: null,
      };
      const started = Date.now();
      // A 5 s request bound, a 600 ms slot deadline: the hung poll must end at the deadline.
      const result = await runSlot({ api: new ExperimentApi(base, undefined, 5_000), ledger, log: () => {}, capabilityToken: 'tok', pollIntervalMs: 10, pollTimeoutMs: 600 }, run);
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(result).toMatchObject({ state: 'ambiguous', reason: 'poll timeout' });
      expect(spent([...ledger.slots().values()], 'exploration')).toBeCloseTo(0.01);
    } finally {
      ledger.release();
    }
  });

  it('a stack that stops answering after dispatch: the slot is ambiguous at the runner deadline, with its full reservation, not 300 s later', async () => {
    const posts: string[] = [];
    const base = await stack((req, res) => {
      if (req.method === 'POST') {
        posts.push(req.url ?? '');
        res.writeHead(req.url === '/experiments/runs' ? 202 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url === '/experiments/runs' ? { run_id: 'run-1' } : {}));
        return;
      }
      if (req.method === 'GET' && req.url === '/agents/agent/skills') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
        return;
      }
      // Every poll hangs.
    });
    const dir = mkdtempSync(join(tmpdir(), 'hw2-api-timeout-'));
    dirs.push(dir);
    const ledger = new Ledger(dir);
    ledger.acquire({ pid: process.pid, stackId: 'hw2f-apitime1' });
    try {
      const run: SlotRun = {
        slot: { slot_id: 'x-17-with-1', index: 0, phase: 'exploration', experiment: '17', condition: 'with', trial: 1 },
        prId: 'pr', agentId: 'agent', skillIds: [], manifestFingerprint: 'f'.repeat(64), expectedDiffSha256: 'd'.repeat(64),
        reservationUsd: 0.01, expectedNonSkillFingerprint: null,
      };
      const started = Date.now();
      const result = await runSlot(
        { api: new ExperimentApi(base, undefined, 300), ledger, log: () => {}, capabilityToken: 'tok', pollIntervalMs: 10, pollTimeoutMs: 500 },
        run,
      );
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(result).toMatchObject({ state: 'ambiguous', costUsd: null, reason: 'poll timeout' });
      expect(posts.filter((p) => p === '/experiments/runs')).toHaveLength(1); // dispatched once, never again
      expect(spent([...ledger.slots().values()], 'exploration')).toBeCloseTo(0.01);
    } finally {
      ledger.release();
    }
  });
});
