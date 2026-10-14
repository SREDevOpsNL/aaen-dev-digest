import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TimeoutError, withAbortableTimeout } from '../src/platform/resilience.js';
import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

describe('withAbortableTimeout', () => {
  it('rejects with TimeoutError at the deadline and aborts the work', async () => {
    let seen: AbortSignal | undefined;
    const work = withAbortableTimeout((signal) => {
      seen = signal;
      return new Promise<never>(() => {}); // ignores the signal: the caller still gets the timeout
    }, 20);
    await expect(work).rejects.toBeInstanceOf(TimeoutError);
    expect(seen!.aborted).toBe(true);
  });

  it('forwards a parent abort to the work', async () => {
    const parent = new AbortController();
    const work = withAbortableTimeout(
      (signal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      60_000,
      parent.signal,
    );
    parent.abort(new Error('cancelled by caller'));
    await expect(work).rejects.toThrow('cancelled by caller');
  });
});

/** A loopback server that never answers; records when each connection closes. */
async function hangingServer() {
  const requests: { closedAt: number | null }[] = [];
  const server: Server = createServer((req, res) => {
    const entry = { closedAt: null as number | null };
    requests.push(entry);
    req.resume();
    res.on('close', () => (entry.closedAt = performance.now()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const structured = (extra: { timeoutMs?: number; signal?: AbortSignal }) => ({
  model: 'gpt-4.1',
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'Result',
  messages: [{ role: 'user' as const, content: 'return json' }],
  maxRetries: 0,
  ...extra,
});

describe.each([
  { name: 'OpenAI', env: 'OPENAI_BASE_URL', path: '/v1', make: () => new OpenAIProvider('test-key') },
  { name: 'Anthropic', env: 'ANTHROPIC_BASE_URL', path: '', make: () => new AnthropicProvider('test-key') },
])('$name adapter request cancellation', ({ env, path, make }) => {
  let srv: Awaited<ReturnType<typeof hangingServer>>;
  const previous = process.env[env];
  afterEach(async () => {
    if (previous === undefined) delete process.env[env];
    else process.env[env] = previous;
    await srv?.close();
  });

  async function provider() {
    srv = await hangingServer();
    process.env[env] = `${srv.url}${path}`; // read by the SDK constructor
    return make();
  }

  it('aborts the HTTP request at the timeout instead of leaving it running', async () => {
    const llm = await provider();
    await expect(llm.completeStructured(structured({ timeoutMs: 100 }))).rejects.toBeInstanceOf(TimeoutError);
    await vi.waitFor(() => expect(srv.requests[0]?.closedAt).not.toBeNull());
    expect(srv.requests).toHaveLength(1);
  });

  it('aborts the HTTP request when the caller signal aborts', async () => {
    const llm = await provider();
    const controller = new AbortController();
    const call = llm.completeStructured(structured({ signal: controller.signal }));
    await vi.waitFor(() => expect(srv.requests).toHaveLength(1));
    controller.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(srv.requests[0]!.closedAt).not.toBeNull());
  });
});
