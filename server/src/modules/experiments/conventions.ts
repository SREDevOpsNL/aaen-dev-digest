import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { sql } from 'drizzle-orm';
import type {
  OpenRouterEndpointInfo, StructuredAttemptTelemetry, StructuredExperimentOptions, StructuredRequest,
} from '@devdigest/shared';
import { experimentRequestBody } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { ExperimentConfig } from '../../platform/config.js';
import { AppError, ConflictError, ValidationError } from '../../platform/errors.js';
import { ExtractionReceipts, receiptAttempt } from '../../platform/experiment-receipts.js';
import { EXPERIMENT_REQUEST_TIMEOUT_MS } from '../../platform/config.js';
import { isDisposableDatabaseName } from '../../db/disposable.js';
import { Ledger } from '../../experiments/hw2/ledger.js';
import { ExperimentsRepository } from './repository.js';
import { implementationFingerprint, repoRoot } from '../../experiments/hw2/source.js';
import { evaluateSlot } from '../../experiments/hw2/eligibility.js';
import {
  canonicalJson, effectivePriceLimits, experimentOptions, inputUpperBound, preflight, sha256,
  type PriceLimits,
} from '../_shared/experiment.js';
import {
  extractionCapabilityProblem, extractionRequestSha256, type ConventionsCapability, type ExtractionBinding,
} from '../_shared/conventions-experiment.js';
import type { SampledFile } from '../conventions/helpers.js';

const PRIVATE_ROOT = join(homedir(), '.devdigest', 'hw2-experiments');

/** Extraction must price and validate the exact endpoint its request pins. */
export function exactConventionsPriceLimits(
  config: ExperimentConfig, live: OpenRouterEndpointInfo[],
): PriceLimits | null {
  const tag = config.provider.toLowerCase();
  const exact = live.filter((endpoint) => endpoint.tag?.toLowerCase() === tag);
  return exact.length ? effectivePriceLimits(config, exact) : null;
}
type Repository = { id: string; fullName: string; owner: string; name: string };
type Input<T> = {
  workspaceId: string;
  repo: Repository;
  files: SampledFile[];
  indexedPaths: string[];
  request: StructuredRequest<T>;
};

export interface ExtractionPreview extends ExtractionBinding {
  expected_provider_name: string;
  expected_served_model: string;
  sampled_paths: string[];
  indexed_paths: string[];
  input_upper_bound: number;
  output_cap: number;
  worst_case_usd: number;
  reservation_usd: number;
  ok: boolean;
  reason: string | null;
}

export interface ExtractionAdmission {
  options: StructuredExperimentOptions;
  timeoutMs: number;
  onAttempt: (attempt: StructuredAttemptTelemetry) => void;
  assertVerified: () => void;
  modelResult: (data: unknown, raw: string) => void;
  persisted: (ids: string[], digest: string) => void;
  failed: () => void;
  close: () => void;
}

const refuse = (reason: string): never => {
  throw new AppError('experiment_not_authorized', `Conventions extraction refused: ${reason}`, 403);
};

/** Read-only snapshot shared by preview, authorization and the paid entry point. */
export class ConventionsExperiment {
  constructor(private readonly container: Container) {}

  private async snapshot<T>(input: Input<T>, slotId: string, reservationUsd: number) {
    const config = this.container.config.experiment;
    if (!config) throw new ValidationError('Experiment stack is disabled');
    if (!input.indexedPaths.length) throw new ValidationError('Conventions extraction needs an indexed repository');
    const options = experimentOptions(config, slotId);
    options.maxTokens = input.request.maxTokens ?? config.maxOutputTokens;
    const frozenRequest: StructuredRequest<T> = {
      ...input.request, timeoutMs: EXPERIMENT_REQUEST_TIMEOUT_MS, maxRetries: 0, experiment: options,
    };
    const rows = await this.container.db.execute<{ name: string; system_identifier: string }>(
      sql`select current_database() as name, system_identifier::text from pg_control_system()`,
    ).catch(() => []);
    const identity = [...rows][0];
    const expectedDatabase = `devdigest_hw2f_${config.stackId.slice('hw2f-'.length)}`;
    if (!identity || !isDisposableDatabaseName(identity.name) || identity.name !== expectedDatabase) {
      throw new ValidationError('Database identity is not the distinctive extraction stack database');
    }
    if (input.repo.fullName !== 'fastify/fastify' ||
        input.repo.owner !== 'fastify' || input.repo.name !== 'fastify') {
      throw new ValidationError('Extraction repository is not the frozen public repository');
    }
    if (this.container.config.embeddingsEnabled) throw new ValidationError('Embeddings must be disabled on the extraction stack');
    if ((await new ExperimentsRepository(this.container.db).pullNumbers(input.workspaceId, input.repo.fullName)).includes(3)) {
      throw new ValidationError('Demo PR #3 is present');
    }
    const cloneRoot = resolve(this.container.config.cloneDir);
    if (cloneRoot !== join(PRIVATE_ROOT, config.stackId, 'clones')) {
      throw new ValidationError('Clone directory is not isolated to the extraction stack');
    }
    const clone = resolve(cloneRoot, input.repo.owner, input.repo.name);
    if (!clone.startsWith(cloneRoot + sep)) throw new ValidationError('Clone path escapes the repository workspace');
    let commit: string;
    try {
      commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (execFileSync('git', ['-C', clone, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
        throw new Error('dirty clone');
      }
    } catch { throw new ValidationError('Repository clone revision or cleanliness cannot be verified'); }
    if (commit !== '5df959f3af698823dd582f1c3661f3e80df0b5da') {
      throw new ValidationError('Repository clone does not match the frozen revision');
    }
    const index = await this.container.repoIntel.getIndexState(input.repo.id);
    if (index.lastIndexedSha !== commit || !['full', 'partial'].includes(index.status) ||
        index.filesIndexed <= 0) {
      throw new ValidationError('Repository index is missing or belongs to a different revision');
    }
    if (this.container.config.secretsPath !== join(PRIVATE_ROOT, 'secrets.json')) {
      throw new ValidationError('Experiment key path is not isolated');
    }

    const binding: ExtractionBinding = {
      slot_id: slotId,
      stack_id: config.stackId,
      database_name: identity.name,
      postgres_system_identifier: identity.system_identifier,
      workspace_id: input.workspaceId,
      repository_id: input.repo.id,
      repository_full_name: input.repo.fullName,
      repository_commit_sha: commit,
      implementation_fingerprint: implementationFingerprint(repoRoot()).sha256,
      indexed_paths_sha256: sha256(canonicalJson(input.indexedPaths)),
      samples_sha256: sha256(canonicalJson(input.files.map(({ path, text }) => ({ path, text })))),
      request_sha256: extractionRequestSha256(frozenRequest as StructuredRequest<unknown>, options),
      adapter: 'openrouter',
      model: input.request.model,
      upstream_provider_slug: config.provider,
    };
    if (input.request.model !== config.model || config.providerName === null || config.servedModel === null) {
      throw new ValidationError('Conventions model or frozen serving provider differs from stack configuration');
    }
    const llm = await this.container.llm('openrouter');
    const lister = llm as Partial<{ listEndpoints(model: string): Promise<OpenRouterEndpointInfo[]> }>;
    if (typeof lister.listEndpoints !== 'function') throw new ValidationError('Endpoint metadata unavailable');
    const limits = exactConventionsPriceLimits(config, await lister.listEndpoints(input.request.model));
    if (!limits) throw new ValidationError('Frozen endpoint unavailable');
    const body = canonicalJson(experimentRequestBody(frozenRequest, options));
    const upper = inputUpperBound(body, 0);
    const decision = preflight({
      inputUpperBound: upper,
      outputCap: options.maxTokens,
      limits,
      reservationUsd: reservationUsd / 1.2,
      requireMaxCompletionTokens: true,
    });
    return {
      binding, options, upper, decision,
      providerName: config.providerName, servedModel: config.servedModel,
    };
  }

  /** Free, pinned-clone index for the dedicated stack; never resyncs to moving upstream HEAD. */
  async indexPinned(workspaceId: string, repositoryId: string) {
    const config = this.container.config.experiment;
    if (!config || this.container.config.embeddingsEnabled) throw new ValidationError('A no-embeddings experiment stack is required');
    const expectedDatabase = `devdigest_hw2f_${config.stackId.slice('hw2f-'.length)}`;
    const rows = await this.container.db.execute<{ name: string }>(sql`select current_database() as name`);
    if ([...rows][0]?.name !== expectedDatabase) throw new ValidationError('Wrong disposable database for indexing');
    const repo = await this.container.reposRepo.getById(workspaceId, repositoryId);
    if (!repo || repo.fullName !== 'fastify/fastify') throw new ValidationError('Wrong public repository for indexing');
    const cloneRoot = resolve(this.container.config.cloneDir);
    if (cloneRoot !== join(PRIVATE_ROOT, config.stackId, 'clones')) throw new ValidationError('Wrong extraction clone directory');
    const clone = resolve(cloneRoot, 'fastify', 'fastify');
    let commit: string;
    try {
      commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (execFileSync('git', ['-C', clone, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
        throw new Error('dirty clone');
      }
    } catch { throw new ValidationError('Clone revision cannot be verified'); }
    if (commit !== '5df959f3af698823dd582f1c3661f3e80df0b5da') {
      throw new ValidationError('Clone is not at the frozen public revision');
    }
    return this.container.repoIntel.indexRepo(repositoryId);
  }

  async preview<T>(input: Input<T>, slotId: string, reservationUsd: number): Promise<ExtractionPreview> {
    const snapshot = await this.snapshot(input, slotId, reservationUsd);
    return {
      ...snapshot.binding,
      expected_provider_name: snapshot.providerName,
      expected_served_model: snapshot.servedModel,
      sampled_paths: input.files.map((file) => file.path),
      indexed_paths: input.indexedPaths,
      input_upper_bound: snapshot.upper,
      output_cap: snapshot.options.maxTokens,
      worst_case_usd: snapshot.decision.worstCaseUsd ?? Number.NaN,
      reservation_usd: reservationUsd,
      ok: snapshot.decision.ok,
      reason: snapshot.decision.ok ? null : snapshot.decision.reason,
    };
  }

  async admit<T>(input: Input<T>, token: string | undefined): Promise<ExtractionAdmission> {
    const config = this.container.config.experiment;
    if (!config) throw new AppError('experiment_not_authorized', 'Conventions extraction refused: experiment stack is disabled', 403);
    const capPath = resolve(config.capabilityPath);
    if (!capPath.startsWith(PRIVATE_ROOT + sep)) refuse('capability is outside the private experiment root');
    if (!existsSync(capPath) || !lstatSync(capPath).isFile() || lstatSync(capPath).isSymbolicLink()) {
      refuse('missing or unsafe capability');
    }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(capPath, 'utf8')); } catch { refuse('unreadable capability'); }
    const cap = raw as ConventionsCapability;
    if (cap?.version !== 2 || cap.operation !== 'conventions.extract') refuse('wrong operation or version');
    const snapshot = await this.snapshot(input, cap.slot_id, cap.reservation_usd);
    const problem = extractionCapabilityProblem(cap, token, snapshot.binding);
    if (problem) refuse(problem);
    if (snapshot.providerName !== cap.expected_provider_name ||
        snapshot.servedModel !== cap.expected_served_model) refuse('serving provider differs from capability');
    if (!snapshot.decision.ok) refuse(`cost preflight: ${snapshot.decision.reason}`);

    // The runner owns the global lock and has reserved this exact slot before the HTTP request.
    const ledger = new Ledger(PRIVATE_ROOT);
    const slot = ledger.slots().get(cap.slot_id);
    if (!slot || slot.state !== 'reserved' || slot.phase !== 'exploration' ||
        slot.reservation_usd !== cap.reservation_usd ||
        slot.events[0]?.stack_id !== config.stackId) refuse('slot has no matching durable reservation');
    if (ledger.unresolved().some((item) => item.slot_id !== cap.slot_id)) refuse('another slot is unresolved');
    const charged = [...ledger.slots().values()]
      .filter((item) => item.slot_id !== cap.slot_id)
      .reduce((sum, item) => sum + (item.cost_usd ?? item.reservation_usd), 0);
    if (charged + cap.reservation_usd > cap.cumulative_ceiling_usd + 1e-12 ||
        charged + cap.reservation_usd > 1.5 + 1e-12) refuse('cumulative budget exceeded');
    if (Date.now() >= Date.parse(cap.expires_at)) refuse('capability expired before dispatch');

    const gate = this.container.experimentSpendGate;
    if (!gate.tryOpenExtraction(cap.slot_id, snapshot.binding.request_sha256, Date.parse(cap.expires_at))) {
      throw new ConflictError('Another experiment generation is in flight');
    }
    const receipts = new ExtractionReceipts(PRIVATE_ROOT);
    try {
      receipts.claim({
        capability_id: cap.capability_id,
        slot_id: cap.slot_id,
        request_sha256: snapshot.binding.request_sha256,
      });
      if (Date.now() >= Date.parse(cap.expires_at)) refuse('capability expired before dispatch');
      receipts.append(cap.slot_id, {
        capability_id: cap.capability_id,
        request_sha256: snapshot.binding.request_sha256,
        state: 'dispatching',
      });
    } catch (error) {
      gate.close(cap.slot_id);
      throw error;
    }

    const attempts: StructuredAttemptTelemetry[] = [];
    const onAttempt = (next: StructuredAttemptTelemetry) => {
      attempts.push(next);
      receipts.append(cap.slot_id, {
        capability_id: cap.capability_id,
        request_sha256: snapshot.binding.request_sha256,
        state: 'model_finished',
        attempt: receiptAttempt(next),
        cost_usd: next.costUsd,
      });
    };
    const append = (event: Parameters<ExtractionReceipts['append']>[1]) =>
      receipts.append(cap.slot_id, event);
    return {
      options: snapshot.options,
      timeoutMs: EXPERIMENT_REQUEST_TIMEOUT_MS,
      onAttempt,
      assertVerified: () => {
        const outcome = evaluateSlot({
          experiment: {
            dispatch_state: 'completed',
            diff_sha256: snapshot.binding.samples_sha256,
            attempts,
          },
        }, {
          providerName: cap.expected_provider_name,
          model: cap.model,
          servedModel: cap.expected_served_model,
          expectedDiffSha256: snapshot.binding.samples_sha256,
        });
        if (!outcome.eligible) throw new ValidationError(`Serving provider unverified: ${outcome.reasons.join('; ')}`);
      },
      modelResult: (data, raw) => append({
        capability_id: cap.capability_id,
        request_sha256: snapshot.binding.request_sha256,
        state: 'model_result',
        model_result: data,
        model_raw: raw,
        cost_usd: attempts.length === 1 ? attempts[0]!.costUsd : null,
      }),
      persisted: (ids, digest) => append({
        capability_id: cap.capability_id,
        request_sha256: snapshot.binding.request_sha256,
        state: 'persisted',
        candidate_ids: ids,
        candidate_digest: digest,
        cost_usd: attempts.length === 1 ? attempts[0]!.costUsd : null,
      }),
      failed: () => {
        try {
          append({
            capability_id: cap.capability_id,
            request_sha256: snapshot.binding.request_sha256,
            state: 'failed',
            reason: 'extraction did not complete',
            cost_usd: attempts.length === 1 ? attempts[0]!.costUsd : null,
          });
        } catch { /* Preserve the earlier durable state for manual reconciliation. */ }
      },
      close: () => gate.close(cap.slot_id),
    };
  }
}
