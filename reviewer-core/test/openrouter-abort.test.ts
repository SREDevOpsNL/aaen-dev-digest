import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Result = z.object({ ok: z.boolean() });

/** A loopback server that accepts requests and never answers; records when each connection closes. */
async function hangingServer() {
  const requests: { startedAt: number; closedAt: number | null }[] = [];
  const server: Server = createServer((req, res) => {
    const entry = { startedAt: performance.now(), closedAt: null as number | null };
    requests.push(entry);
    req.resume();
    res.on('close', () => (entry.closedAt = performance.now())); // the client went away
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const request = (extra: { timeoutMs?: number; signal?: AbortSignal } = {}) => ({
  model: 'openrouter/test',
  schema: Result,
  schemaName: 'Result',
  messages: [{ role: 'user' as const, content: 'return json' }],
  maxRetries: 0,
  ...extra,
});

describe('OpenRouter request timeout and cancellation', () => {
  let srv: Awaited<ReturnType<typeof hangingServer>>;
  afterEach(async () => srv?.close());

  it('aborts a timed-out request, so it is closed before the next request begins', async () => {
    srv = await hangingServer();
    const provider = new OpenRouterProvider('test-key', { baseURL: srv.baseURL, maxRetries: 0 });

    await expect(provider.completeStructured(request({ timeoutMs: 100 }))).rejects.toThrow(/timed out/i);
    await vi.waitFor(() => expect(srv.requests[0]!.closedAt).not.toBeNull());

    const next = new AbortController();
    const second = provider.completeStructured(request({ signal: next.signal }));
    await vi.waitFor(() => expect(srv.requests).toHaveLength(2));
    // The first request was already gone when the second one arrived.
    expect(srv.requests[0]!.closedAt!).toBeLessThanOrEqual(srv.requests[1]!.startedAt);
    next.abort();
    await expect(second).rejects.toThrow();
  });

  it('aborts on the caller signal and starts no further attempt', async () => {
    srv = await hangingServer();
    // SDK retries stay at their default (2): an abort must not be retried.
    const provider = new OpenRouterProvider('test-key', { baseURL: srv.baseURL });
    const controller = new AbortController();
    const call = provider.completeStructured({ ...request({ signal: controller.signal }), maxRetries: 2 });
    await vi.waitFor(() => expect(srv.requests).toHaveLength(1));

    controller.abort();
    await expect(call).rejects.toThrow(/abort/i);
    await vi.waitFor(() => expect(srv.requests[0]!.closedAt).not.toBeNull());
    await new Promise((r) => setTimeout(r, 200));
    expect(srv.requests).toHaveLength(1);
  });

  it('never extends the provider timeout, so existing callers keep their behaviour', async () => {
    srv = await hangingServer();
    const provider = new OpenRouterProvider('test-key', { baseURL: srv.baseURL, timeoutMs: 100, maxRetries: 0 });
    const started = performance.now();
    await expect(provider.completeStructured(request({ timeoutMs: 60_000 }))).rejects.toThrow(/timed out/i);
    expect(performance.now() - started).toBeLessThan(5_000);
    await vi.waitFor(() => expect(srv.requests[0]!.closedAt).not.toBeNull());
  });
});
