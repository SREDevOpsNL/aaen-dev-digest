import type {
  StructuredRequest,
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import {
  CONFIG_SAMPLE_PATHS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TEMPERATURE,
  EXTRACT_TIMEOUT_MS,
  MAX_SAMPLE_CHARS,
  TOP_CODE_SAMPLES,
} from './constants.js';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSamples,
  ruleKey,
  toCandidateDto,
  toSampledFile,
  verifyCandidate,
  type SampledFile,
  type VerifiedCandidate,
} from './helpers.js';
import { ExtractionSchema, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { ConventionsRepository } from './repository.js';
import { ConventionsExperiment } from '../experiments/conventions.js';
import { canonicalJson, sha256 } from '../_shared/experiment.js';

export class ConventionsService {
  private repository: ConventionsRepository;

  constructor(private container: Container) {
    this.repository = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    if (!(await this.container.reposRepo.getById(workspaceId, repoId))) {
      throw new NotFoundError('Repository not found');
    }
    return (await this.repository.listForRepo(workspaceId, repoId)).map(toCandidateDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repository.update(workspaceId, id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repository.deleteById(workspaceId, id);
  }

  /** The exact sample and model request shared by free preview and one paid extraction. */
  private async prepare(workspaceId: string, repoId: string) {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    const { files, indexedPaths } = await this.sample(repoId, { owner: repo.owner, name: repo.name });
    if (files.length === 0) {
      throw new ValidationError('Nothing to sample — clone and index the repository before running the scan.');
    }
    const sampledPaths = files.map((file) => file.path);
    const choice = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const request: StructuredRequest<typeof ExtractionSchema._output> = {
      model: choice.model,
      schema: ExtractionSchema,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(repo.fullName, renderSamples(files, MAX_SAMPLE_CHARS), sampledPaths) },
      ],
      temperature: EXTRACT_TEMPERATURE,
      maxTokens: EXTRACT_MAX_TOKENS,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    };
    return { workspaceId, repo, files, indexedPaths, request, choice, sampledPaths };
  }

  async previewExtraction(workspaceId: string, repoId: string, slotId: string, reservationUsd: number) {
    const prepared = await this.prepare(workspaceId, repoId);
    if (prepared.choice.provider !== 'openrouter') throw new ValidationError('Conventions experiment model must use OpenRouter');
    return new ConventionsExperiment(this.container).preview(prepared, slotId, reservationUsd);
  }

  async extract(workspaceId: string, repoId: string, capabilityToken?: string): Promise<ConventionExtractResult> {
    const prepared = await this.prepare(workspaceId, repoId);
    const { repo, files, indexedPaths, request, choice, sampledPaths } = prepared;
    if (this.container.config.experiment && choice.provider !== 'openrouter') {
      throw new ValidationError('Conventions experiment model must use OpenRouter');
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    const admission = this.container.config.experiment
      ? await new ConventionsExperiment(this.container).admit(prepared, capabilityToken)
      : null;
    try {
      const result = await (await this.container.llm(choice.provider)).completeStructured({
        ...request,
        ...(admission ? {
          experiment: admission.options,
          timeoutMs: admission.timeoutMs,
          maxRetries: 0,
          onAttempt: admission.onAttempt,
        } : {}),
      });
      admission?.assertVerified();
      admission?.modelResult(result.data, result.raw);

    const verified: VerifiedCandidate[] = [];
    let droppedUngrounded = 0;
    for (const raw of result.data.candidates) {
      const check = verifyCandidate(byPath, raw);
      if (check.ok) verified.push(check.candidate);
      else droppedUngrounded += 1;
    }
    verified.sort((left, right) => right.confidence - left.confidence);
    const decided = (await this.repository.listForRepo(workspaceId, repoId))
      .filter((row) => row.status !== 'pending')
      .map((row) => ruleKey(row.rule));
    const { kept, dropped } = dedupeCandidates(verified, decided);
    await this.repository.replacePending(workspaceId, repoId, kept);
    const candidateRows = await this.repository.listForRepo(workspaceId, repoId);
    admission?.persisted(
      candidateRows.filter((row) => row.status === 'pending').map((row) => row.id),
      sha256(canonicalJson(candidateRows.filter((row) => row.status === 'pending').map((row) => ({
        id: row.id, rule: row.rule, evidencePath: row.evidencePath, evidenceLine: row.evidenceLine,
      })))),
    );

    return {
      candidates: candidateRows.map(toCandidateDto),
      sampled_files: sampledPaths,
      proposed: result.data.candidates.length,
      dropped_ungrounded: droppedUngrounded,
      dropped_duplicate: dropped,
      model: result.model,
      cost_usd: result.costUsd,
    };
    } catch (error) {
      admission?.failed();
      throw error;
    } finally {
      admission?.close();
    }
  }

  async skillDraft(
    workspaceId: string,
    repoId: string,
    ids?: string[],
  ): Promise<ConventionSkillDraft> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    const rows = ids?.length
      ? await this.repository.listByIds(workspaceId, repoId, ids)
      : (await this.repository.listForRepo(workspaceId, repoId))
        .filter((row) => row.status === 'accepted');
    if (ids?.length && rows.length !== ids.length) {
      throw new ValidationError('Every selected convention must be accepted in this repository');
    }
    if (rows.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }
    return buildSkillDraft(repo.fullName, rows);
  }

  private async sample(repoId: string, ref: RepoRef): Promise<{ files: SampledFile[]; indexedPaths: string[] }> {
    const codePaths = await this.container.repoIntel
      .getConventionSamples(repoId, TOP_CODE_SAMPLES)
      .catch(() => [] as string[]);
    const files: SampledFile[] = [];
    const seen = new Set<string>();
    for (const path of [...CONFIG_SAMPLE_PATHS, ...codePaths]) {
      if (seen.has(path)) continue;
      seen.add(path);
      try {
        const raw = await this.container.git.readFile(ref, path);
        if (raw.trim()) files.push(toSampledFile(path, raw));
      } catch {
        // Config paths are a wish-list; missing/unreadable files are expected.
      }
    }
    return { files, indexedPaths: codePaths };
  }
}
