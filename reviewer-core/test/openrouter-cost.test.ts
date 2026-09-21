import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Result = z.object({ ok: z.boolean() });

interface StubResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
}

function providerWith(responses: StubResponse[], estimate = vi.fn(() => 0.75)) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  const provider = new OpenRouterProvider('test-key', { estimateCost: estimate });
  (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
    chat: { completions: { create } },
  };
  return { provider, estimate };
}

function response(content: string, cost?: number): StubResponse {
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      ...(cost !== undefined ? { cost } : {}),
    },
  };
}

describe('OpenRouter provider-reported cost', () => {
  it('sums provider cost across structured-output retries', async () => {
    const { provider, estimate } = providerWith([
      response('{"wrong":true}', 0.01),
      response('{"ok":true}', 0.02),
    ]);

    const result = await provider.completeStructured({
      model: 'openrouter/test',
      schema: Result,
      schemaName: 'Result',
      messages: [{ role: 'user', content: 'return json' }],
    });

    expect(result.providerCostUsd).toBeCloseTo(0.03);
    expect(result.costUsd).toBeCloseTo(0.03);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('keeps authoritative cost missing but preserves the legacy partial provider total', async () => {
    const { provider, estimate } = providerWith([
      response('{"wrong":true}', 0.01),
      response('{"ok":true}'),
    ]);

    const result = await provider.completeStructured({
      model: 'openrouter/test',
      schema: Result,
      schemaName: 'Result',
      messages: [{ role: 'user', content: 'return json' }],
    });

    expect(result.providerCostUsd).toBeNull();
    expect(result.costUsd).toBe(0.01);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('uses the estimator only when no response reports cost', async () => {
    const { provider, estimate } = providerWith([response('{"ok":true}')]);

    const result = await provider.completeStructured({
      model: 'openrouter/test',
      schema: Result,
      schemaName: 'Result',
      messages: [{ role: 'user', content: 'return json' }],
    });

    expect(result.providerCostUsd).toBeNull();
    expect(result.costUsd).toBe(0.75);
    expect(estimate).toHaveBeenCalledWith('openrouter/test', 10, 5);
  });

  it('preserves a provider-reported zero as authoritative', async () => {
    const { provider, estimate } = providerWith([response('{"ok":true}', 0)]);

    const result = await provider.completeStructured({
      model: 'openrouter/free',
      schema: Result,
      schemaName: 'Result',
      messages: [{ role: 'user', content: 'return json' }],
    });

    expect(result.providerCostUsd).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(estimate).not.toHaveBeenCalled();
  });
});
