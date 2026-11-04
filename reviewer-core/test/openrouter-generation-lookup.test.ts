import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { StructuredAttemptTelemetry, StructuredRequest } from '@devdigest/shared';
import { OpenRouterProvider, generationLookupDeadlineMs } from '../src/llm/openrouter.js';
import { summarizeGeneration } from '../src/llm/openrouter-metadata.js';

/**
 * The generation lookup of experiment mode, on a fake clock. OpenRouter's
 * generation record appeared 29–38 s after the response in HW2 Gate 3; the
 * server's experiment policy is 13 reads 5 s apart (`EXPERIMENT_GENERATION_LOOKUP`
 * in server/src/platform/config.ts). Every case also checks that the lookup
 * never sends a second generation request.
 */
const POLICY = { attempts: 13, delayMs: 5_000 };
const SERVED = 'deepseek/deepseek-v4-flash-20260423';

/** A `GET /generation` body in the shape Gate 3 observed. */
const record = (responses: Array<Record<string, unknown>> = [{ provider_name: 'DeepInfra', model_permaslug: SERVED, endpoint_id: 'ep-1', status: 200 }]) => ({
  data: { id: 'gen-1-abc', model: SERVED, provider_name: 'DeepInfra', finish_reason: 'stop', tokens_prompt: 1785, tokens_completion: 438, total_cost: 0.00022896, provider_responses: responses },
});

/** Router metadata as Gate 3 observed it: `attempt: 1` and no `attempts` array. */
const completion = {
  id: 'gen-1-abc',
  model: 'deepseek/deepseek-v4-flash',
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1586, completion_tokens: 479, cost: 0.00022896 },
  openrouter_metadata: {
    requested: 'deepseek/deepseek-v4-flash',
    strategy: 'direct',
    attempt: 1,
    endpoints: { total: 15, available: [{ provider: 'DeepInfra', model: SERVED, selected: true }] },
  },
};

type Read = (at: number, signal: AbortSignal | undefined) => Promise<Response> | Response;
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

function harness(read: Read, options: { policy?: { attempts: number; delayMs: number }; readTimeoutMs?: number; signal?: AbortSignal; readCost?: number } = {}) {
  let clock = 0;
  const reads: number[] = [];
  const create = vi.fn(() => ({ withResponse: () => Promise.resolve({ data: completion, response: { headers: new Headers() } }) }));
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    reads.push(clock);
    const response = await read(clock, init?.signal ?? undefined);
    clock += options.readCost ?? 0;
    return response;
  });
  const provider = new OpenRouterProvider('test-key', {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...(options.readTimeoutMs !== undefined ? { generationLookupReadTimeoutMs: options.readTimeoutMs } : {}),
  });
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  const attempts: StructuredAttemptTelemetry[] = [];
  const request: StructuredRequest<{ ok: boolean }> = {
    model: 'deepseek/deepseek-v4-flash',
    schema: z.object({ ok: z.boolean() }),
    schemaName: 'Result',
    messages: [{ role: 'user', content: 'return json' }],
    experiment: {
      slotId: 'x-test-1',
      transportMaxRetries: 0,
      maxRetries: 0,
      routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allowFallbacks: false },
      maxTokens: 16_000,
      routerMetadata: true,
      generationLookup: options.policy ?? POLICY,
    },
    onAttempt: (a) => attempts.push(a),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const run = async () => {
    await provider.completeStructured(request);
    expect(create).toHaveBeenCalledTimes(1); // the lookup reads metadata only: never another generation
    expect(attempts).toHaveLength(1);
    return { generation: attempts[0]!.generation!, reads, clock: () => clock };
  };
  return { run, fetchImpl };
}

describe('generation lookup (experiment mode)', () => {
  it('the deadline is the delays plus one read timeout', () => {
    expect(generationLookupDeadlineMs(POLICY)).toBe(65_000);
    expect(generationLookupDeadlineMs({ attempts: 1, delayMs: 5_000 }, 2_000)).toBe(2_000);
  });

  it('1. a record found at once is kept as OpenRouter returned it, after one read', async () => {
    const { run } = harness(() => json(200, record()));
    const { generation, reads } = await run();
    expect(reads).toEqual([0]);
    expect(generation).toEqual(summarizeGeneration(record()));
    expect(generation).toMatchObject({ status: 'found', providerName: 'DeepInfra', model: SERVED, providerResponses: [{ providerName: 'DeepInfra', modelPermaslug: SERVED, status: 200 }] });
  });

  it.each([30_000, 35_000, 40_000])('2. a record that appears %i ms after the response is found within the deadline', async (appearsAt) => {
    const { run } = harness((at) => (at >= appearsAt ? json(200, record()) : json(404)));
    const { generation, reads } = await run();
    expect(generation.status).toBe('found');
    expect(generation.providerResponses).toHaveLength(1);
    expect(reads.at(-1)).toBe(appearsAt);
    expect(reads.length).toBe(appearsAt / POLICY.delayMs + 1);
    expect(reads.at(-1)!).toBeLessThanOrEqual(generationLookupDeadlineMs(POLICY));
  });

  it('3. a record that never appears ends as not_found after the bounded reads, with nothing invented', async () => {
    const { run } = harness(() => json(404));
    const { generation, reads, clock } = await run();
    expect(reads).toHaveLength(POLICY.attempts);
    expect(reads.at(-1)).toBe((POLICY.attempts - 1) * POLICY.delayMs);
    expect(clock()).toBeLessThanOrEqual(generationLookupDeadlineMs(POLICY));
    expect(generation).toEqual({ status: 'not_found', providerName: null, model: null, finishReason: null, tokensPrompt: null, tokensCompletion: null, totalCost: null, providerResponses: [] });
  });

  it('a record that does not list its provider responses yet is read again', async () => {
    const { run } = harness((at) => json(200, at < 10_000 ? record([]) : record()));
    const { generation, reads } = await run();
    expect(reads).toEqual([0, 5_000, 10_000]);
    expect(generation.providerResponses).toHaveLength(1);
  });

  it('a record that never lists provider responses is returned as found with none (eligibility then refuses it)', async () => {
    const { run } = harness(() => json(200, record([])));
    const { generation, reads } = await run();
    expect(reads).toHaveLength(POLICY.attempts);
    expect(generation).toMatchObject({ status: 'found', providerResponses: [] });
  });

  it('7. a timed-out read is aborted, read again within the bound, and ends as unavailable', async () => {
    const hang: Read = (_at, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const { run } = harness(hang, { policy: { attempts: 3, delayMs: 0 }, readTimeoutMs: 20 });
    const { generation, reads } = await run();
    expect(reads).toHaveLength(3);
    expect(generation.status).toBe('unavailable');
    expect(generation.providerResponses).toEqual([]);
  });

  it('7. failed reads (5xx, 429, a network error) are read again; a definitive refusal (401) ends the lookup', async () => {
    const answers = [json(500), json(429), Promise.reject(new TypeError('fetch failed')), json(200, record())];
    const transient = harness(() => answers.shift()!);
    const recovered = await transient.run();
    expect(recovered.reads).toHaveLength(4);
    expect(recovered.generation.status).toBe('found');

    const refused = harness(() => json(401));
    const denied = await refused.run();
    expect(denied.reads).toHaveLength(1);
    expect(denied.generation.status).toBe('unavailable');

    const failing = harness(() => json(503));
    const outage = await failing.run();
    expect(outage.reads).toHaveLength(POLICY.attempts);
    expect(outage.generation.status).toBe('unavailable');
  });

  it('slow reads cannot stretch the lookup past its deadline', async () => {
    const { run } = harness(() => json(404), { readCost: 4_000 });
    const { reads, clock } = await run();
    const deadline = generationLookupDeadlineMs(POLICY);
    expect(reads.length).toBeLessThan(POLICY.attempts);
    expect(Math.max(...reads)).toBeLessThan(deadline);
    expect(clock()).toBeLessThanOrEqual(deadline + 4_000);
  });

  it('a cancellation stops the polling and records no record', async () => {
    const controller = new AbortController();
    const { run } = harness((at) => {
      if (at >= 5_000) controller.abort();
      return json(404);
    }, { signal: controller.signal });
    const { generation, reads } = await run();
    expect(reads).toEqual([0, 5_000]);
    expect(generation.status).toBe('unavailable');
  });
});
