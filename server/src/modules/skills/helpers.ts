import type { Skill, SkillApprovalRecord, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillApprovalRow, SkillRow, SkillVersionRow } from '../../db/rows.js';
import { skillApprovalState, type ApprovalDecision } from '../_shared/skill-approval.js';

/** Pure row-to-contract mapping for a skill and its latest approval decision. */
export function toSkillDto(row: SkillRow, latestDecision?: ApprovalDecision): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    approval: skillApprovalState(row, latestDecision),
  };
}

/** Pure row-to-contract mapping for one audit row. */
export function toSkillApprovalRecord(row: SkillApprovalRow, actorName: string | null): SkillApprovalRecord {
  return {
    id: String(row.id),
    skill_id: row.skillId,
    skill_name: row.skillName,
    version: row.version,
    body_sha256: row.bodySha256,
    decision: row.decision,
    actor_user_id: row.actorUserId,
    actor_name: actorName,
    reason: row.reason,
    created_at: row.createdAt.toISOString(),
  };
}

/** Pure row-to-contract mapping for an immutable body snapshot. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    message: null,
    created_at: row.createdAt.toISOString(),
  };
}

export interface SkillConfigPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

/** Enabled is runtime state, not config, so toggling it does not create history. */
export function isSkillConfigChange(
  current: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillConfigPatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== current.name) ||
    (patch.description !== undefined && patch.description !== current.description) ||
    (patch.type !== undefined && patch.type !== current.type) ||
    (patch.body !== undefined && patch.body !== current.body)
  );
}
