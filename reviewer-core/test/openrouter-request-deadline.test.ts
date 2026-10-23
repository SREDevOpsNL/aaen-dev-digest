import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { z } from 'zod';
import type { StructuredAttemptTelemetry, StructuredRequest } from '@devdigest/shared';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * The timing of one experiment request, against a loopback server that behaves
 * like OpenRouter: it can send `200` and its headers at once (OpenRouter does
 * so "as soon as the provider accepts the request", before the first token, for
 * non-streaming requests too) and the body only when generation ends.
 * Real SDK, real provider; every case also counts the requests the server saw.
 */
const completion = JSON.stringify({
  id: 'gen-deadline-1',
  model: 'deepseek/deepseek-v4-flash',
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00001 },
});
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); })));
});
async function openrouter(handler: Handler) {
  const posts: number[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'POST') posts.push(Date.now());
      handler(req, res);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, posts };
}
const headersNowBodyAfter = (ms: number, body = completion): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.flushHeaders();
  setTimeout(() => { if (!res.destroyed) res.end(body); }, ms);
};
function request(signal?: AbortSignal) {
  const attempts: StructuredAttemptTelemetry[] = [];
  const req: StructuredRequest<{ ok: boolean }> = {
    model: 'deepseek/deepseek-v4-flash',
    schema: z.object({ ok: z.boolean() }),
    schemaName: 'Result',
    messages: [{ role: 'user', content: 'return json' }],
    experiment: {
      slotId: 'x-test-1', transportMaxRetries: 0, maxRetries: 0,
      routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allowFallbacks: false },
      maxTokens: 16_000, routerMetadata: true, generationLookup: null,
    },
    onAttempt: (a) => attempts.push(a),
    ...(signal ? { signal } : {}),
  };
  return { req, attempts };
}

describe('experiment request deadline (headers and body)', () => {
  it('the SDK timeout alone ends at the headers: a slow body is not bounded by it', async () => {
    const { baseURL } = await openrouter(headersNowBodyAfter(600));
    const client = new OpenAI({ apiKey: 'test', baseURL, timeout: 200, maxRetries: 0 });
    const started = Date.now();
    const result = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(result.id).toBe('gen-deadline-1'); // completed although 600 ms > the 200 ms "timeout"
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
  });

  it('the experiment deadline covers the body: a generation still running at the deadline is ended, once, as a timeout', async () => {
    const { baseURL, posts } = await openrouter(headersNowBodyAfter(1_500));
    const provider = new OpenRouterProvider('test-key', { baseURL, timeoutMs: 300, maxRetries: 2 });
    const { req, attempts } = request();
    const started = Date.now();
    await expect(provider.completeStructured(req)).rejects.toThrow(/exceeded its 0\.3 s deadline/);
    expect(Date.now() - started).toBeLessThan(1_200);
    expect(posts).toHaveLength(1); // no retry
    expect(attempts).toEqual([expect.objectContaining({ dispatch: 'dispatched', outcome: 'network_error', costUsd: null, failureReason: 'request exceeded its 0.3 s deadline (headers and body)' })]);
  });

  it('a request that completes just below the deadline is valid', async () => {
    const { baseURL, posts } = await openrouter(headersNowBodyAfter(150));
    const provider = new OpenRouterProvider('test-key', { baseURL, timeoutMs: 600, maxRetries: 2 });
    const { req, attempts } = request();
    await expect(provider.completeStructured(req)).resolves.toMatchObject({ data: { ok: true } });
    expect(posts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'valid', costUsd: 0.00001 });
  });

  it('headers that never come within the deadline: a timeout, one request', async () => {
    const { baseURL, posts } = await openrouter((_req, res) => setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end(completion); } }, 1_500));
    const provider = new OpenRouterProvider('test-key', { baseURL, timeoutMs: 300, maxRetries: 2 });
    const { req, attempts } = request();
    await expect(provider.completeStructured(req)).rejects.toThrow();
    expect(posts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'network_error', costUsd: null });
  });

  it('a cancellation during generation is a cancellation, not a timeout; the late body changes nothing', async () => {
    const { baseURL, posts } = await openrouter(headersNowBodyAfter(500));
    const provider = new OpenRouterProvider('test-key', { baseURL, timeoutMs: 5_000, maxRetries: 2 });
    const controller = new AbortController();
    const { req, attempts } = request(controller.signal);
    setTimeout(() => controller.abort(), 100);
    // The caller sees its own cancellation (the signal's reason, or the SDK's abort error), never a timeout or a provider error.
    await expect(provider.completeStructured(req)).rejects.toSatisfy((e: unknown) => e instanceof OpenAI.APIUserAbortError || (e instanceof Error && e.name === 'AbortError'));
    await new Promise((done) => setTimeout(done, 600)); // past the late body
    expect(posts).toHaveLength(1);
    expect(attempts).toEqual([expect.objectContaining({ outcome: 'cancelled', failureReason: 'cancelled during the request' })]);
  });

  it('an HTTP 429 fails at once, with unknown cost and no retry', async () => {
    const { baseURL, posts } = await openrouter((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 429, message: 'Provider returned error', metadata: { provider_name: 'DeepInfra' } } }));
    });
    const provider = new OpenRouterProvider('test-key', { baseURL, timeoutMs: 5_000, maxRetries: 2 });
    const { req, attempts } = request();
    await expect(provider.completeStructured(req)).rejects.toThrow(/429/);
    expect(posts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'http_error', httpStatus: 429, costUsd: null });
  });

  it('the preflight endpoints read is bounded', async () => {
    const { baseURL } = await openrouter(() => { /* never answers */ });
    const provider = new OpenRouterProvider('test-key', { baseURL, metadataTimeoutMs: 150 });
    const started = Date.now();
    await expect(provider.listEndpoints('deepseek/deepseek-v4-flash')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
