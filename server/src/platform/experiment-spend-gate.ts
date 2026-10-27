import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  OpenRouterEndpointInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { REVIEW_SCHEMA_NAME } from '@devdigest/reviewer-core';
import { AppError } from './errors.js';
import { extractionRequestSha256 } from '../modules/_shared/conventions-experiment.js';

/**
 * HW2 experiment mode: the only door to paid generation. The experiments
 * service opens it for one authorized slot (after the capability, budget and
 * isolation checks) and closes it when the run settles; each opened slot
 * admits exactly one generation.
 */
export class ExperimentSpendGate {
  private slot: { id: string; used: boolean; extractionRequestSha256?: string; extractionExpiresAt?: number } | null = null;

  get current(): string | null {
    return this.slot?.id ?? null;
  }

  /** Open for one slot; false when another slot is open. */
  tryOpen(slotId: string): boolean {
    if (this.slot) return false;
    this.slot = { id: slotId, used: false };
    return true;
  }

  /** A conventions grant is bound to the exact model request, not just a slot id. */
  tryOpenExtraction(slotId: string, requestSha256: string, expiresAt: number): boolean {
    if (this.slot || !/^[0-9a-f]{64}$/.test(requestSha256) ||
        !Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;
    this.slot = { id: slotId, used: false, extractionRequestSha256: requestSha256, extractionExpiresAt: expiresAt };
    return true;
  }

  close(slotId: string): void {
    if (this.slot?.id === slotId) this.slot = null;
  }

  isExtractionSlot(slotId: string): boolean {
    return this.slot?.id === slotId && this.slot.extractionRequestSha256 !== undefined;
  }

  extractionRequestSha256For<T>(slotId: string, req: StructuredRequest<T>): string | undefined {
    if (this.slot?.id !== slotId || this.slot.extractionRequestSha256 === undefined) return undefined;
    return extractionRequestSha256(req as StructuredRequest<unknown>, req.experiment!);
  }

  /** Take the slot's single generation; false when not open for it or already used. */
  consume(slotId: string, requestSha256?: string, schemaName?: string): boolean {
    if (!this.slot || this.slot.id !== slotId || this.slot.used) return false;
    if (this.slot.extractionRequestSha256 !== undefined &&
        (this.slot.extractionRequestSha256 !== requestSha256 || Date.now() >= (this.slot.extractionExpiresAt ?? 0))) return false;
    if (this.slot.extractionRequestSha256 === undefined &&
        (requestSha256 !== undefined || schemaName !== REVIEW_SCHEMA_NAME)) return false;
    this.slot.used = true;
    return true;
  }
}

export class ExperimentSpendRefusedError extends AppError {
  constructor(reason: string) {
    super('experiment_spend_refused', `Refused in experiment mode: ${reason}. Paid generation only runs through an authorized experiment slot.`, 403);
  }
}

/**
 * Wraps every LLM provider in experiment mode. Free metadata (model and
 * endpoint listing) passes; any generation is refused before it reaches the
 * provider unless it is the authorized experiment request of the open slot.
 * Ordinary calls cannot spend the experiment key. Conventions extraction
 * needs its own exact-request grant; a review grant cannot authorize it.
 */
export class ExperimentGuardedProvider implements LLMProvider {
  readonly id: LLMProvider['id'];

  constructor(
    private readonly inner: LLMProvider,
    private readonly gate: ExperimentSpendGate,
  ) {
    this.id = inner.id;
  }

  listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  /** Free endpoint metadata (prices, limits), when the provider offers it. */
  listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> {
    const lister = this.inner as Partial<{ listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> }>;
    if (typeof lister.listEndpoints !== 'function') return Promise.reject(new Error('The provider cannot list endpoints'));
    return lister.listEndpoints(model);
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new ExperimentSpendRefusedError('free-text completion');
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new ExperimentSpendRefusedError('embeddings');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!req.experiment) throw new ExperimentSpendRefusedError('an ordinary structured call (no experiment slot)');
    if (this.gate.isExtractionSlot(req.experiment.slotId) && this.id !== 'openrouter') {
      throw new ExperimentSpendRefusedError('conventions extraction requires OpenRouter');
    }
    const requestSha256 = this.gate.extractionRequestSha256For(req.experiment.slotId, req);
    if (!this.gate.consume(req.experiment.slotId, requestSha256, req.schemaName)) {
      throw new ExperimentSpendRefusedError(`slot ${req.experiment.slotId} is not the open slot or already made its request`);
    }
    return this.inner.completeStructured(req);
  }
}
