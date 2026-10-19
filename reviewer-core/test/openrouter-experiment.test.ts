import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { z } from 'zod';
import type { LLMProvider, StructuredAttemptTelemetry, StructuredExperimentOptions, StructuredRequest } from '@devdigest/shared';
import { OpenRouterProvider, experimentRequestBody } from '../src/llm/openrouter.js';
import { experimentOptionsProblem, parseEndpoints, summarizeRouterMetadata } from '../src/llm/openrouter-metadata.js';
import { reviewPullRequest, singlePassMessages } from '../src/review/run.js';

const Result = z.object({ ok: z.boolean() });

const experiment = (patch: Partial<StructuredExperimentOptions> = {}): StructuredExperimentOptions => ({
  transportMaxRetries: 0,
  maxRetries: 0,
  routing: { order: ['deepinfra'], only: ['deepinfra'], allowFallbacks: false },
  maxTokens: 4000,
  routerMetadata: true,
  generationLookup: { attempts: 3, delayMs: 0 },
  ...patch,
});

const metadata = (selected: Array<{ provider: string; model: string }>, extra: Record<string, unknown> = {}) => ({
  requested: 'deepseek/deepseek-v4-flash',
  strategy: 'direct',
  attempt: 1,
  attempts: [{}],
  endpoints: {
    total: selected.length + 1,
    available: [...selected.map((s) => ({ ...s, selected: true })), { provider: 'Other', model: 'deepseek/deepseek-v4-flash', selected: false }],
  },
  ...extra,
});

function completion(content: string, patch: Record<string, unknown> = {}) {
  return {
    id: 'gen-abc123',
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0001 },
    openrouter_metadata: metadata([{ provider: 'DeepInfra', model: 'deepseek/deepseek-v4-flash' }]),
    ...patch,
  };
}

function setup(responses: Array<unknown | Error>, fetchResponses: Array<{ status: number; body?: unknown }> = []) {
  const create = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) create.mockImplementationOnce(() => ({ withResponse: () => Promise.reject(response) }));
    else
      create.mockImplementationOnce(() => ({
        withResponse: () => Promise.resolve({ data: response, response: { headers: new Headers({ 'x-generation-id': 'gen-header1' }) } }),
      }));
  }
  const fetchImpl = vi.fn();
  for (const r of fetchResponses) fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));
  const provider = new OpenRouterProvider('test-key', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  const attempts: StructuredAttemptTelemetry[] = [];
  const request = (patch: Partial<StructuredRequest<{ ok: boolean }>> = {}): StructuredRequest<{ ok: boolean }> => ({
    model: 'deepseek/deepseek-v4-flash',
    schema: Result,
    schemaName: 'Result',
    messages: [{ role: 'user', content: 'return json' }],
    experiment: experiment(),
    onAttempt: (a) => attempts.push(a),
    ...patch,
  });
  return { provider, create, fetchImpl, attempts, request };
}

const generation = {
  data: {
    provider_name: 'DeepInfra',
    model: 'deepseek/deepseek-v4-flash',
    finish_reason: 'stop',
    tokens_prompt: 120,
    tokens_completion: 30,
    total_cost: 0.0001,
    provider_responses: [{ provider_name: 'DeepInfra', endpoint_id: 'ep-1', model_permaslug: 'deepseek/deepseek-v4-flash-2026', status: 200 }],
  },
};

describe('OpenRouter experiment mode', () => {
  it('sends one request with the frozen provider, no fallbacks, bounded output and router metadata on', async () => {
    const { provider, create, attempts, request } = setup([completion('{"ok":true}')], [{ status: 200, body: generation }]);
    const result = await provider.completeStructured(request());
    expect(result).toMatchObject({ data: { ok: true }, attempts: 1, providerCostUsd: 0.0001 });
    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0]!;
    expect(body).toMatchObject({ provider: { order: ['deepinfra'], only: ['deepinfra'], allow_fallbacks: false }, max_tokens: 4000, temperature: 0 });
    expect(options).toMatchObject({ maxRetries: 0, headers: { 'X-OpenRouter-Metadata': 'enabled' } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      dispatch: 'dispatched',
      outcome: 'valid',
      servedModel: 'deepseek/deepseek-v4-flash',
      responseId: 'gen-abc123',
      generationIdHeader: 'gen-header1',
      finishReason: 'stop',
      tokensIn: 120,
      tokensOut: 30,
      costUsd: 0.0001,
      router: { selected: [{ provider: 'DeepInfra', model: 'deepseek/deepseek-v4-flash' }], attempt: 1, attemptsCount: 1 },
      generation: { status: 'found', providerName: 'DeepInfra', providerResponses: [{ endpointId: 'ep-1', status: 200 }] },
    });
  });

  it('polls generation metadata a bounded number of times', async () => {
    const lagging = setup([completion('{"ok":true}')], [{ status: 404 }, { status: 200, body: generation }]);
    await lagging.provider.completeStructured(lagging.request());
    expect(lagging.fetchImpl).toHaveBeenCalledTimes(2);
    expect(lagging.fetchImpl.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/generation?id=gen-abc123');
    expect(lagging.attempts[0]!.generation!.status).toBe('found');

    const missing = setup([completion('{"ok":true}')], [{ status: 404 }, { status: 404 }, { status: 404 }]);
    await missing.provider.completeStructured(missing.request());
    expect(missing.fetchImpl).toHaveBeenCalledTimes(3);
    expect(missing.attempts[0]!.generation!.status).toBe('not_found');
  });

  it('records missing router metadata as null instead of inferring it from the request', async () => {
    const { provider, attempts, request } = setup([completion('{"ok":true}', { openrouter_metadata: undefined, id: 'chatcmpl-1' })], [{ status: 200, body: generation }]);
    await provider.completeStructured(request());
    expect(attempts[0]!.router).toBeNull();
    // the response id is not a generation id, so the gen- header is used
    expect(attempts[0]!.generation!.status).toBe('found');
  });

  it('a schema-invalid answer is the outcome: one request, no reprompt, tokens and cost kept', async () => {
    const { provider, create, attempts, request } = setup([completion('{"wrong":1}'), completion('{"ok":true}')], [{ status: 200, body: generation }]);
    await expect(provider.completeStructured(request())).rejects.toThrow(/does not reprompt/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([expect.objectContaining({ outcome: 'schema_invalid', tokensIn: 120, tokensOut: 30, costUsd: 0.0001 })]);
  });

  it('classifies a truncated answer', async () => {
    const { provider, attempts, request } = setup(
      [completion('{"ok":', { choices: [{ message: { content: '{"ok":' }, finish_reason: 'length' }] })],
      [{ status: 200, body: generation }],
    );
    await expect(provider.completeStructured(request())).rejects.toThrow();
    expect(attempts[0]!.outcome).toBe('truncated');
  });

  it('reports HTTP and network errors with one request and rethrows', async () => {
    const http = setup([new OpenAI.RateLimitError(429, { message: 'slow down' }, 'slow down', {})]);
    await expect(http.provider.completeStructured(http.request())).rejects.toThrow();
    expect(http.create).toHaveBeenCalledTimes(1);
    expect(http.attempts[0]).toMatchObject({ dispatch: 'dispatched', outcome: 'http_error', httpStatus: 429 });

    const network = setup([new Error('socket hang up')]);
    await expect(network.provider.completeStructured(network.request())).rejects.toThrow('socket hang up');
    expect(network.attempts[0]).toMatchObject({ outcome: 'network_error', httpStatus: null });
  });

  it.each([
    ['two providers', experiment({ routing: { order: ['a', 'b'], only: ['a', 'b'], allowFallbacks: false } })],
    ['two providers in order only', experiment({ routing: { order: ['a', 'b'], only: ['a'], allowFallbacks: false } })],
    ['only differs from order', experiment({ routing: { order: ['a'], only: ['b'], allowFallbacks: false } })],
    ['fallbacks on', experiment({ routing: { order: ['a'], only: ['a'], allowFallbacks: true as unknown as false } })],
    ['transport retries', experiment({ transportMaxRetries: 1 as unknown as 0 })],
    ['structured retries', experiment({ maxRetries: 2 as unknown as 0 })],
    ['no output bound', experiment({ maxTokens: 0 })],
  ])('refuses before dispatch when %s', async (_label, options) => {
    const { provider, create, attempts, request } = setup([completion('{"ok":true}')]);
    await expect(provider.completeStructured(request({ experiment: options }))).rejects.toThrow(/refused before dispatch/);
    expect(create).not.toHaveBeenCalled();
    expect(attempts).toEqual([expect.objectContaining({ dispatch: 'refused', outcome: 'refused' })]);
  });

  it('leaves ordinary calls unchanged: no provider routing, no output cap, no options', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } });
    const provider = new OpenRouterProvider('test-key');
    (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
    await provider.completeStructured({ model: 'm', schema: Result, schemaName: 'Result', messages: [{ role: 'user', content: 'x' }] });
    expect(create.mock.calls[0]).toHaveLength(1);
    expect(create.mock.calls[0]![0]).not.toHaveProperty('provider');
    expect(create.mock.calls[0]![0]).not.toHaveProperty('max_tokens');
  });
});

describe('OpenRouter metadata parsers', () => {
  it('keeps every selected endpoint so ambiguity is visible', () => {
    const summary = summarizeRouterMetadata(metadata([{ provider: 'A', model: 'm' }, { provider: 'B', model: 'm' }]));
    expect(summary!.selected).toHaveLength(2);
    expect(summarizeRouterMetadata(undefined)).toBeNull();
  });

  it('parses provider endpoints with per-token prices and limits', () => {
    expect(
      parseEndpoints({
        data: {
          endpoints: [
            { provider_name: 'DeepInfra', tag: 'deepinfra/fp8', quantization: 'fp8', context_length: 128000, max_completion_tokens: 16384, pricing: { prompt: '0.00000014', completion: '0.00000028', request: '0' } },
            { provider_name: 'Broken', pricing: { prompt: '-1', completion: '0.1' } },
          ],
        },
      }),
    ).toEqual([
      { providerName: 'DeepInfra', tag: 'deepinfra/fp8', quantization: 'fp8', contextLength: 128000, maxCompletionTokens: 16384, pricing: { prompt: 0.00000014, completion: 0.00000028, request: 0 } },
    ]);
  });

  it('accepts only a well-formed single-provider experiment', () => {
    expect(experimentOptionsProblem(experiment())).toBeNull();
  });
});

describe('reviewPullRequest experiment mode', () => {
  const diff = { raw: '', files: [{ path: 'a.ts', additions: 1, deletions: 0, hunks: [{ file: 'a.ts', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, newLineNumbers: [1] }] }] };

  it('refuses any strategy other than single-pass before a model call', async () => {
    const llm = { id: 'openrouter', completeStructured: vi.fn() } as unknown as LLMProvider;
    await expect(
      reviewPullRequest({ systemPrompt: 's', model: 'm', diff: diff as never, llm, strategy: 'auto', experiment: experiment() }),
    ).rejects.toThrow(/single-pass/);
    expect(llm.completeStructured).not.toHaveBeenCalled();
  });

  it('forwards the experiment options and the attempt sink to the one structured call', async () => {
    const completeStructured = vi.fn().mockResolvedValue({
      data: { verdict: 'approve', summary: 'ok', score: 100, findings: [] },
      model: 'm', tokensIn: 1, tokensOut: 1, providerCostUsd: 0, costUsd: 0, raw: '{}', attempts: 1,
    });
    const onAttempt = vi.fn();
    await reviewPullRequest({
      systemPrompt: 's', model: 'm', diff: diff as never, llm: { id: 'openrouter', completeStructured } as unknown as LLMProvider,
      strategy: 'single-pass', experiment: experiment(), onAttempt, maxRetries: 5,
    });
    expect(completeStructured).toHaveBeenCalledTimes(1);
    expect(completeStructured.mock.calls[0]![0]).toMatchObject({ experiment: experiment(), onAttempt, maxRetries: 0 });
  });
});

describe('shared request builders cannot drift from what is sent', () => {
  it('experimentRequestBody is exactly the body the provider sends', async () => {
    const { provider, create, request } = setup([completion('{"ok":true}')], [{ status: 200, body: generation }]);
    const req = request({ sessionId: 's-1' });
    await provider.completeStructured(req);
    expect(create.mock.calls[0]![0]).toEqual(experimentRequestBody(req, req.experiment!));
  });

  it('singlePassMessages are exactly the messages of the single-pass review call', async () => {
    const diff = { raw: 'diff --git a/a.ts b/a.ts\n+x', files: [{ path: 'a.ts', additions: 1, deletions: 0, hunks: [] }] };
    const completeStructured = vi.fn().mockResolvedValue({
      data: { verdict: 'approve', summary: 'ok', score: 100, findings: [] },
      model: 'm', tokensIn: 1, tokensOut: 1, providerCostUsd: 0, costUsd: 0, raw: '{}', attempts: 1,
    });
    const input = { systemPrompt: 'S', diff: diff as never, skills: ['### a\nrule'], prDescription: 'body', task: 'Review PR #1' };
    await reviewPullRequest({ ...input, model: 'm', llm: { id: 'openrouter', completeStructured } as unknown as LLMProvider, strategy: 'single-pass' });
    expect(completeStructured.mock.calls[0]![0].messages).toEqual(singlePassMessages(input));
  });
});
