import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  OpenRouterEndpointInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { AppError } from './errors.js';

/**
 * HW2 experiment mode: the only door to paid generation. The experiments
 * service opens it for one authorized slot (after the capability, budget and
 * isolation checks) and closes it when the run settles; each opened slot
 * admits exactly one generation.
 */
export class ExperimentSpendGate {
  private slot: { id: string; used: boolean } | null = null;

  get current(): string | null {
    return this.slot?.id ?? null;
  }

  /** Open for one slot; false when another slot is open. */
  tryOpen(slotId: string): boolean {
    if (this.slot) return false;
    this.slot = { id: slotId, used: false };
    return true;
  }

  close(slotId: string): void {
    if (this.slot?.id === slotId) this.slot = null;
  }

  /** Take the slot's single generation; false when not open for it or already used. */
  consume(slotId: string): boolean {
    if (!this.slot || this.slot.id !== slotId || this.slot.used) return false;
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
 * Ordinary reviews, intent derivation, conventions extraction and any other
 * caller therefore cannot spend the experiment key.
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
    if (!this.gate.consume(req.experiment.slotId)) {
      throw new ExperimentSpendRefusedError(`slot ${req.experiment.slotId} is not the open slot or already made its request`);
    }
    return this.inner.completeStructured(req);
  }
}
