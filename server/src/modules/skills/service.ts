import type { Skill, SkillSource, SkillSummary, SkillType, SkillVersion } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
import { SkillsRepository } from './repository.js';

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** Business boundary for text-only skill configuration. */
export class SkillsService {
  private readonly repository: SkillsRepository;

  constructor(container: Container) {
    this.repository = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<SkillSummary[]> {
    return (await this.repository.list(workspaceId)).map(({ skill, usedByCount }) => ({
      ...toSkillDto(skill),
      used_by_count: usedByCount,
    }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repository.get(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    return toSkillDto(await this.repository.create({
      workspaceId,
      ...input,
      evidenceFiles: input.evidence_files,
    }));
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repository.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repository.delete(workspaceId, id);
  }

  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    if (!(await this.repository.get(workspaceId, id))) return undefined;
    return (await this.repository.listVersions(id)).map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    if (!(await this.repository.get(workspaceId, id))) return undefined;
    const row = await this.repository.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  async linkedAgents(
    workspaceId: string,
    id: string,
  ): Promise<Array<{ id: string; name: string }> | undefined> {
    if (!(await this.repository.get(workspaceId, id))) return undefined;
    return this.repository.linkedAgents(id);
  }
}
