import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredResult,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { toJsonSchema, parseWithRepair } from '../../platform/structured.js';
import { estimateCost } from './pricing.js';
import { ExternalServiceError } from '../../platform/errors.js';
import { AttemptRecorder, reportedNumber, type AttemptHandle, type LifecycleStructuredRequest } from '@devdigest/reviewer-core';
import { httpStatusOf, transportOutcome } from './attempt-outcome.js';

const DEFAULT_TIMEOUT = 60_000;
const EMBED_MODEL = 'text-embedding-3-small';

/**
 * GPT-5 and the o-series reasoning models reject a custom `temperature` (only
 * the default is allowed) and use `max_completion_tokens` instead of
 * `max_tokens`. Detect them so we can omit/remap those params.
 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

/** Build the temperature + token-cap params appropriate for the given model. */
function tuningParams(
  model: string,
  temperature: number | undefined,
  maxTokens: number | undefined,
): Record<string, number> {
  if (isReasoningModel(model)) {
    return maxTokens ? { max_completion_tokens: maxTokens } : {};
  }
  const p: Record<string, number> = { temperature: temperature ?? 0 };
  if (maxTokens) p.max_tokens = maxTokens;
  return p;
}

/**
 * OpenAI LLMProvider.
 * - listModels: dynamic via GET /models (not hardcoded).
 * - completeStructured: response_format json_schema + Zod validate + reprompt.
 * - embed: text-embedding-3-small (1536 dims).
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async listModels(): Promise<ModelInfo[]> {
    return withRetry(async () => {
      const res = await this.client.models.list();
      return res.data
        .filter((m) => m.id.startsWith('gpt') || m.id.includes('o1') || m.id.includes('o3'))
        .map((m) => ({ id: m.id, provider: 'openai' as const, created: m.created }));
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return withRetry(() =>
      withTimeout(this.doComplete(req), req.timeoutMs ?? DEFAULT_TIMEOUT),
    );
  }

  private async doComplete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.client.chat.completions.create({
      model: req.model,
      messages: req.messages,
      ...tuningParams(req.model, req.temperature ?? 0.2, req.maxTokens),
    });
    const text = res.choices?.[0]?.message?.content ?? '';
    const tokensIn = res.usage?.prompt_tokens ?? 0;
    const tokensOut = res.usage?.completion_tokens ?? 0;
    return {
      text,
      model: req.model,
      tokensIn,
      tokensOut,
      costUsd: estimateCost(req.model, tokensIn, tokensOut),
    };
  }

  async completeStructured<T>(req: LifecycleStructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let lastRaw = '';
    // One attempt record per HTTP call: withRetry's transport retries included.
    const recorder = new AttemptRecorder(req.lifecycle);

    let tracked: AttemptHandle | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      let transport = 0;
      const res = await withRetry(async () => {
        const handle = recorder.submit(transport++ > 0 ? 'transport_retry' : attempt === 1 ? 'initial' : 'structured_retry');
        tracked = handle;
        try {
          const response = await withTimeout(
            this.client.chat.completions.create({
              model: req.model,
              messages,
              ...tuningParams(req.model, req.temperature, req.maxTokens),
              response_format: {
                type: 'json_schema',
                json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
              },
            }),
            req.timeoutMs ?? DEFAULT_TIMEOUT,
          );
          handle.received({
            response_id: typeof response.id === 'string' ? response.id : null,
            finish_reason: response.choices?.[0]?.finish_reason ?? null,
            http_status: 200,
            // OpenAI reports no per-request cost: unknown, never 0.
            usage: { tokens_in: reportedNumber(response.usage?.prompt_tokens), tokens_out: reportedNumber(response.usage?.completion_tokens), cost_usd: null },
          });
          return response;
        } catch (err) {
          handle.failed(transportOutcome(err), { http_status: httpStatusOf(err) });
          throw err;
        }
      });
      lastRaw = res.choices?.[0]?.message?.content ?? '';
      tokensIn += res.usage?.prompt_tokens ?? 0;
      tokensOut += res.usage?.completion_tokens ?? 0;

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          providerCostUsd: null,
          costUsd: estimateCost(req.model, tokensIn, tokensOut),
          raw: lastRaw,
          attempts: attempt,
        };
      }
      // reprompt-on-error
      tracked?.failed(res.choices?.[0]?.finish_reason === 'length' ? 'truncated' : 'schema_invalid', {
        finish_reason: res.choices?.[0]?.finish_reason ?? null,
      });
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({ role: 'user', content: parsed.repromptMessage });
    }

    throw new ExternalServiceError('OpenAI structured output failed schema validation', {
      raw: lastRaw,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return withRetry(async () => {
      const res = await withTimeout(
        this.client.embeddings.create({ model: EMBED_MODEL, input: texts }),
        DEFAULT_TIMEOUT,
      );
      return res.data.map((d) => d.embedding);
    });
  }
}
