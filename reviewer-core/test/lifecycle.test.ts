import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, StructuredExperimentOptions, StructuredResult } from '@devdigest/shared';
import { MockGitClient } from '../../server/src/adapters/mocks.js';
import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { PARTIAL_OUTPUT_MAX_BYTES, ProviderOutputError, ReviewRefusedError, boundUtf8 } from '../src/llm/provider-output-error.js';
import type { AttemptLifecycleEvent } from '../src/llm/lifecycle.js';
import { reviewPullRequest, type ReviewStageAttemptEvent, type ReviewStageEvent } from '../src/review/run.js';

/**
 * Stage and attempt lifecycle evidence (the run trace's `stages[]`) and the
 * typed provider output error. Every prompt and model output below is
 * synthetic; no provider is contacted.
 */

const Result = z.object({ ok: z.boolean() });
const CLEAN = JSON.stringify({ verdict: 'approve', summary: 'clean', score: 100, findings: [] });

const TWO_FILES = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -0,0 +1 @@
+export const a = 1;
diff --git b/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -0,0 +1 @@
+export const b = 2;`;

function chat(content: string, patch: Record<string, unknown> = {}) {
  return {
    id: 'gen-1700000000-synthetic01',
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1142, completion_tokens: 431, cost: 0.0002 },
    ...patch,
  };
}

/** The real provider with its SDK client replaced: ordinary mode, `create` resolves (or rejects) in order. */
function normalProvider(responses: Array<unknown | Error>) {
  const create = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce(r);
  }
  const provider = new OpenRouterProvider('sk-or-test-key-000000000000');
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return { provider, create };
}

/** Experiment mode: `create().withResponse()`. */
function experimentProvider(response: unknown | Error, lookups: Array<{ status: number; body?: unknown }> = []) {
  const create = vi.fn(() => ({
    withResponse: () =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve({ data: response, response: { headers: new Headers() } }),
  }));
  const fetchImpl = vi.fn();
  for (const l of lookups) fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(l.body ?? {}), { status: l.status }));
  const provider = new OpenRouterProvider('sk-or-test-key-000000000000', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return { provider, create };
}

const experiment = (patch: Partial<StructuredExperimentOptions> = {}): StructuredExperimentOptions => ({
  slotId: 'c-17-with-synthetic',
  transportMaxRetries: 0,
  maxRetries: 0,
  routing: { order: ['deepinfra/fp8'], only: ['deepinfra/fp8'], allowFallbacks: false },
  maxTokens: 4000,
  routerMetadata: true,
  generationLookup: null,
  ...patch,
});

function sinks() {
  const stages: ReviewStageEvent[] = [];
  const attempts: ReviewStageAttemptEvent[] = [];
  return { stages, attempts, onStage: (e: ReviewStageEvent) => stages.push(e), onStageAttempt: (e: ReviewStageAttemptEvent) => attempts.push(e) };
}

const phases = (events: AttemptLifecycleEvent[]) => events.map((e) => `${e.attempt}:${e.phase}${e.outcome ? `:${e.outcome}` : ''}`);

describe('stage lifecycle (reviewPullRequest)', () => {
  it('single pass: one stage, prepared with the exact assembly sent, then completed with its usage', async () => {
    const diff = await new MockGitClient().diff();
    const { provider, create } = normalProvider([chat(CLEAN)]);
    const s = sinks();
    const outcome = await reviewPullRequest({ systemPrompt: 'Synthetic reviewer.', model: 'm', diff, llm: provider, strategy: 'single-pass', skills: ['### Synthetic skill\nCheck it.'], ...s });

    expect(s.stages.map((e) => e.type)).toEqual(['prepared', 'completed']);
    const prepared = s.stages[0] as Extract<ReviewStageEvent, { type: 'prepared' }>;
    expect(prepared.stage).toEqual({ stage_id: 'single-0', kind: 'single', index: 0, count: 1, label: 'all files' });
    expect(prepared.assembly).toEqual(outcome.assembly);
    // The assembly is the decomposition of the messages the provider received.
    const sent = create.mock.calls[0]![0].messages as Array<{ role: string; content: string }>;
    expect(sent[0]!.content.startsWith(prepared.assembly.system)).toBe(true);
    expect(sent[0]!.content).toContain(prepared.assembly.skills!);
    expect(sent[1]!.content).toBe(prepared.assembly.user);
    expect(s.stages[1]).toMatchObject({ type: 'completed', stage_id: 'single-0', usage: { tokens_in: 1142, tokens_out: 431, provider_cost_usd: 0.0002 } });
    expect(s.attempts.map((a) => a.stage_id)).toEqual(['single-0', 'single-0']);
    expect(phases(s.attempts)).toEqual(['1:submitted', '1:response_received']);
    expect(s.attempts[1]).toMatchObject({ response_id: 'gen-1700000000-synthetic01', usage: { tokens_in: 1142, tokens_out: 431, cost_usd: 0.0002 } });
  });

  it('map-reduce: one stage per chunk in order; a failure in chunk 2 keeps chunk 1 completed with its usage', async () => {
    const diff = await new MockGitClient({ diff: TWO_FILES }).diff();
    let calls = 0;
    const provider: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req: { model: string }): Promise<StructuredResult<T>> {
        if (++calls === 2) throw new Error('upstream exploded');
        return { data: JSON.parse(CLEAN) as T, model: req.model, tokensIn: 700, tokensOut: 90, providerCostUsd: 0.0001, costUsd: 0.0001, raw: CLEAN, attempts: 1 };
      },
      async listModels() { return []; },
      async complete() { throw new Error('not used'); },
      async embed() { return []; },
    };
    const s = sinks();
    await expect(reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: provider, strategy: 'map-reduce', ...s })).rejects.toThrow('upstream exploded');
    expect(s.stages.map((e) => `${e.type}:${'stage' in e ? e.stage.stage_id : e.stage_id}`)).toEqual([
      'prepared:map-0',
      'completed:map-0',
      'prepared:map-1',
      'failed:map-1',
    ]);
    const [first, , second] = s.stages as Array<Extract<ReviewStageEvent, { type: 'prepared' }>>;
    expect(first!.assembly.user).toContain('a.ts');
    expect(second!.assembly.user).toContain('b.ts');
    expect(second!.assembly.user).not.toContain('export const a');
    expect(s.stages[1]).toMatchObject({ usage: { tokens_in: 700, tokens_out: 90 } });
    // This provider reports no attempts: the stage events alone carry the evidence.
    expect(s.attempts).toEqual([]);
  });

  it('a cancellation before the call prepares no stage', async () => {
    const diff = await new MockGitClient().diff();
    const { provider, create } = normalProvider([chat(CLEAN)]);
    const s = sinks();
    await expect(
      reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: provider, checkCancelled: () => { throw new Error('cancelled'); }, ...s }),
    ).rejects.toThrow('cancelled');
    expect(s.stages).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('the experiment strategy guard is a typed refusal before any stage', async () => {
    const diff = await new MockGitClient().diff();
    const { provider, create } = normalProvider([]);
    const s = sinks();
    const error = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: provider, strategy: 'auto', experiment: experiment(), ...s }).catch((e) => e);
    expect(error).toBeInstanceOf(ReviewRefusedError);
    expect(error).toMatchObject({ code: 'strategy_guard', message: "Experiment mode requires strategy 'single-pass' (one request per slot)" });
    expect(s.stages).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('a sink that throws never changes the review', async () => {
    const diff = await new MockGitClient().diff();
    const { provider } = normalProvider([chat(CLEAN)]);
    const outcome = await reviewPullRequest({
      systemPrompt: 's', model: 'm', diff, llm: provider,
      onStage: () => { throw new Error('sink'); },
      onStageAttempt: () => { throw new Error('sink'); },
    });
    expect(outcome.review.verdict).toBe('approve');
  });
});

describe('attempts and typed output errors (OpenRouter, ordinary mode)', () => {
  it('a structured retry is a second attempt of the SAME stage, with each response counted once', async () => {
    const diff = await new MockGitClient().diff();
    const { provider } = normalProvider([chat('{"not":"a review"}', { id: 'gen-1-first' }), chat(CLEAN, { id: 'gen-2-second' })]);
    const s = sinks();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: provider, ...s });
    expect(s.stages.filter((e) => e.type === 'prepared')).toHaveLength(1);
    expect(new Set(s.attempts.map((a) => a.stage_id))).toEqual(new Set(['single-0']));
    expect(phases(s.attempts)).toEqual(['1:submitted', '1:response_received', '1:failed:schema_invalid', '2:submitted', '2:response_received']);
    expect(s.attempts.map((a) => a.retry)).toEqual(['initial', 'initial', 'initial', 'structured_retry', 'structured_retry']);
    expect(s.attempts.filter((a) => a.usage).map((a) => a.response_id)).toEqual(['gen-1-first', 'gen-2-second']);
    expect(s.attempts.find((a) => a.phase === 'failed')!.usage).toBeUndefined();
    expect(s.stages.at(-1)).toMatchObject({ type: 'completed', usage: { tokens_in: 2284, tokens_out: 862 }, attempts: 2 });
  });

  it('exhausted retries throw ProviderOutputError with the last text, the summed usage and the response id', async () => {
    const { provider } = normalProvider([
      chat('{"ok": "nope"', { choices: [{ message: { content: '{"ok": "nope"' }, finish_reason: 'length' }] }),
      chat('{"ok": "still nope"', { id: 'gen-last', choices: [{ message: { content: '{"ok": "still nope"' }, finish_reason: 'length' }] }),
    ]);
    const error = await provider
      .completeStructured({ model: 'm', schema: Result, schemaName: 'Result', messages: [{ role: 'user', content: 'x' }], maxRetries: 1 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect(error.message).toBe('OpenRouter structured output failed schema validation for Result');
    expect(error).toMatchObject({
      kind: 'truncated',
      partialText: '{"ok": "still nope"',
      finishReason: 'length',
      responseId: 'gen-last',
      attempts: 2,
      usage: { tokensIn: 2284, tokensOut: 862, costUsd: 0.0004 },
    });
  });

  it('an HTTP error before any response is a failed attempt with its status and no usage', async () => {
    const diff = await new MockGitClient().diff();
    const status = Object.assign(new Error('429 Provider returned error: raw upstream text'), { status: 429 });
    const { provider } = normalProvider([status]);
    const s = sinks();
    await expect(reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: provider, ...s })).rejects.toThrow();
    expect(phases(s.attempts)).toEqual(['1:submitted', '1:failed:network_error']);
    expect(s.attempts.some((a) => a.usage)).toBe(false);
    expect(JSON.stringify(s.attempts)).not.toContain('raw upstream text');
  });
});

describe('attempts and typed output errors (OpenRouter, experiment mode)', () => {
  const request = (lifecycle?: { stageId: string; report: (e: AttemptLifecycleEvent) => void }) => ({
    model: 'deepseek/deepseek-v4-flash',
    schema: Result,
    schemaName: 'Review',
    messages: [{ role: 'user' as const, content: 'synthetic' }],
    experiment: experiment(),
    ...(lifecycle ? { lifecycle } : {}),
  });

  it('a length stop throws ProviderOutputError carrying the bounded partial text, usage, finish_reason and response id', async () => {
    const partial = `{"verdict":"comment","summary":"${'x'.repeat(PARTIAL_OUTPUT_MAX_BYTES)}`;
    const { provider } = experimentProvider(
      chat(partial, { id: 'gen-1793471676-synthetic', choices: [{ message: { content: partial }, finish_reason: 'length' }], usage: { prompt_tokens: 1142, completion_tokens: 4000, cost: 0.00082278, completion_tokens_details: { reasoning_tokens: 2612 } } }),
    );
    const events: AttemptLifecycleEvent[] = [];
    const error = await provider.completeStructured(request({ stageId: 'single-0', report: (e) => events.push(e) })).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect(error.message).toBe('output reached the max_tokens cap (finish_reason=length) for Review; experiment mode does not reprompt');
    expect(error).toMatchObject({
      kind: 'truncated',
      finishReason: 'length',
      responseId: 'gen-1793471676-synthetic',
      usage: { tokensIn: 1142, tokensOut: 4000, costUsd: 0.00082278 },
      partialTotalBytes: Buffer.byteLength(partial),
      attempts: 1,
    });
    expect(Buffer.byteLength(error.partialText)).toBe(PARTIAL_OUTPUT_MAX_BYTES);
    expect(partial.startsWith(error.partialText)).toBe(true);
    expect(error.partialTruncated).toBe(true);
    expect(error.partialSha256).toMatch(/^[0-9a-f]{64}$/);
    // A logger serializing the error object never sees the partial text.
    expect(JSON.stringify(error)).not.toContain('xxxx');
    expect(Object.keys(error)).not.toContain('partialText');
    expect(phases(events)).toEqual(['1:submitted', '1:response_received', '1:failed:truncated']);
    expect(events[1]!.usage).toEqual({ tokens_in: 1142, tokens_out: 4000, cost_usd: 0.00082278, detail: { reasoning_tokens: 2612 } });
  });

  it('schema-invalid output is typed too; a found generation record is reported as usage_verified', async () => {
    const generation = {
      data: {
        provider_name: 'DeepInfra', model: 'deepseek/deepseek-v4-flash-20260423', finish_reason: 'stop',
        tokens_prompt: 1139, tokens_completion: 1388, total_cost: 0.00041526,
        native_tokens_prompt: 1142, native_tokens_completion: 1736, native_tokens_reasoning: 912,
        provider_responses: [{ provider_name: 'DeepInfra', endpoint_id: 'ep-synthetic', model_permaslug: 'deepseek/deepseek-v4-flash-20260423', status: 200 }],
      },
    };
    const { provider } = experimentProvider(chat('not json at all'), [{ status: 200, body: generation }]);
    const events: AttemptLifecycleEvent[] = [];
    const req = { ...request({ stageId: 'single-0', report: (e) => events.push(e) }), experiment: experiment({ generationLookup: { attempts: 1, delayMs: 0 } }) };
    const error = await provider.completeStructured(req).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect(error).toMatchObject({ kind: 'schema_invalid', partialText: 'not json at all', finishReason: 'stop' });
    expect(phases(events)).toEqual(['1:submitted', '1:response_received', '1:usage_verified', '1:failed:schema_invalid']);
    // The record's normalized, native and reasoning counts, as it named them.
    expect(events[2]!.usage).toEqual({
      tokens_in: 1139,
      tokens_out: 1388,
      cost_usd: 0.00041526,
      detail: { reasoning_tokens: 912, native_prompt_tokens: 1142, native_completion_tokens: 1736, normalized_prompt_tokens: 1139, normalized_completion_tokens: 1388 },
    });
    // The response itself reported no reasoning breakdown: null, never invented.
    expect(events[1]!.usage!.detail).toEqual({ reasoning_tokens: null });
  });

  it('a refusal before dispatch reports no attempt at all', async () => {
    const { provider, create } = experimentProvider(chat(CLEAN));
    const events: AttemptLifecycleEvent[] = [];
    const bad = { ...request({ stageId: 'single-0', report: (e) => events.push(e) }), experiment: experiment({ maxRetries: 1 as 0 }) };
    await expect(provider.completeStructured(bad)).rejects.toThrow(/refused before dispatch/);
    expect(events).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('boundUtf8', () => {
  it('never cuts inside a multi-byte character', () => {
    const text = 'ab€€'; // 2 + 3 + 3 bytes
    expect(boundUtf8(text, 4)).toEqual({ text: 'ab', totalBytes: 8, truncated: true });
    expect(boundUtf8(text, 5)).toEqual({ text: 'ab€', totalBytes: 8, truncated: true });
    expect(boundUtf8(text, 8)).toEqual({ text, totalBytes: 8, truncated: false });
  });
});
