import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, StructuredRequest, StructuredExperimentOptions } from '@devdigest/shared';
import {
  extractionCapabilityProblem, extractionRequestSha256, type ConventionsCapability,
  type ExtractionBinding,
} from '../src/modules/_shared/conventions-experiment.js';
import { sha256 } from '../src/modules/_shared/experiment.js';
import { ExtractionReceipts } from '../src/platform/experiment-receipts.js';
import { ExperimentGuardedProvider, ExperimentSpendGate } from '../src/platform/experiment-spend-gate.js';
import { authorizeExtraction, receiptOutcome, runExtraction, type ExtractionStack } from '../src/experiments/hw2/conventions-runner.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';
import type { ExtractionPreview } from '../src/modules/experiments/conventions.js';

const hash = 'a'.repeat(64);
const binding: ExtractionBinding = {
  slot_id: 'conv-one', stack_id: 'hw2f-isol001',
  database_name: 'devdigest_hw2f_isol001', postgres_system_identifier: '123456',
  workspace_id: 'workspace-one', repository_id: 'repo-one',
  repository_full_name: 'fastify/fastify', repository_commit_sha: 'b'.repeat(40),
  implementation_fingerprint: hash, indexed_paths_sha256: hash,
  samples_sha256: hash, request_sha256: hash,
  adapter: 'openrouter', model: 'model', upstream_provider_slug: 'deepinfra/fp8',
};
const token = 'opaque-token';
const now = new Date('2026-10-27T10:00:00Z');
const capability = (): ConventionsCapability => ({
  ...binding, version: 2, operation: 'conventions.extract',
  capability_id: 'c'.repeat(64), expected_provider_name: 'DeepInfra',
  expected_served_model: 'served-model', reservation_usd: 0.01,
  phase: 'exploration', budget_usd: 0.01, cumulative_ceiling_usd: 0.06,
  authorized_at: '2026-10-27T09:55:00Z',
  expires_at: '2026-10-27T10:10:00Z',
  token_sha256: sha256(token),
});
const options: StructuredExperimentOptions = {
  slotId: binding.slot_id, transportMaxRetries: 0, maxRetries: 0,
  routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allowFallbacks: false },
  maxTokens: 4000, routerMetadata: true, generationLookup: null,
};
const request = (message = 'sample'): StructuredRequest<{ candidates: string[] }> => ({
  model: 'model', schema: z.object({ candidates: z.array(z.string()) }),
  schemaName: 'ConventionExtraction', messages: [{ role: 'user', content: message }],
  temperature: 0.1, maxTokens: 4000, maxRetries: 0, timeoutMs: 360_000, experiment: options,
});

describe('conventions one-use capability', () => {
  it('binds every operation, identity, revision, model, provider and exact request field', () => {
    expect(extractionCapabilityProblem(capability(), token, binding, now)).toBeNull();
    for (const key of Object.keys(binding) as Array<keyof ExtractionBinding>) {
      const changed = { ...binding, [key]: `wrong-${binding[key]}` };
      expect(extractionCapabilityProblem(capability(), token, changed, now)).not.toBeNull();
    }
    expect(extractionCapabilityProblem({ ...capability(), version: 1 }, token, binding, now)).toMatch(/version/);
    expect(extractionCapabilityProblem({ ...capability(), operation: 'reviews.run' }, token, binding, now)).toMatch(/operation/);
    expect(extractionCapabilityProblem(capability(), 'wrong', binding, now)).toMatch(/token/);
    expect(extractionCapabilityProblem(capability(), token, binding, new Date('2026-10-27T10:10:00Z'))).toMatch(/expired/);
  });

  it('fingerprints messages, schema, model, routing, output cap and retry policy', () => {
    const base = extractionRequestSha256(request(), options);
    expect(extractionRequestSha256(request('other'), options)).not.toBe(base);
    expect(extractionRequestSha256({ ...request(), model: 'other' }, options)).not.toBe(base);
    expect(extractionRequestSha256({ ...request(), schemaName: 'Other' }, options)).not.toBe(base);
    expect(extractionRequestSha256(request(), { ...options, maxTokens: 3000 })).not.toBe(base);
    expect(extractionRequestSha256(request(), { ...options, routing: { order: ['other'], only: ['other'], allowFallbacks: false } })).not.toBe(base);
    expect(extractionRequestSha256(request(), { ...options, transportMaxRetries: 1 as 0 })).not.toBe(base);
  });

  it('a review slot cannot dispatch an extraction request, and the extraction grant refuses changed input or replay', async () => {
    const inner = {
      id: 'openrouter' as const, listModels: vi.fn(), complete: vi.fn(), embed: vi.fn(),
      completeStructured: vi.fn().mockResolvedValue({ data: { candidates: [] } }),
    };
    const gate = new ExperimentSpendGate();
    const provider = new ExperimentGuardedProvider(inner as unknown as LLMProvider, gate);
    gate.tryOpen('review-slot');
    await expect(provider.completeStructured({ ...request(), experiment: { ...options, slotId: 'review-slot' } })).rejects.toThrow(/not the open slot/);
    gate.close('review-slot');
    const fp = extractionRequestSha256(request(), options);
    expect(gate.tryOpenExtraction(options.slotId, fp, Date.now() + 60_000)).toBe(true);
    await expect(provider.completeStructured(request('tampered'))).rejects.toThrow(/not the open slot/);
    await expect(provider.completeStructured(request())).resolves.toBeDefined();
    await expect(provider.completeStructured(request())).rejects.toThrow(/already made its request/);
    expect(inner.completeStructured).toHaveBeenCalledTimes(1);
    gate.close(options.slotId);
    expect(gate.tryOpenExtraction(options.slotId, fp, Date.now() + 60_000)).toBe(true);
    const other = { ...inner, id: 'anthropic' as const, completeStructured: vi.fn() };
    const nonRouter = new ExperimentGuardedProvider(other as unknown as LLMProvider, gate);
    await expect(nonRouter.completeStructured(request())).rejects.toThrow(/requires OpenRouter/);
    gate.close(options.slotId);
    expect(gate.tryOpenExtraction(options.slotId, fp, Date.now() - 1)).toBe(false);
    const expires = Date.now() + 1000;
    expect(gate.tryOpenExtraction(options.slotId, fp, expires)).toBe(true);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expires);
    try {
      await expect(provider.completeStructured(request())).rejects.toThrow(/not the open slot/);
    } finally { clock.mockRestore(); }
    gate.close(options.slotId);
    expect(other.completeStructured).not.toHaveBeenCalled();
    await expect(provider.complete({ model: 'm', messages: [] } as never)).rejects.toThrow(/free-text/);
    await expect(provider.embed(['x'])).rejects.toThrow(/embeddings/);
  });
});

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const root = () => {
  const path = mkdtempSync(join(tmpdir(), 'hw2-receipt-'));
  roots.push(path);
  return path;
};

describe('durable extraction receipt', () => {
  it('claims exclusively, persists transitions, and refuses a second claim after restart', () => {
    const dir = root();
    const receipt = new ExtractionReceipts(dir);
    const identity = { capability_id: hash, slot_id: 'conv-one', request_sha256: hash };
    receipt.claim(identity);
    receipt.append('conv-one', { ...identity, state: 'dispatching' });
    receipt.append('conv-one', { ...identity, state: 'model_result', model_result: { candidates: [{ rule: 'public source rule' }] } });
    expect(new ExtractionReceipts(dir).read('conv-one').map((event) => event.state)).toEqual(['claimed', 'dispatching', 'model_result']);
    expect(new ExtractionReceipts(dir).read('conv-one')[2]?.model_result).toEqual({ candidates: [{ rule: 'public source rule' }] });
    expect(() => new ExtractionReceipts(dir).claim(identity)).toThrow();
  });

  it('does not follow a symlinked slot path', () => {
    const dir = root();
    mkdirSync(join(dir, 'conventions-receipts'));
    symlinkSync(join(dir, 'outside'), join(dir, 'conventions-receipts', 'conv-one.jsonl'));
    expect(() => new ExtractionReceipts(dir).claim({
      capability_id: hash, slot_id: 'conv-one', request_sha256: hash,
    })).toThrow();
  });

  it('does not count a persisted row when provider metadata is absent or conflicting', () => {
    const cap = capability();
    const claim = { at: now.toISOString(), capability_id: cap.capability_id, slot_id: cap.slot_id, request_sha256: cap.request_sha256 };
    const attempt = {
      sequence: 1, dispatch: 'dispatched' as const, outcome: 'valid' as const,
      failureReason: null, httpStatus: 200, startedAt: now.toISOString(), durationMs: 1,
      requested: { model: cap.model, routing: options.routing, maxTokens: 4000 },
      responseId: 'gen-test', generationIdHeader: null, servedModel: cap.model,
      finishReason: 'stop', tokensIn: 10, tokensOut: 10, costUsd: 0.001,
      router: null, generation: null, errorDetail: null,
    };
    const events = [
      { ...claim, state: 'claimed' as const },
      { ...claim, state: 'model_finished' as const, attempt },
      { ...claim, state: 'persisted' as const, cost_usd: 0.001, candidate_ids: ['one'], candidate_digest: hash },
    ];
    expect(receiptOutcome(events, cap).state).toBe('ambiguous');
    const proven = { ...attempt, router: {
      selected: [{ provider: 'DeepInfra', model: cap.expected_served_model }],
      attempt: 1, attemptsCount: 1, requested: cap.model, strategy: 'direct',
    } };
    expect(receiptOutcome([{ ...events[0]! }, { ...events[1]!, attempt: proven }, { ...events[2]! }], cap).state).toBe('completed');
    const conflicting = { ...proven, router: { ...proven.router, selected: [{ provider: 'Other', model: cap.expected_served_model }] } };
    expect(receiptOutcome([{ ...events[0]! }, { ...events[1]!, attempt: conflicting }, { ...events[2]! }], cap).state).toBe('ambiguous');
  });

  it('retains full reservation on a post-dispatch 429 or missing usage', () => {
    const claimed = { at: now.toISOString(), capability_id: hash, slot_id: 'conv-one', request_sha256: hash };
    expect(receiptOutcome([
      { ...claimed, state: 'claimed' },
      { ...claimed, state: 'dispatching' },
      { ...claimed, state: 'failed', cost_usd: null, reason: 'post-dispatch 429' },
    ])).toMatchObject({ state: 'ambiguous', costUsd: null });
    expect(receiptOutcome([{ ...claimed, state: 'persisted', candidate_ids: ['id'], cost_usd: null }]))
      .toMatchObject({ state: 'ambiguous', costUsd: null });
  });
});


const preview = (): ExtractionPreview => ({
  ...binding,
  repository_commit_sha: '5df959f3af698823dd582f1c3661f3e80df0b5da',
  expected_provider_name: 'DeepInfra', expected_served_model: 'served-model',
  input_upper_bound: 1000, output_cap: 4000, worst_case_usd: 0.002,
  reservation_usd: 0.01, ok: true, reason: null,
});
const fakeStack = (api: unknown): ExtractionStack => ({
  api: api as ExtractionStack['api'], apiUrl: 'http://127.0.0.1:3951',
  stackId: binding.stack_id, database: binding.database_name,
  container: 'isolated-postgres',
  identity: {
    stack_id: binding.stack_id, database: binding.database_name,
    postgres_system_identifier: binding.postgres_system_identifier,
    database_is_disposable: true, repos: ['fastify/fastify'],
    fixture_pulls: [], demo_pr_3_present: false, fixture_clone_present: false,
    provider: binding.upstream_provider_slug, provider_name: 'DeepInfra',
    model: binding.model, served_model: 'served-model', max_output_tokens: 4000,
    in_flight_slot: null, secrets_path: '/tmp/.devdigest/hw2-experiments/secrets.json',
    openrouter_key_configured: true,
  },
});

describe('conventions authorization and runner accounting', () => {
  it('writes a one-use capability with a 15-minute expiry and refuses replay', () => {
    const h = root();
    const stack = fakeStack({});
    const first = authorizeExtraction({
      preview: preview(), stack, slotId: binding.slot_id, reservationUsd: 0.01,
      cumulativeCeilingUsd: 0.05, keyUsage: { limit_remaining: 1 }, home: h,
    });
    expect(first.capability.version).toBe(2);
    expect(Date.parse(first.capability.expires_at) - Date.parse(first.capability.authorized_at)).toBe(15 * 60_000);
    expect(() => authorizeExtraction({
      preview: preview(), stack, slotId: binding.slot_id, reservationUsd: 0.01,
      cumulativeCeilingUsd: 0.05, keyUsage: { limit_remaining: 1 }, home: h,
    })).toThrow(/live capability/);
  });

  it('fails closed on price, repository, cluster and key-limit mismatches', () => {
    const stack = fakeStack({});
    const make = (p: ExtractionPreview, limit = 1) => authorizeExtraction({
      preview: p, stack, slotId: binding.slot_id, reservationUsd: 0.01,
      cumulativeCeilingUsd: 0.05, keyUsage: { limit_remaining: limit }, home: root(),
    });
    expect(() => make({ ...preview(), worst_case_usd: 0.02 })).toThrow(/reservation margin/);
    expect(() => make({ ...preview(), repository_commit_sha: 'c'.repeat(40) })).toThrow(/repository revision/);
    expect(() => make({ ...preview(), postgres_system_identifier: 'wrong' })).toThrow(/PostgreSQL cluster/);
    expect(() => make(preview(), 0)).toThrow(/remaining limit/);
  });

  it('does not leave a usable capability when token creation fails', () => {
    const h = root();
    const dir = join(h, '.devdigest', 'hw2-experiments', binding.stack_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'capability.token'), 'old');
    expect(() => authorizeExtraction({
      preview: preview(), stack: fakeStack({}), slotId: binding.slot_id,
      reservationUsd: 0.01, cumulativeCeilingUsd: 0.05,
      keyUsage: { limit_remaining: 1 }, home: h,
    })).toThrow();
    expect(existsSync(join(dir, 'capability.json'))).toBe(false);
  });

  it('leaves no usable capability when the authorization log cannot be written', () => {
    const h = root();
    const experimentRoot = join(h, '.devdigest', 'hw2-experiments');
    mkdirSync(experimentRoot, { recursive: true });
    symlinkSync(join(experimentRoot, 'nonexistent-target'), join(experimentRoot, 'authorizations.jsonl'));
    expect(() => authorizeExtraction({
      preview: preview(), stack: fakeStack({}), slotId: binding.slot_id,
      reservationUsd: 0.01, cumulativeCeilingUsd: 0.05,
      keyUsage: { limit_remaining: 1 }, home: h,
    })).toThrow();
    const dir = join(experimentRoot, binding.stack_id);
    expect(existsSync(join(dir, 'capability.json'))).toBe(false);
    expect(existsSync(join(dir, 'capability.token'))).toBe(false);
  });

  it('charges an HTTP 429 after dispatch as ambiguous, and never resends the slot', async () => {
    const h = root();
    const dir = join(h, '.devdigest', 'hw2-experiments');
    const receipt = new ExtractionReceipts(dir);
    const cap = {
      ...capability(), repository_commit_sha: preview().repository_commit_sha,
      authorized_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
    };
    const fakeApi = {
      post: vi.fn().mockResolvedValue(preview()),
      request: vi.fn().mockImplementation(async () => {
        const id = { capability_id: cap.capability_id, slot_id: cap.slot_id, request_sha256: cap.request_sha256 };
        receipt.claim(id);
        receipt.append(cap.slot_id, { ...id, state: 'dispatching' });
        receipt.append(cap.slot_id, { ...id, state: 'failed', cost_usd: null, reason: 'HTTP 429' });
        throw new Error('POST extract → 429');
      }),
    };
    const ledger = new Ledger(dir);
    ledger.acquire({ pid: process.pid, stackId: cap.stack_id });
    try {
      const result = await runExtraction({
        stack: fakeStack(fakeApi), preview: preview(), capability: cap, token,
        ledger, log: () => {},
      });
      expect(result.state).toBe('ambiguous');
      expect(ledger.slots().get(cap.slot_id)?.reservation_usd).toBe(0.01);
      await expect(runExtraction({
        stack: fakeStack(fakeApi), preview: preview(), capability: cap, token,
        ledger, log: () => {},
      })).rejects.toThrow(/already appears/);
      expect(fakeApi.request).toHaveBeenCalledTimes(1);
    } finally { ledger.release(); }
  });
});
