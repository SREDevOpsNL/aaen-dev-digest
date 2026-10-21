import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { z } from 'zod';
import type { StructuredAttemptTelemetry, StructuredExperimentOptions, StructuredRequest } from '@devdigest/shared';
import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { ExperimentRequestError, attemptErrorDetail, sanitizeText } from '../src/llm/error-detail.js';

const Result = z.object({ ok: z.boolean() });
/** A key-shaped value and one that matches no secret pattern: both must never be persisted. */
const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const PLAIN_KEY = 'plainkeyvalue42';

const PROVIDER_429 = {
  code: 429,
  message: 'Provider returned error',
  metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited', provider_name: 'DeepInfra', raw: 'upstream: slow down' },
};

describe('attemptErrorDetail (pure)', () => {
  it('reads a structured upstream 429: provider, codes, request id, Retry-After, allowlisted rate-limit headers', () => {
    const detail = attemptErrorDetail({
      errorBody: PROVIDER_429,
      headers: new Headers({ 'retry-after': '20', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792575999', 'x-request-id': 'req_7f3a' }),
    });
    expect(detail).toEqual({
      origin: 'upstream_provider',
      code: 429,
      message: 'Provider returned error',
      errorType: 'rate_limit_exceeded',
      providerCode: 'rate_limited',
      providerName: 'DeepInfra',
      limitSource: null,
      upstreamRawPresent: true,
      requestId: 'req_7f3a',
      retryAfter: '20',
      rateLimit: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792575999' },
      redacted: false,
    });
    // The upstream's verbatim payload is only flagged, never kept.
    expect(JSON.stringify(detail)).not.toContain('upstream: slow down');
  });

  it.each([
    ['an OpenRouter key limit', { code: 403, message: 'Key limit exceeded', metadata: { limit_source: 'openrouter_key_limit' } }, 'openrouter'],
    ['a typed error without provider fields', { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } }, 'unattributed'],
    ['a body without metadata', { code: 429, message: 'Rate limit exceeded' }, 'unattributed'],
    ['a provider code alone', { code: 429, message: 'x', metadata: { provider_code: 'rate_limited' } }, 'upstream_provider'],
    ['a non-OpenRouter limit source', { code: 403, message: 'x', metadata: { limit_source: 'workspace' } }, 'unattributed'],
    ['no body', undefined, 'no_body'],
  ])('classifies the origin of %s', (_label, errorBody, origin) => {
    expect(attemptErrorDetail({ errorBody }).origin).toBe(origin);
  });

  it('redacts secrets in free text: key patterns, bearer values, key=value pairs, URL queries and the exact request key', () => {
    const message = `bad key ${KEY}; Authorization: Bearer abc.def; api_key=hunter2; see https://x.test/v1?token=zzz; mine is ${PLAIN_KEY}`;
    const detail = attemptErrorDetail({ errorBody: { code: 401, message }, secrets: [PLAIN_KEY] });
    for (const leaked of [KEY, 'abc.def', 'hunter2', 'token=zzz', PLAIN_KEY]) expect(detail.message).not.toContain(leaked);
    expect(detail.message).toContain('[redacted]');
    expect(detail.redacted).toBe(true);
  });

  it('drops every header outside the allowlist, even a plain value that would pass as a token', () => {
    const headers = new Headers({ 'set-cookie': 'plainsession', authorization: 'plaincredential', 'x-internal-debug': 'trace-me', 'x-ratelimit-limit': '100' });
    const detail = attemptErrorDetail({ errorBody: PROVIDER_429, headers });
    expect(detail.rateLimit).toEqual({ 'x-ratelimit-limit': '100' });
    for (const leaked of ['plainsession', 'plaincredential', 'trace-me']) expect(JSON.stringify(detail)).not.toContain(leaked);
  });

  it('keeps only allowlisted headers, and drops an allowlisted value that looks like a secret', () => {
    const headers = new Headers({
      'set-cookie': 'session=s3cret',
      authorization: `Bearer ${KEY}`,
      'x-internal-debug': 'trace-me',
      'retry-after': `Bearer ${KEY}`,
      'x-ratelimit-limit': '100',
    });
    const detail = attemptErrorDetail({ errorBody: PROVIDER_429, headers });
    expect(detail.rateLimit).toEqual({ 'x-ratelimit-limit': '100' });
    expect(detail.retryAfter).toBeNull();
    expect(detail.redacted).toBe(true);
    for (const leaked of ['s3cret', KEY, 'trace-me']) expect(JSON.stringify(detail)).not.toContain(leaked);
  });

  it('reads the SDK proxy headers (a plain object), and missing headers leave the fields empty', () => {
    expect(attemptErrorDetail({ errorBody: PROVIDER_429, headers: { 'retry-after': '5', 'x-request-id': 'r1' } })).toMatchObject({ retryAfter: '5', requestId: 'r1' });
    expect(attemptErrorDetail({ errorBody: PROVIDER_429 })).toMatchObject({ retryAfter: null, requestId: null, rateLimit: {} });
  });

  it('never throws, and stays bounded, on malformed, recursive, oversized or hostile input', () => {
    const recursive: Record<string, unknown> = { code: 429, message: 'loop' };
    recursive.metadata = recursive;
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
    const throwingGetter = Object.defineProperty({}, 'message', { get: () => { throw new Error('boom'); } });
    const inputs: unknown[] = [
      'a string body', 42, null, [], [PROVIDER_429], recursive, hostile, throwingGetter,
      { code: { nested: true }, message: { text: 'object message' }, metadata: 'not an object' },
      { code: -1, message: 'x'.repeat(1_000_000) },
      { code: 1.5, metadata: { provider_name: '<script>alert(1)</script>', error_type: 'x'.repeat(65), provider_code: KEY } },
    ];
    for (const errorBody of inputs) {
      const started = performance.now();
      const detail = attemptErrorDetail({ errorBody, headers: hostile, requestId: { not: 'a string' } });
      expect(performance.now() - started).toBeLessThan(200);
      expect(detail.message === null || detail.message.length <= 300).toBe(true);
      expect(JSON.stringify(detail)).not.toContain(KEY);
      expect(JSON.stringify(detail)).not.toContain('<script>');
    }
    const oversized = attemptErrorDetail({ errorBody: { message: 'x '.repeat(500_000) } });
    expect(oversized.message!.length).toBeLessThanOrEqual(300);
    expect(oversized.redacted).toBe(true);
  });

  it('sanitizeText removes control characters and collapses whitespace', () => {
    expect(sanitizeText('line1\n\tline2\u0000\u001b[31mred', 100)).toBe('line1 line2 [31mred');
    expect(sanitizeText(undefined, 10)).toBeNull();
  });
});

/** A loopback stand-in for OpenRouter that answers chat completions with a scripted response. */
async function scriptedServer(answer: (req: IncomingMessage, res: ServerResponse) => void) {
  const requests: Array<{ path: string; authorization: string | undefined }> = [];
  const server: Server = createServer((req, res) => {
    requests.push({ path: req.url ?? '', authorization: req.headers.authorization });
    req.resume();
    req.on('end', () => answer(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const experiment = (): StructuredExperimentOptions => ({
  slotId: 'x-test-1',
  transportMaxRetries: 0,
  maxRetries: 0,
  routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allowFallbacks: false },
  maxTokens: 4000,
  routerMetadata: true,
  generationLookup: null,
});

/** The real provider and SDK against the loopback server, with the request's attempts captured. */
function realProvider(baseURL: string) {
  // maxRetries 2 on the client: the experiment path must still send exactly one request.
  const provider = new OpenRouterProvider(KEY, { baseURL, maxRetries: 2 });
  const attempts: StructuredAttemptTelemetry[] = [];
  const request: StructuredRequest<{ ok: boolean }> = {
    model: 'deepseek/deepseek-v4-flash',
    schema: Result,
    schemaName: 'Result',
    messages: [{ role: 'user', content: 'return json' }],
    experiment: experiment(),
    onAttempt: (a) => attempts.push(a),
  };
  return { provider, attempts, request };
}

/** Everything a failed slot would persist: the attempt, its failure reason, and the thrown error's message. */
const persisted = (attempts: StructuredAttemptTelemetry[], error: unknown) => JSON.stringify({ attempts, message: (error as Error).message });

describe('experiment request errors through the real SDK (loopback, no network)', () => {
  let srv: Awaited<ReturnType<typeof scriptedServer>>;
  afterEach(async () => srv?.close());

  it('a structured upstream 429: one request, sanitized detail, and the key echoed in the body is never kept', async () => {
    srv = await scriptedServer((req, res) => {
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '20',
        'x-ratelimit-remaining': '0',
        'x-request-id': 'req_loopback_1',
        'set-cookie': 'session=s3cret',
      });
      // A hostile upstream that echoes the credential it received.
      res.end(JSON.stringify({ error: { ...PROVIDER_429, metadata: { ...PROVIDER_429.metadata, raw: `got ${req.headers.authorization}` } } }));
    });
    const { provider, attempts, request } = realProvider(srv.baseURL);
    const error = await provider.completeStructured(request).catch((e: unknown) => e);

    expect(srv.requests.filter((r) => r.path.endsWith('/chat/completions'))).toHaveLength(1);
    expect(srv.requests[0]!.authorization).toBe(`Bearer ${KEY}`); // the server really received the key
    expect(error).toBeInstanceOf(ExperimentRequestError);
    expect(error).not.toBeInstanceOf(OpenAI.APIError);
    expect(error).toMatchObject({ status: 429, message: '429 Provider returned error' });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      dispatch: 'dispatched',
      outcome: 'http_error',
      httpStatus: 429,
      failureReason: '429 Provider returned error',
      errorDetail: {
        origin: 'upstream_provider',
        code: 429,
        errorType: 'rate_limit_exceeded',
        providerCode: 'rate_limited',
        providerName: 'DeepInfra',
        upstreamRawPresent: true,
        requestId: 'req_loopback_1',
        retryAfter: '20',
        rateLimit: { 'x-ratelimit-remaining': '0' },
      },
    });
    for (const leaked of [KEY, 's3cret', 'got Bearer']) expect(persisted(attempts, error)).not.toContain(leaked);
  });

  it('an error body without a message: the SDK puts the whole body in its message, which is never persisted', async () => {
    srv = await scriptedServer((req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 429, metadata: { provider_name: 'DeepInfra', raw: `echo ${req.headers.authorization}` } } }));
    });
    const { provider, attempts, request } = realProvider(srv.baseURL);
    const error = await provider.completeStructured(request).catch((e: unknown) => e);
    expect(srv.requests).toHaveLength(1);
    expect(attempts[0]!.failureReason).toBe('429 error without a message');
    for (const leaked of [KEY, 'echo', 'Bearer']) expect(persisted(attempts, error)).not.toContain(leaked);
    expect(attempts[0]!.errorDetail).toMatchObject({ origin: 'upstream_provider', message: null, providerName: 'DeepInfra', upstreamRawPresent: true });
  });

  it('a non-JSON error body becomes the SDK message, which is never persisted', async () => {
    srv = await scriptedServer((req, res) => {
      res.writeHead(429, { 'content-type': 'text/html' });
      res.end(`<html>rate limited; your key ${req.headers.authorization} ${'pad '.repeat(1000)}</html>`);
    });
    const { provider, attempts, request } = realProvider(srv.baseURL);
    const error = await provider.completeStructured(request).catch((e: unknown) => e);
    expect(srv.requests).toHaveLength(1);
    expect(attempts[0]!.errorDetail).toMatchObject({ origin: 'no_body', code: null });
    expect(attempts[0]!.failureReason).toBe('429 error without a message');
    for (const leaked of [KEY, '<html>', 'rate limited; your key']) expect(persisted(attempts, error)).not.toContain(leaked);
  });

  it('an HTTP 200 whose body holds only an error: one request, detail from the body', async () => {
    srv = await scriptedServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'retry-after': '7' });
      res.end(JSON.stringify({ id: 'gen-200err', error: { code: 429, message: `Rate limit exceeded for ${req.headers.authorization}`, metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' } } }));
    });
    const { provider, attempts, request } = realProvider(srv.baseURL);
    const error = await provider.completeStructured(request).catch((e: unknown) => e);
    expect(srv.requests).toHaveLength(1);
    expect(error).toBeInstanceOf(ExperimentRequestError);
    expect(attempts[0]).toMatchObject({
      outcome: 'http_error',
      httpStatus: 200,
      errorDetail: { origin: 'upstream_provider', code: 429, errorType: 'rate_limit_exceeded', providerCode: 'rate_limited', retryAfter: '7' },
    });
    expect(attempts[0]!.failureReason).toMatch(/^OpenRouter returned no choices for Result: Rate limit exceeded for Bearer \[redacted\]$/);
    expect(persisted(attempts, error)).not.toContain(KEY);
  });

  it('a 429 with no body and no headers leaves the fields empty', async () => {
    srv = await scriptedServer((_req, res) => {
      res.writeHead(429);
      res.end();
    });
    const { provider, attempts, request } = realProvider(srv.baseURL);
    await provider.completeStructured(request).catch(() => undefined);
    expect(srv.requests).toHaveLength(1);
    expect(attempts[0]!.errorDetail).toMatchObject({ origin: 'no_body', retryAfter: null, rateLimit: {}, message: null });
  });

  it('a network failure: one request, network_error, no detail beyond its absence', async () => {
    srv = await scriptedServer((req) => req.socket.destroy());
    const { provider, attempts, request } = realProvider(srv.baseURL);
    const error = await provider.completeStructured(request).catch((e: unknown) => e);
    expect(srv.requests).toHaveLength(1);
    expect(error).toBeInstanceOf(ExperimentRequestError);
    expect(attempts[0]).toMatchObject({ outcome: 'network_error', httpStatus: null, errorDetail: { origin: 'no_body' } });
  });

  it('leaves ordinary calls unchanged: they still throw the SDK error', async () => {
    srv = await scriptedServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: PROVIDER_429 }));
    });
    const provider = new OpenRouterProvider(KEY, { baseURL: srv.baseURL, maxRetries: 0 });
    const error = await provider
      .completeStructured({ model: 'm', schema: Result, schemaName: 'Result', messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenAI.RateLimitError);
    expect(error).not.toBeInstanceOf(ExperimentRequestError);
  });
});
