import { describe, expect, it } from 'vitest';
import { OPENROUTER_DEFAULT_TIMEOUT_MS, OpenRouterProvider, generationLookupDeadlineMs } from '@devdigest/reviewer-core';
import { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';
import { evaluateSlot, type FrozenExpectations } from '../src/experiments/hw2/eligibility.js';
import { DEFAULT_POLL_TIMEOUT_MS } from '../src/experiments/hw2/runner.js';
import { canonicalJson, sha256 } from '../src/modules/_shared/experiment.js';
import { EXPERIMENT_GENERATION_LOOKUP, EXPERIMENT_REQUEST_TIMEOUT_MS, loadConfig, loadExperimentConfig } from '../src/platform/config.js';

/**
 * Provenance as OpenRouter actually reported it in HW2 Gate 3:
 * - router metadata with `attempt: 1` and no `attempts` array (so no attempt count);
 * - a generation record, 29–38 s after the response, whose `model` and only
 *   provider response name the dated served version, not the requested slug.
 * A slot is eligible only when that record is found and agrees with the
 * frozen provider and served model; `attempt: 1` alone never proves one attempt.
 */
const REQUESTED = 'deepseek/deepseek-v4-flash';
const SERVED = 'deepseek/deepseek-v4-flash-20260423';
const analysis = { claimed_purpose: 'x' };
const frozen: FrozenExpectations = {
  providerName: 'DeepInfra',
  model: REQUESTED,
  servedModel: SERVED,
  intent: { derivation_id: null, head_sha: 'b502', prompt_version: 3, analysis_sha: sha256(canonicalJson(analysis)) },
  expectedDiffSha256: 'd'.repeat(64),
};
/** Router metadata summary of a Gate 3 response. */
const router = { selected: [{ provider: 'DeepInfra', model: SERVED }], attempt: 1, attemptsCount: null, requested: REQUESTED, strategy: 'direct' };
const response = { providerName: 'DeepInfra', endpointId: '934a69f9-bd54-474b-beca-24560f721e12', modelPermaslug: SERVED, status: 200 };
const found = { status: 'found', providerName: 'DeepInfra', model: SERVED, finishReason: 'stop', tokensPrompt: 1785, tokensCompletion: 438, totalCost: 0.00022896, providerResponses: [response] };
const notFound = { status: 'not_found', providerName: null, model: null, finishReason: null, tokensPrompt: null, tokensCompletion: null, totalCost: null, providerResponses: [] };
const attempt = (generation: unknown, patch: Record<string, unknown> = {}) => ({ dispatch: 'dispatched', outcome: 'valid', servedModel: REQUESTED, router, generation, ...patch });
const trace = (a: Record<string, unknown>) => ({
  experiment: { dispatch_state: 'completed', diff_sha256: 'd'.repeat(64), attempts: [a] },
  intent: { source: 'cache', status: 'used', derivation_id: null, head_sha: 'b502', prompt_version: 3, analysis },
});

describe('eligibility on Gate 3 provenance', () => {
  it('as stored in Gate 3 (in-run lookup not_found) stays unverified: router attempt 1 alone is no proof', () => {
    const verdict = evaluateSlot(trace(attempt(notFound)), frozen);
    expect(verdict).toMatchObject({ eligible: false, provenance: 'unverified', sources: ['router_metadata'] });
    expect(verdict.reasons).toEqual(['a single upstream attempt is not proven (router attempt/attempts or exactly one generation provider response)']);
  });

  it('1/2. a found record with one matching provider response makes the slot eligible and verified', () => {
    expect(evaluateSlot(trace(attempt(found)), frozen)).toEqual({ eligible: true, provenance: 'verified', sources: ['router_metadata', 'generation'], reasons: [] });
  });

  it('3. metadata permanently unavailable is unverified, and nothing stands in for it', () => {
    for (const generation of [notFound, { ...notFound, status: 'unavailable' }, null]) {
      expect(evaluateSlot(trace(attempt(generation)), frozen)).toMatchObject({ eligible: false, provenance: 'unverified' });
    }
  });

  it('4. more than one provider response is a fallback: unverified', () => {
    const two = { ...found, providerResponses: [{ ...response, status: 429 }, response] };
    const verdict = evaluateSlot(trace(attempt(two)), frozen);
    expect(verdict).toMatchObject({ eligible: false, provenance: 'unverified' });
    expect(verdict.reasons).toContain('generation shows 2 provider responses (fallback attempts)');
  });

  it.each([
    ['another provider in the record', { ...found, providerName: 'Novita' }],
    ['the requested slug in place of the served version', { ...found, model: REQUESTED }],
    ['no model in the record', { ...found, model: null }],
    ['a provider response from another provider', { ...found, providerResponses: [{ ...response, providerName: 'Novita' }] }],
    ['a provider response for another model version', { ...found, providerResponses: [{ ...response, modelPermaslug: 'deepseek/deepseek-v4-flash-20260601' }] }],
    ['a provider response that did not succeed', { ...found, providerResponses: [{ ...response, status: 429 }] }],
    ['a record that lists no provider responses', { ...found, providerResponses: [] }],
  ])('5. %s: unverified', (_label, generation) => {
    expect(evaluateSlot(trace(attempt(generation)), frozen)).toMatchObject({ eligible: false, provenance: 'unverified' });
  });

  it.each([
    ['the router selected another provider', { router: { ...router, selected: [{ provider: 'Novita', model: SERVED }] } }],
    ['the router selected another model version', { router: { ...router, selected: [{ provider: 'DeepInfra', model: 'deepseek/deepseek-v4-flash-20260601' }] } }],
    ['the router shows a second attempt', { router: { ...router, attempt: 2 } }],
    ['the response echoes another model', { servedModel: 'other/model' }],
  ])('6. conflicting router and generation metadata (%s): unverified', (_label, patch) => {
    expect(evaluateSlot(trace(attempt(found, patch)), frozen)).toMatchObject({ eligible: false, provenance: 'unverified' });
  });

  it('a found record still proves the single attempt without router metadata, and nothing else does', () => {
    expect(evaluateSlot(trace(attempt(found, { router: null })), frozen)).toMatchObject({ eligible: true, sources: ['generation'] });
    expect(evaluateSlot(trace(attempt(notFound, { router: null })), frozen)).toMatchObject({ eligible: false, sources: [] });
  });
});

describe('the generation lookup fits the runner', () => {
  it('experiment mode polls with the Gate 3 policy, or not at all', () => {
    const env = {
      DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-gen00001',
      DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra/fp8',
      DEVDIGEST_EXPERIMENT_MODEL: REQUESTED,
      DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '16000',
      DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000009',
      DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000018',
    } as NodeJS.ProcessEnv;
    expect(EXPERIMENT_GENERATION_LOOKUP).toEqual({ attempts: 13, delayMs: 5_000 });
    expect(loadExperimentConfig(env)!.generationLookup).toEqual(EXPERIMENT_GENERATION_LOOKUP);
    expect(loadExperimentConfig({ ...env, DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP: '0' })!.generationLookup).toBeNull();
    expect(loadExperimentConfig(env)!.servedModel).toBeNull();
    expect(loadExperimentConfig({ ...env, DEVDIGEST_EXPERIMENT_SERVED_MODEL: SERVED })!.servedModel).toBe(SERVED);
  });

  it('covers the record lag seen in Gate 3 (29–38 s) with margin', () => {
    expect((EXPERIMENT_GENERATION_LOOKUP.attempts - 1) * EXPERIMENT_GENERATION_LOOKUP.delayMs).toBeGreaterThanOrEqual(1.5 * 38_000);
  });

  it('a slot cannot turn ambiguous while its run waits for the request and the lookup', () => {
    // The run settles at most one experiment request timeout plus the lookup
    // deadline after dispatch; the runner records `ambiguous` only after DEFAULT_POLL_TIMEOUT_MS.
    const worstCase = EXPERIMENT_REQUEST_TIMEOUT_MS + generationLookupDeadlineMs(EXPERIMENT_GENERATION_LOOKUP);
    expect(worstCase + 30_000).toBeLessThanOrEqual(DEFAULT_POLL_TIMEOUT_MS);
  });

  it('an experiment request may run long enough for a complete review at the slowest observed throughput', () => {
    // Gate 3: 432 tokens in 49.3 s (8.8 tokens/s); complete reviews of this model reached about 2,750 tokens.
    const slowest = 432 / 49.3;
    expect(EXPERIMENT_REQUEST_TIMEOUT_MS / 1000 * slowest).toBeGreaterThanOrEqual(2_750);
    expect(OPENROUTER_DEFAULT_TIMEOUT_MS / 1000 * slowest).toBeLessThan(800); // the default would not
  });

  it('the experiment OpenRouter provider gets the experiment timeout; other modes keep the default', async () => {
    const secrets = { get: async () => 'sk-or-test-not-a-real-key' };
    const timeoutOf = async (env: Record<string, string>) => {
      const config = loadConfig({ NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);
      const provider = await (new Container(config, {} as Db, { secrets }) as unknown as { buildLlm(id: string): Promise<OpenRouterProvider> }).buildLlm('openrouter');
      return (provider as unknown as { timeoutMs: number }).timeoutMs;
    };
    const experiment = {
      DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-time0001', DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra/fp8', DEVDIGEST_EXPERIMENT_MODEL: REQUESTED,
      DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '16000', DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000009', DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000018',
    };
    expect(await timeoutOf(experiment)).toBe(EXPERIMENT_REQUEST_TIMEOUT_MS);
    expect(await timeoutOf({})).toBe(OPENROUTER_DEFAULT_TIMEOUT_MS);
  });
});
