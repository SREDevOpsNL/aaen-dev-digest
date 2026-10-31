import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import { skillBodySha256 } from '../modules/_shared/skill-approval.js';

/**
 * Seeded-skill approval bootstrap (narrow by design).
 *
 * The seed records an 'approve' decision for a seeded skill ONLY when the
 * sha256 of its stored body is listed here, and only if the skill has no
 * decision yet (so re-seeding never overrides an owner's revoke, and an edited
 * body never matches). Every other skill — created, imported (e.g. the
 * import-only `deprecation-policy`), extracted from conventions, or a seeded
 * body that drifted — stays unapproved until a workspace owner approves it.
 *
 * Each digest was added after a human-equivalent review of that exact body for
 * instruction-injection text (requests to ignore prior instructions, change
 * the output contract, approve or suppress findings, reveal secrets, call
 * tools, or address the model as anything but review guidance). Changing a
 * body in ./seed-skills.ts requires a new review and a new digest here;
 * `test/reviewed-seed-skills.test.ts` fails until both agree.
 *
 * Reviewed 2026-10-30 (L02 criterion #14): rubric guidance only, no injection.
 */
export const REVIEWED_SEED_SKILL_DIGESTS: Readonly<Record<string, string>> = {
  'Behavioral Coverage': '05f50d8b623fda801c4e920c8906fc0164b19cc29d75ba7836c53dfcefe85857',
  'Assertion Quality': '01f7c2657693c242903e49a2b7c6712269ebd89c1e5ac1cd0178f18e29400ad3',
  'Edge Cases and Error Paths': '82a7461ebbbe62468b147ed04fb2571b0bf7d8d1adeb794839739e77d48ed17f',
  'Test Isolation and Determinism': '802a031e78d944ed9c72fc174eee5d590e89e141a3079d04e56f356bddf1ed04',
  'breaking-change': '0d3d2e49739250a4c085e9287f9d0c76e48d2158d8bbf0d08c17369a155c6770',
  'response-schema': 'd77725aec88459f79d7c7ab4ae69ca013c6a000ffe5808841970cb5d70073429',
  'semver-discipline': '041651c1f14dd5041330144a2e88085d3ee9e02bb6769049be2f43047fe566b1',
};

export const SEED_BOOTSTRAP_REASON = 'seed-bootstrap: reviewed content digest';

/** Pure: true when this exact body is the reviewed body for this seeded name. */
export function isReviewedSeedBody(name: string, body: string): boolean {
  const digest = REVIEWED_SEED_SKILL_DIGESTS[name];
  return digest !== undefined && digest === skillBodySha256(body);
}

/**
 * Record the bootstrap approval for one stored seeded skill when its current
 * body is on the reviewed list and it has never had a decision. Idempotent.
 */
export async function approveReviewedSeedSkill(
  db: Db,
  skill: typeof t.skills.$inferSelect,
  actorUserId: string,
): Promise<void> {
  if (!isReviewedSeedBody(skill.name, skill.body)) return;
  const [existing] = await db
    .select({ id: t.skillApprovals.id })
    .from(t.skillApprovals)
    .where(and(eq(t.skillApprovals.workspaceId, skill.workspaceId), eq(t.skillApprovals.skillId, skill.id)))
    .limit(1);
  if (existing) return;
  await db.insert(t.skillApprovals).values({
    workspaceId: skill.workspaceId,
    skillId: skill.id,
    skillName: skill.name,
    version: skill.version,
    bodySha256: skillBodySha256(skill.body),
    decision: 'approve',
    actorUserId,
    reason: SEED_BOOTSTRAP_REASON,
  });
}
