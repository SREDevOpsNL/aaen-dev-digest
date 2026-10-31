import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, StructuredExperimentOptions, StructuredRequest } from '@devdigest/shared';
import { REVIEW_SCHEMA_NAME } from '@devdigest/reviewer-core';
import { ExperimentGuardedProvider, ExperimentSpendGate } from '../src/platform/experiment-spend-gate.js';

const options = (slotId: string): StructuredExperimentOptions => ({
  slotId,
  transportMaxRetries: 0,
  maxRetries: 0,
  routing: { order: ['p'], only: ['p'], allowFallbacks: false },
  maxTokens: 100,
  routerMetadata: true,
  generationLookup: null,
});

function setup() {
  const inner = {
    id: 'openrouter' as const,
    listModels: vi.fn().mockResolvedValue([]),
    listEndpoints: vi.fn().mockResolvedValue([]),
    complete: vi.fn(),
    embed: vi.fn(),
    completeStructured: vi.fn().mockResolvedValue({ data: {}, model: 'm', tokensIn: 1, tokensOut: 1, providerCostUsd: 0, costUsd: 0, raw: '{}', attempts: 1 }),
  };
  const gate = new ExperimentSpendGate();
  const guarded = new ExperimentGuardedProvider(inner as unknown as LLMProvider, gate);
  const request = (experiment?: StructuredExperimentOptions): StructuredRequest<unknown> => ({
    model: 'm',
    schema: z.unknown(),
    schemaName: REVIEW_SCHEMA_NAME,
    messages: [{ role: 'user', content: 'x' }],
    ...(experiment ? { experiment } : {}),
  });
  return { inner, gate, guarded, request };
}

describe('experiment spend gate', () => {
  it('opens for one slot at a time and admits one generation per opened slot', () => {
    const gate = new ExperimentSpendGate();
    expect(gate.tryOpen('x-1')).toBe(true);
    expect(gate.tryOpen('x-2')).toBe(false);
    expect(gate.consume('x-2')).toBe(false);
    expect(gate.consume('x-1', undefined, REVIEW_SCHEMA_NAME)).toBe(true);
    expect(gate.consume('x-1')).toBe(false);
    gate.close('x-2'); // closing another slot does nothing
    expect(gate.current).toBe('x-1');
    gate.close('x-1');
    expect(gate.current).toBeNull();
    expect(gate.consume('x-1')).toBe(false);
  });
});

describe('experiment-mode guarded provider', () => {
  it('refuses an ordinary structured call without reaching the provider', async () => {
    const { inner, guarded, request } = setup();
    await expect(guarded.completeStructured(request())).rejects.toThrow(/ordinary structured call/);
    expect(inner.completeStructured).not.toHaveBeenCalled();
  });

  it('refuses free-text completions and embeddings', async () => {
    const { inner, guarded } = setup();
    await expect(guarded.complete({ model: 'm', messages: [] } as never)).rejects.toThrow(/free-text completion/);
    await expect(guarded.embed(['x'])).rejects.toThrow(/embeddings/);
    expect(inner.complete).not.toHaveBeenCalled();
    expect(inner.embed).not.toHaveBeenCalled();
  });

  it('refuses an experiment request for a slot that is not open, or a second request', async () => {
    const { inner, gate, guarded, request } = setup();
    await expect(guarded.completeStructured(request(options('x-1')))).rejects.toThrow(/not the open slot/);
    gate.tryOpen('x-1');
    await expect(guarded.completeStructured(request(options('x-other')))).rejects.toThrow(/not the open slot/);
    await expect(guarded.completeStructured(request(options('x-1')))).resolves.toBeDefined();
    await expect(guarded.completeStructured(request(options('x-1')))).rejects.toThrow(/already made its request/);
    expect(inner.completeStructured).toHaveBeenCalledTimes(1);
  });

  it('passes free metadata through', async () => {
    const { inner, guarded } = setup();
    await guarded.listModels();
    await guarded.listEndpoints('m');
    expect(inner.listModels).toHaveBeenCalledTimes(1);
    expect(inner.listEndpoints).toHaveBeenCalledWith('m');
  });
});
