import { describe, expect, it } from 'vitest';
import type { OpenRouterEndpointInfo } from '@devdigest/shared';
import type { ExperimentConfig } from '../src/platform/config.js';
import {
  CHAT_TEMPLATE_ALLOWANCE_TOKENS,
  canonicalJson,
  effectivePriceLimits,
  experimentOptions,
  inputUpperBound,
  preflight,
  requestFingerprints,
} from '../src/modules/_shared/experiment.js';

const config: ExperimentConfig = {
  stackId: 'hw2f-test',
  provider: 'deepinfra',
  providerName: null,
  model: 'deepseek/deepseek-v4-flash',
  maxOutputTokens: 4000,
  prices: { input: 0.0000001, output: 0.0000002, request: 0 },
  generationLookup: null,
};
const endpoint = (patch: Partial<OpenRouterEndpointInfo> = {}): OpenRouterEndpointInfo => ({
  providerName: 'DeepInfra',
  tag: 'deepinfra',
  quantization: 'fp8',
  contextLength: 128_000,
  maxCompletionTokens: 16_384,
  pricing: { prompt: 0.00000014, completion: 0.00000028, request: 0 },
  ...patch,
});

describe('effective prices and limits', () => {
  it('takes the more expensive of frozen and live prices and the tightest limits', () => {
    const limits = effectivePriceLimits(config, [endpoint(), endpoint({ tag: 'deepinfra/turbo', contextLength: 64_000, pricing: { prompt: 0.0000003, completion: 0.0000001, request: 0.0001 } })])!;
    expect(limits.prices).toEqual({ input: 0.0000003, output: 0.00000028, request: 0.0001 });
    expect(limits.contextLength).toBe(64_000);
  });

  it('matches only the frozen provider (and display name once frozen); no match fails closed', () => {
    expect(effectivePriceLimits(config, [endpoint({ providerName: 'Novita', tag: 'novita' })])).toBeNull();
    expect(effectivePriceLimits({ ...config, providerName: 'DeepInfra' }, [endpoint({ providerName: 'Other', tag: 'deepinfra' })])).toBeNull();
    expect(effectivePriceLimits(config, [])).toBeNull();
  });
});

describe('preflight', () => {
  const limits = effectivePriceLimits(config, [endpoint()])!;

  it('computes the worst case with the contingency and accepts it within the reservation', () => {
    const decision = preflight({ inputUpperBound: 10_000, outputCap: 4000, limits, reservationUsd: 0.01 });
    // (10000 × 1.4e-7 + 4000 × 2.8e-7) × 1.5 = 0.00378
    expect(decision).toEqual({ ok: true, worstCaseUsd: expect.closeTo(0.00378, 8) });
  });

  it.each([
    ['above the reservation', { inputUpperBound: 10_000, outputCap: 4000, reservationUsd: 0.003 }, /exceeds the slot reservation/],
    ['beyond the context window', { inputUpperBound: 125_000, outputCap: 4000, reservationUsd: 1 }, /exceeds the context length/],
    ['beyond the max completion tokens', { inputUpperBound: 1000, outputCap: 20_000, reservationUsd: 1 }, /max completion tokens/],
  ])('refuses %s', (_label, args, reason) => {
    expect(preflight({ ...args, limits })).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
  });

  it('refuses when the context length is unknown', () => {
    expect(preflight({ inputUpperBound: 1, outputCap: 1, limits: { ...limits, contextLength: null }, reservationUsd: 1 })).toMatchObject({ ok: false });
  });
});

describe('input upper bound', () => {
  it('is never below the UTF-8 byte length, plus the template allowance', () => {
    const body = JSON.stringify({ text: 'é'.repeat(100) });
    expect(inputUpperBound(body, 3)).toBe(Buffer.byteLength(body, 'utf8') + CHAT_TEMPLATE_ALLOWANCE_TOKENS);
    expect(inputUpperBound('ab', 5000)).toBe(5000 + CHAT_TEMPLATE_ALLOWANCE_TOKENS);
  });
});

describe('request fingerprints', () => {
  const diff = { raw: 'diff --git a/a.ts b/a.ts\n+x', files: [{ path: 'a.ts', additions: 1, deletions: 0, hunks: [] }] } as never;
  const base = { systemPrompt: 'S', diff, task: 'Review PR #502', prDescription: 'body' };
  const options = experimentOptions(config);

  it('only the Skill slot separates the conditions', () => {
    const without = requestFingerprints(base, config.model, options, 's');
    const withSkill = requestFingerprints({ ...base, skills: ['### breaking-change\nrule'] }, config.model, options, 's');
    expect(withSkill.nonSkill).toBe(without.nonSkill);
    expect(withSkill.skill).not.toBe(without.skill);
  });

  it.each([
    ['the system prompt', { ...base, systemPrompt: 'S2' }],
    ['the task', { ...base, task: 'Review PR #501' }],
    ['the diff', { ...base, diff: { raw: 'diff --git a/b.ts b/b.ts\n+y', files: [] } as never }],
    ['the PR description', { ...base, prDescription: 'other' }],
  ])('changes when %s changes', (_label, input) => {
    expect(requestFingerprints(input, config.model, options, 's').nonSkill).not.toBe(requestFingerprints(base, config.model, options, 's').nonSkill);
  });

  it('changes with the model, routing or output cap', () => {
    const reference = requestFingerprints(base, config.model, options, 's').nonSkill;
    expect(requestFingerprints(base, 'other/model', options, 's').nonSkill).not.toBe(reference);
    expect(requestFingerprints(base, config.model, experimentOptions({ ...config, provider: 'novita' }), 's').nonSkill).not.toBe(reference);
    expect(requestFingerprints(base, config.model, experimentOptions({ ...config, maxOutputTokens: 3000 }), 's').nonSkill).not.toBe(reference);
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
