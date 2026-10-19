import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { ExperimentConfig } from '../../platform/config.js';
import type { OpenRouterEndpointInfo } from '@devdigest/shared';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { assertDisposableDatabase, isDisposableDatabaseName } from '../../db/disposable.js';
import { ReviewService } from '../reviews/service.js';
import type { Logger } from '../reviews/run-executor.js';
import type { ExperimentRunRequest } from '../_shared/experiment.js';
import { ExperimentsRepository } from './repository.js';

/** The demo repository the HW2 fixtures live in. */
const FIXTURE_REPO = { owner: 'acme', name: 'payments-api', fullName: 'acme/payments-api' };
/** The fixture PRs a disposable experiment stack must hold, and the demo PR it must not. */
const FIXTURE_PULLS = [501, 502];
const FORBIDDEN_PULL = 3;

/** One in-flight experiment run per process; the runner also holds a ledger lock. */
const inFlight = new WeakMap<Container, string>();

export interface ExperimentIdentity {
  stack_id: string;
  database: string;
  database_is_disposable: boolean;
  repos: string[];
  fixture_pulls: number[];
  demo_pr_3_present: boolean;
  clone_dir: string;
  fixture_clone_present: boolean;
  provider: string;
  provider_name: string | null;
  model: string;
  max_output_tokens: number;
  prices: ExperimentConfig['prices'];
  generation_lookup: ExperimentConfig['generationLookup'];
  in_flight_slot: string | null;
  /** The dedicated experiment key file, and whether it holds an OpenRouter key (never the key). */
  secrets_path: string;
  openrouter_key_configured: boolean;
}

/**
 * HW2 controlled-experiment entry points. Only reachable when the server has a
 * complete experiment configuration (routes answer 404 otherwise). Starting a
 * slot re-checks isolation, holds the in-flight gate, refuses a used slot id
 * and hands one run to the review executor, whose own checks run before any
 * model request.
 */
export class ExperimentsService {
  private readonly repo: ExperimentsRepository;
  private readonly reviews: ReviewService;

  constructor(private readonly container: Container) {
    this.repo = new ExperimentsRepository(container.db);
    this.reviews = new ReviewService(container);
  }

  config(): ExperimentConfig {
    const config = this.container.config.experiment;
    if (!config) throw new NotFoundError('Experiment mode is not enabled');
    return config;
  }

  async identity(workspaceId: string): Promise<ExperimentIdentity> {
    const config = this.config();
    const database = await this.repo.databaseName();
    const pulls = await this.repo.pullNumbers(workspaceId, FIXTURE_REPO.fullName);
    return {
      stack_id: config.stackId,
      database,
      database_is_disposable: isDisposableDatabaseName(database),
      repos: await this.repo.repoFullNames(),
      fixture_pulls: pulls.filter((n) => FIXTURE_PULLS.includes(n)),
      demo_pr_3_present: pulls.includes(FORBIDDEN_PULL),
      clone_dir: this.container.config.cloneDir,
      fixture_clone_present: this.fixtureClonePresent(),
      provider: config.provider,
      provider_name: config.providerName,
      model: config.model,
      max_output_tokens: config.maxOutputTokens,
      prices: config.prices,
      generation_lookup: config.generationLookup,
      in_flight_slot: inFlight.get(this.container) ?? null,
      secrets_path: this.container.config.secretsPath,
      openrouter_key_configured: Boolean(await this.container.secrets.get('OPENROUTER_API_KEY')),
    };
  }

  async start(
    workspaceId: string,
    input: ExperimentRunRequest & { pr_id: string; agent_id: string },
    logger?: Logger,
  ): Promise<{ run_id: string; slot_id: string }> {
    const config = this.config();
    // Isolation first: a non-disposable database or a stray clone refuses every slot.
    await assertDisposableDatabase(this.container.db).catch((err: Error) => {
      throw new ValidationError(err.message);
    });
    if (this.fixtureClonePresent()) {
      throw new ValidationError(`A clone of ${FIXTURE_REPO.fullName} exists in ${this.container.config.cloneDir}; remove it or use an empty clone directory`);
    }
    const pulls = await this.repo.pullNumbers(workspaceId, FIXTURE_REPO.fullName);
    if (pulls.includes(FORBIDDEN_PULL)) throw new ValidationError('Demo PR #3 is present; this is not an experiment stack');

    const busy = inFlight.get(this.container);
    if (busy) throw new ConflictError(`Experiment slot ${busy} is still in flight`);
    inFlight.set(this.container, input.slot_id);
    let handedOff = false;
    try {
      if ((await this.repo.runsForSlot(workspaceId, input.slot_id)).length > 0) {
        throw new ConflictError(`Experiment slot ${input.slot_id} was already used; slots are never replayed`);
      }
      const targets = await this.reviews.resolveTargets(workspaceId, { agentId: input.agent_id });
      const { runs } = await this.reviews.runReview(workspaceId, input.pr_id, targets, logger, {
        config,
        request: {
          slot_id: input.slot_id,
          experiment: input.experiment,
          condition: input.condition,
          manifest_fingerprint: input.manifest_fingerprint,
          reservation_usd: input.reservation_usd,
          expected_diff_sha256: input.expected_diff_sha256,
        },
        onSettled: () => inFlight.delete(this.container),
      });
      handedOff = true;
      return { run_id: runs[0]!.run_id, slot_id: input.slot_id };
    } finally {
      // Until the executor owns the run, a failure here must release the gate.
      if (!handedOff) inFlight.delete(this.container);
    }
  }

  /**
   * Live per-provider endpoints of the frozen model (prices, limits, tags):
   * OpenRouter metadata, not a generation, so it costs nothing. Used to choose
   * and freeze the provider during exploration.
   */
  async endpoints() {
    const config = this.config();
    const llm = await this.container.llm('openrouter');
    const lister = llm as Partial<{ listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> }>;
    if (typeof lister.listEndpoints !== 'function') throw new ValidationError('The OpenRouter provider cannot list endpoints');
    return { model: config.model, endpoints: await lister.listEndpoints(config.model) };
  }

  /** Reconciliation lookup: every run recorded for a slot, with its experiment block. */
  async slot(workspaceId: string, slotId: string) {
    this.config();
    const runs = await this.repo.runsForSlot(workspaceId, slotId);
    return {
      slot_id: slotId,
      runs: runs.map((run) => ({
        run_id: run.runId,
        status: run.status,
        cost_usd: run.costUsd,
        tokens_in: run.tokensIn,
        tokens_out: run.tokensOut,
        experiment: (run.trace as { experiment?: unknown }).experiment ?? null,
        intent: (run.trace as { intent?: unknown }).intent ?? null,
      })),
    };
  }

  private fixtureClonePresent(): boolean {
    return existsSync(join(this.container.config.cloneDir, FIXTURE_REPO.owner, FIXTURE_REPO.name));
  }
}
