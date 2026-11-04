import type {
  Skill,
  SkillApprovalRecord,
  SkillSource,
  SkillSummary,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { SkillRow } from '../../db/rows.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SkillLimitError,
  ValidationError,
} from '../../platform/errors.js';
import { toSkillApprovalRecord, toSkillDto, toSkillVersionDto } from './helpers.js';
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
    const rows = await this.repository.list(workspaceId);
    const latest = await this.repository.latestDecisions(workspaceId, rows.map((r) => r.skill.id));
    return rows.map(({ skill, usedByCount }) => ({
      ...toSkillDto(skill, latest.get(skill.id)),
      agent_count: usedByCount,
      used_by_count: usedByCount,
    }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repository.get(workspaceId, id);
    return row ? this.withApproval(workspaceId, row) : undefined;
  }

  /** The DTO with the approval state of the row's current content. */
  private async withApproval(workspaceId: string, row: SkillRow): Promise<Skill> {
    const latest = await this.repository.latestDecisions(workspaceId, [row.id]);
    return toSkillDto(row, latest.get(row.id));
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const { link_agent_id: linkAgentId, evidence_files: evidenceFiles, ...fields } = input;
    const result = await this.repository.create({ workspaceId, ...fields, evidenceFiles, linkAgentId });
    if (result.kind === 'agent_not_found') {
      throw new ValidationError('link_agent_id must be an agent in this workspace');
    }
    if (result.kind === 'limit_exceeded') throw new SkillLimitError(result.max);
    // Never auto-approved: a new skill has no decision, so it is `unapproved`.
    return toSkillDto(result.skill);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repository.update(workspaceId, id, patch);
    return row ? this.withApproval(workspaceId, row) : undefined;
  }

  /** Restore a previous version's body as the newest version (see the repository). */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill> {
    const result = await this.repository.restoreVersion(workspaceId, id, version);
    if (result.kind === 'skill_not_found') throw new NotFoundError('Skill not found');
    if (result.kind === 'version_not_found') throw new NotFoundError('Skill version not found');
    return this.withApproval(workspaceId, result.skill);
  }

  /**
   * Approve the exact content the owner reviewed. 403 unless the caller owns
   * the workspace; 404 outside it; 409 when `version`/`body_sha256` no longer
   * match the current body. Re-approving approved content writes nothing.
   */
  async approve(
    ctx: { workspaceId: string; userId: string },
    id: string,
    input: { version: number; body_sha256: string; reason?: string },
  ): Promise<Skill> {
    await this.assertOwner(ctx);
    const result = await this.repository.recordDecision({
      workspaceId: ctx.workspaceId,
      skillId: id,
      actorUserId: ctx.userId,
      decision: 'approve',
      reason: input.reason || undefined,
      reviewed: { version: input.version, bodySha256: input.body_sha256 },
    });
    if (result.kind === 'skill_not_found') throw new NotFoundError('Skill not found');
    if (result.kind === 'content_mismatch') {
      throw new ConflictError('The skill changed since it was reviewed; review the current content and approve again', {
        current_version: result.skill.version,
        current_body_sha256: result.currentSha256,
      });
    }
    return toSkillDto(result.skill, result.latest);
  }

  /** Revoke the latest approval (current or stale). 409 when there is none. */
  async revoke(ctx: { workspaceId: string; userId: string }, id: string, reason?: string): Promise<Skill> {
    await this.assertOwner(ctx);
    const result = await this.repository.recordDecision({
      workspaceId: ctx.workspaceId,
      skillId: id,
      actorUserId: ctx.userId,
      decision: 'revoke',
      reason: reason || undefined,
    });
    if (result.kind === 'skill_not_found') throw new NotFoundError('Skill not found');
    if (result.kind === 'unchanged') throw new ConflictError('The skill has no approval to revoke');
    if (result.kind === 'content_mismatch') throw new ConflictError('Unexpected revoke outcome');
    return toSkillDto(result.skill, result.latest);
  }

  async listApprovals(workspaceId: string, id: string): Promise<SkillApprovalRecord[] | undefined> {
    if (!(await this.repository.get(workspaceId, id))) return undefined;
    return (await this.repository.listDecisions(workspaceId, id)).map(({ row, actorName }) =>
      toSkillApprovalRecord(row, actorName),
    );
  }

  private async assertOwner(ctx: { workspaceId: string; userId: string }): Promise<void> {
    if (!(await this.repository.isWorkspaceOwner(ctx.workspaceId, ctx.userId))) {
      throw new ForbiddenError('Only a workspace owner can approve or revoke skill content');
    }
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
