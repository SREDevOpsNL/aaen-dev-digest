import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { SkillApproval } from '@devdigest/shared';
import type { Db, Tx } from '../../db/client.js';
import type { SkillApprovalRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
import { SkillNotApprovedError } from '../../platform/errors.js';

/**
 * Skill-content approval policy, shared by the skills module (decisions, DTOs),
 * the agents module (linked-skill DTOs, prompt inputs) and the review executor
 * (fail-closed gate). A skill body reaches the review's system message only
 * when it is approved; enabling a skill never approves it.
 */

/**
 * sha256 (hex) of the exact stored body string, UTF-8, no normalisation.
 *
 * The prompt sends `body.trim()` (`toSkillPromptBlock`). Every write path
 * stores an already-trimmed body, so the digest covers exactly the sent text:
 * create/update trim at the HTTP boundary (`routes.ts`, Zod `.trim()`; the
 * conventions "create skill" flow uses the same POST /skills), seeded bodies
 * are trimmed (`test/reviewed-seed-skills.test.ts`), and restore copies a
 * snapshot written by one of those paths. Even an untrimmed body would only
 * lose outer whitespace when sent, never gain content.
 */
export function skillBodySha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** The decision fields the policy reads from the latest audit row. */
export type ApprovalDecision = Pick<SkillApprovalRow, 'decision' | 'version' | 'bodySha256' | 'actorUserId' | 'createdAt'>;

/**
 * Pure: the approval state of a skill's CURRENT content, from its latest
 * decision. Approved only when that decision approves exactly the current
 * version and body digest; any edit or restore therefore reads as `stale`
 * without a write, and a later `revoke` reads as `revoked`.
 */
export function skillApprovalState(
  skill: { version: number; body: string },
  latest: ApprovalDecision | undefined,
): SkillApproval {
  const bodySha256 = skillBodySha256(skill.body);
  const base = { version: skill.version, body_sha256: bodySha256 };
  if (!latest) {
    return { ...base, status: 'unapproved', approved_version: null, approved_at: null, approved_by: null };
  }
  if (latest.decision === 'revoke') {
    return { ...base, status: 'revoked', approved_version: null, approved_at: null, approved_by: null };
  }
  const exact = latest.version === skill.version && latest.bodySha256 === bodySha256;
  return {
    ...base,
    status: exact ? 'approved' : 'stale',
    approved_version: latest.version,
    approved_at: latest.createdAt.toISOString(),
    approved_by: latest.actorUserId,
  };
}

/** A skill whose current content may not enter the prompt, and why. */
export interface UnapprovedSkill {
  name: string;
  status: Exclude<SkillApproval['status'], 'approved'>;
}

/** Pure: the error text for a review blocked by unapproved enabled skills. */
export function unapprovedSkillsMessage(blocked: readonly UnapprovedSkill[]): string {
  const list = blocked.map((s) => `"${s.name}" (${s.status})`).join(', ');
  return (
    `Review blocked before model dispatch: enabled skill(s) not approved for the system prompt: ${list}. ` +
    'A workspace owner must approve the current content, or disable the skill for this agent.'
  );
}

/** Fixed run error when approval state cannot be read; the cause is logged server-side only. */
export const SKILL_APPROVAL_UNAVAILABLE =
  'Review blocked before model dispatch: skill approval state unavailable.';

/**
 * The fail-closed gate: throws SkillNotApprovedError naming every effective
 * (enabled globally and for the agent) skill whose current content is not
 * approved. Callers pass only effective skills; disabled ones need no approval.
 */
export function assertSkillsApproved(
  effective: ReadonlyArray<{ skill: { name: string }; approval: Pick<SkillApproval, 'status'> }>,
): void {
  const blocked: UnapprovedSkill[] = [];
  for (const { skill, approval } of effective) {
    if (approval.status !== 'approved') blocked.push({ name: skill.name, status: approval.status });
  }
  if (blocked.length > 0) throw new SkillNotApprovedError(unapprovedSkillsMessage(blocked), { skills: blocked });
}

/**
 * The latest decision per skill (highest id), scoped to the workspace. Skills
 * without any decision are absent from the map.
 */
export async function latestSkillDecisions(
  db: Db | Tx,
  workspaceId: string,
  skillIds: readonly string[],
): Promise<Map<string, SkillApprovalRow>> {
  const latest = new Map<string, SkillApprovalRow>();
  if (skillIds.length === 0) return latest;
  const rows = await db
    .selectDistinctOn([t.skillApprovals.skillId])
    .from(t.skillApprovals)
    .where(and(eq(t.skillApprovals.workspaceId, workspaceId), inArray(t.skillApprovals.skillId, [...skillIds])))
    .orderBy(t.skillApprovals.skillId, desc(t.skillApprovals.id));
  for (const row of rows) if (row.skillId) latest.set(row.skillId, row);
  return latest;
}
