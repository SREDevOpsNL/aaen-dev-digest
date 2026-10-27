import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { ExperimentConfig } from '../../platform/config.js';
import type { OpenRouterEndpointInfo } from '@devdigest/shared';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { assertDisposableDatabase, isDisposableDatabaseName } from '../../db/disposable.js';
import { ReviewService } from '../reviews/service.js';
import type { Logger } from '../reviews/run-executor.js';
import type { AgentRow } from '../../db/rows.js';
import {
  EXPERIMENT_CAPS,
  PHASE_SLOT_PREFIX,
  capabilityProblem,
  experimentCharge,
  type ExperimentCapability,
  type ExperimentPhase,
  type ExperimentRunRequest,
} from '../_shared/experiment.js';
import { ExperimentsRepository } from './repository.js';

/** The demo repository the HW2 fixtures live in. */
const FIXTURE_REPO = { owner: 'acme', name: 'payments-api', fullName: 'acme/payments-api' };
/** The fixture PRs a disposable experiment stack must hold, and the demo PR it must not. */
const FIXTURE_PULLS = [501, 502];
const FORBIDDEN_PULL = 3;


/** One slot's dispatch request, as `POST /experiments/runs` and the arm route receive it. */
export type SlotInput = ExperimentRunRequest & { pr_id: string; agent_id: string };

export interface ExperimentIdentity {
  stack_id: string;
  database: string;
  postgres_system_identifier: string;
  database_is_disposable: boolean;
  repos: string[];
  fixture_pulls: number[];
  demo_pr_3_present: boolean;
  clone_dir: string;
  fixture_clone_present: boolean;
  provider: string;
  provider_name: string | null;
  model: string;
  served_model: string | null;
  max_output_tokens: number;
  prices: ExperimentConfig['prices'];
  generation_lookup: ExperimentConfig['generationLookup'];
  in_flight_slot: string | null;
  /** A slot armed for a Run Review click on the PR page, if any. */
  armed_slot: string | null;
  /** The dedicated experiment key file, and whether it holds an OpenRouter key (never the key). */
  secrets_path: string;
  openrouter_key_configured: boolean;
  embeddings_enabled: boolean;
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
      postgres_system_identifier: await this.repo.postgresSystemIdentifier(),
      database_is_disposable: isDisposableDatabaseName(database),
      repos: await this.repo.repoFullNames(),
      fixture_pulls: pulls.filter((n) => FIXTURE_PULLS.includes(n)),
      demo_pr_3_present: pulls.includes(FORBIDDEN_PULL),
      clone_dir: this.container.config.cloneDir,
      fixture_clone_present: this.fixtureClonePresent(),
      provider: config.provider,
      provider_name: config.providerName,
      model: config.model,
      served_model: config.servedModel,
      max_output_tokens: config.maxOutputTokens,
      prices: config.prices,
      generation_lookup: config.generationLookup,
      in_flight_slot: this.container.experimentSpendGate.current,
      armed_slot: this.container.experimentArms.armedSlot,
      secrets_path: this.container.config.secretsPath,
      openrouter_key_configured: Boolean(await this.container.secrets.get('OPENROUTER_API_KEY')),
      embeddings_enabled: this.container.config.embeddingsEnabled,
    };
  }

  /** Start one slot directly (`POST /experiments/runs`): admit it, then dispatch it. */
  async start(
    workspaceId: string,
    input: SlotInput,
    capabilityToken: string | undefined,
    logger?: Logger,
  ): Promise<{ run_id: string; slot_id: string }> {
    const capability = await this.admit(workspaceId, input, capabilityToken);
    const gate = this.container.experimentSpendGate;
    let handedOff = false;
    try {
      await this.checkBudget(workspaceId, input, capability);
      const targets = await this.reviews.resolveTargets(workspaceId, { agentId: input.agent_id });
      const runId = await this.dispatch(workspaceId, input, targets, logger);
      handedOff = true;
      return { run_id: runId, slot_id: input.slot_id };
    } finally {
      // Until the executor owns the run, a failure here must release the gate.
      if (!handedOff) gate.close(input.slot_id);
    }
  }

  /**
   * Arm one slot for a Run Review click on the PR page
   * (`POST /experiments/slots/:slotId/arm`). Every check of a direct start
   * runs first and the spend gate opens for this slot; the click then
   * dispatches it through the same path. An arm that is not clicked expires
   * and never dispatches.
   */
  async arm(workspaceId: string, input: SlotInput, capabilityToken: string | undefined): Promise<{ slot_id: string; armed_until: string }> {
    const capability = await this.admit(workspaceId, input, capabilityToken);
    const gate = this.container.experimentSpendGate;
    try {
      await this.checkBudget(workspaceId, input, capability);
      const targets = await this.reviews.resolveTargets(workspaceId, { agentId: input.agent_id });
      if (targets.length !== 1) throw new ValidationError('An armed slot needs exactly one agent');
      const { expires_at } = this.container.experimentArms.arm(
        { slotId: input.slot_id, workspaceId, prId: input.pr_id, agentId: input.agent_id, request: { input, capabilityToken } },
        () => gate.close(input.slot_id),
      );
      return { slot_id: input.slot_id, armed_until: expires_at };
    } catch (err) {
      gate.close(input.slot_id);
      throw err;
    }
  }

  /** Disarm a slot that has not been clicked (`DELETE /experiments/slots/:slotId/arm`). */
  disarm(slotId: string, capabilityToken: string | undefined): { slot_id: string; state: string } {
    const config = this.config();
    const capability = this.readCapability(config.capabilityPath);
    const armedPhase = slotId.startsWith(PHASE_SLOT_PREFIX.confirmatory) ? 'confirmatory' : 'exploration';
    const problem = capabilityProblem(capability, { stackId: config.stackId, phase: armedPhase, token: capabilityToken, now: new Date() });
    if (problem) throw new AppError('experiment_not_authorized', `Disarm refused: ${problem}`, 403);
    this.container.experimentArms.disarm(slotId);
    return { slot_id: slotId, state: this.container.experimentArms.stateOf(slotId)?.state ?? 'unknown' };
  }

  /**
   * A Run Review click in experiment mode. When a slot is armed for this PR and
   * the click targets exactly its agent, the click dispatches that slot (once)
   * and returns its run id. With no matching armed slot it returns null: the
   * ordinary review then runs and the spend gate refuses its model call, as
   * for any review in experiment mode. A click for another agent while a slot
   * is armed for this PR is refused outright, so it cannot be mistaken for the
   * slot.
   */
  async reviewFromArmedSlot(workspaceId: string, prId: string, targets: AgentRow[], logger?: Logger): Promise<{ run_id: string; slot_id: string } | null> {
    if (!this.container.config.experiment) return null;
    const arms = this.container.experimentArms;
    const armed = arms.take(workspaceId, prId, targets.map((t) => t.id));
    if (!armed) {
      if (arms.armedFor(workspaceId, prId)) {
        throw new ConflictError(`Experiment slot ${arms.armedSlot} is armed for another agent on this PR; run that agent's review, or disarm the slot`);
      }
      return null;
    }
    const { input, capabilityToken } = armed.request as { input: SlotInput; capabilityToken: string | undefined };
    try {
      // The capability is checked again at the click: one revoked or expired
      // since the slot was armed refuses the dispatch.
      const config = this.config();
      const problem = capabilityProblem(this.readCapability(config.capabilityPath), {
        stackId: config.stackId,
        phase: input.phase,
        token: capabilityToken,
        now: new Date(),
      });
      if (problem) throw new AppError('experiment_not_authorized', `Armed slot ${input.slot_id} refused at the click: ${problem}`, 403);
      const runId = await this.dispatch(workspaceId, input, targets, logger);
      return { run_id: runId, slot_id: input.slot_id };
    } catch (err) {
      this.container.experimentSpendGate.close(input.slot_id);
      throw err;
    }
  }

  /**
   * Every check before a slot may spend: the capability for this stack and
   * phase, the slot id's phase, isolation, and that the slot id was never
   * used. Ends with the spend gate open for this slot (one slot in flight);
   * the caller closes it if it does not hand the slot to the executor.
   */
  private async admit(workspaceId: string, input: SlotInput, capabilityToken: string | undefined): Promise<ExperimentCapability> {
    const config = this.config();
    // The spending capability is checked here, independently of any client:
    // a direct request without the operator's token for this stack and phase
    // is refused before anything else happens.
    const capability = this.readCapability(config.capabilityPath);
    const problem = capabilityProblem(capability, { stackId: config.stackId, phase: input.phase, token: capabilityToken, now: new Date() });
    if (problem) throw new AppError('experiment_not_authorized', `Experiment slot refused: ${problem}`, 403);
    if (!input.slot_id.startsWith(PHASE_SLOT_PREFIX[input.phase])) {
      throw new ValidationError(`A ${input.phase} slot id must start with ${PHASE_SLOT_PREFIX[input.phase]}`);
    }
    if (input.phase === 'confirmatory' && !input.expected_non_skill_fingerprint) {
      throw new ValidationError('Confirmatory slots need the frozen non-Skill fingerprint');
    }
    // Isolation first: a non-disposable database or a stray clone refuses every slot.
    await assertDisposableDatabase(this.container.db).catch((err: Error) => {
      throw new ValidationError(err.message);
    });
    if (this.fixtureClonePresent()) {
      throw new ValidationError(`A clone of ${FIXTURE_REPO.fullName} exists in ${this.container.config.cloneDir}; remove it or use an empty clone directory`);
    }
    const pulls = await this.repo.pullNumbers(workspaceId, FIXTURE_REPO.fullName);
    if (pulls.includes(FORBIDDEN_PULL)) throw new ValidationError('Demo PR #3 is present; this is not an experiment stack');

    // One slot at a time: opening the spend gate is also the in-flight check.
    const gate = this.container.experimentSpendGate;
    if (!gate.tryOpen(input.slot_id)) throw new ConflictError(`Experiment slot ${gate.current} is still in flight`);
    try {
      if ((await this.repo.runsForSlot(workspaceId, input.slot_id)).length > 0) {
        throw new ConflictError(`Experiment slot ${input.slot_id} was already used; slots are never replayed`);
      }
      if (this.container.experimentArms.stateOf(input.slot_id)) {
        throw new ConflictError(`Experiment slot ${input.slot_id} was already armed; slots are never replayed`);
      }
    } catch (err) {
      gate.close(input.slot_id);
      throw err;
    }
    return capability as ExperimentCapability;
  }

  /** Server-side budget, recomputed from the stored runs (known cost, zero for refusals, the full reservation for anything unknown). */
  private async checkBudget(workspaceId: string, input: SlotInput, capability: ExperimentCapability): Promise<void> {
    const config = this.config();
    const charged = await this.charged(workspaceId, config.stackId);
    const phaseLimit = Math.min(EXPERIMENT_CAPS[input.phase], capability.budget_usd);
    if (charged[input.phase] + input.reservation_usd > phaseLimit + 1e-12) {
      throw new ConflictError(`${input.phase} budget: $${charged[input.phase].toFixed(6)} charged + $${input.reservation_usd} > $${phaseLimit}`);
    }
    if (charged.total + input.reservation_usd > EXPERIMENT_CAPS.total + 1e-12) {
      throw new ConflictError(`total budget: $${charged.total.toFixed(6)} charged + $${input.reservation_usd} > $${EXPERIMENT_CAPS.total}`);
    }
  }

  /** Hand one admitted slot to the review executor; the gate closes when its run settles. */
  private async dispatch(workspaceId: string, input: SlotInput, targets: AgentRow[], logger?: Logger): Promise<string> {
    const config = this.config();
    const gate = this.container.experimentSpendGate;
    const { runs } = await this.reviews.runReview(workspaceId, input.pr_id, targets, logger, {
      config,
      request: {
        slot_id: input.slot_id,
        experiment: input.experiment,
        condition: input.condition,
        phase: input.phase,
        expected_non_skill_fingerprint: input.expected_non_skill_fingerprint,
        manifest_fingerprint: input.manifest_fingerprint,
        reservation_usd: input.reservation_usd,
        expected_diff_sha256: input.expected_diff_sha256,
      },
      onSettled: () => gate.close(input.slot_id),
    });
    return runs[0]!.run_id;
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

  /**
   * Free preview of a slot: the same checks, fingerprints and preflight a run
   * performs, with no model request, no run row and no trace. The manifest
   * freezes the non-Skill fingerprint it returns.
   */
  async preview(
    workspaceId: string,
    input: { pr_id: string; agent_id: string; experiment: string; condition: 'with' | 'without'; phase: ExperimentPhase; reservation_usd: number; expected_diff_sha256: string },
  ) {
    const config = this.config();
    const [agent] = await this.reviews.resolveTargets(workspaceId, { agentId: input.agent_id });
    return this.reviews.previewExperiment(workspaceId, input.pr_id, agent!, {
      config,
      request: {
        slot_id: 'preview',
        experiment: input.experiment,
        condition: input.condition,
        phase: input.phase,
        manifest_fingerprint: '0'.repeat(64),
        reservation_usd: input.reservation_usd,
        expected_diff_sha256: input.expected_diff_sha256,
        expected_non_skill_fingerprint: null,
      },
    });
  }

  private readCapability(path: string): unknown {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  private async charged(workspaceId: string, stackId: string): Promise<Record<ExperimentPhase | 'total', number>> {
    const totals = { exploration: 0, confirmatory: 0, total: 0 };
    for (const run of await this.repo.runsForStack(workspaceId, stackId)) {
      const block = (run.trace as { experiment?: { phase?: ExperimentPhase; dispatch_state?: string; usage_known?: boolean; preflight?: { reservation_usd?: number } | null } }).experiment;
      if (!block?.phase) continue;
      const charge = experimentCharge({
        dispatchState: block.dispatch_state ?? null,
        usageKnown: block.usage_known ?? null,
        costUsd: run.costUsd,
        reservationUsd: block.preflight?.reservation_usd ?? EXPERIMENT_CAPS[block.phase],
      });
      totals[block.phase] += charge;
      totals.total += charge;
    }
    return totals;
  }

  /** Reconciliation lookup: every run recorded for a slot, with its experiment block. */
  async slot(workspaceId: string, slotId: string) {
    this.config();
    const runs = await this.repo.runsForSlot(workspaceId, slotId);
    return {
      slot_id: slotId,
      // Set when the slot was armed for a Run Review click: armed, consumed, expired or disarmed.
      arm: this.container.experimentArms.stateOf(slotId),
      runs: runs.map((run) => ({
        run_id: run.runId,
        status: run.status,
        cost_usd: run.costUsd,
        tokens_in: run.tokensIn,
        tokens_out: run.tokensOut,
        experiment: (run.trace as { experiment?: unknown }).experiment ?? null,
        // What actually ran: the reviewer and PR, and the Skills section the model received.
        config: (run.trace as { config?: { agent?: string; pr?: number | null } }).config ?? null,
        skills_block: (run.trace as { prompt_assembly?: { skills?: string | null } }).prompt_assembly?.skills ?? null,
      })),
    };
  }

  private fixtureClonePresent(): boolean {
    return existsSync(join(this.container.config.cloneDir, FIXTURE_REPO.owner, FIXTURE_REPO.name));
  }
}
