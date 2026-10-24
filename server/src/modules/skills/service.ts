import type { Skill, SkillSource, SkillSummary, SkillType, SkillVersion } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, SkillLimitError, ValidationError } from '../../platform/errors.js';
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
  /** Link the new skill to this agent in the same transaction. */
  link_agent_id?: string;
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
      agent_count: usedByCount,
      used_by_count: usedByCount,
    }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repository.get(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const { link_agent_id: linkAgentId, evidence_files: evidenceFiles, ...fields } = input;
    const result = await this.repository.create({ workspaceId, ...fields, evidenceFiles, linkAgentId });
    if (result.kind === 'agent_not_found') {
      throw new ValidationError('link_agent_id must be an agent in this workspace');
    }
    if (result.kind === 'limit_exceeded') throw new SkillLimitError(result.max);
    return toSkillDto(result.skill);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repository.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  /** Restore a previous version's body as the newest version (see the repository). */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill> {
    const result = await this.repository.restoreVersion(workspaceId, id, version);
    if (result.kind === 'skill_not_found') throw new NotFoundError('Skill not found');
    if (result.kind === 'version_not_found') throw new NotFoundError('Skill version not found');
    return toSkillDto(result.skill);
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
