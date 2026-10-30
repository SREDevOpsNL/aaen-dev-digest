import type { FastifyInstance } from 'fastify';
import type { Skill } from '@devdigest/shared';

/**
 * Approve a skill's CURRENT content through the real API, as the workspace
 * owner would: read the version and digest it shows, then approve exactly
 * those. Reviews fail closed on any enabled linked skill that is not approved,
 * so a test that links skills and runs a review approves them first.
 */
export async function approveSkill(app: FastifyInstance, skillId: string, reason = 'test approval'): Promise<Skill> {
  const current = await app.inject({ method: 'GET', url: `/skills/${skillId}` });
  if (current.statusCode !== 200) throw new Error(`GET /skills/${skillId} → ${current.statusCode}: ${current.body}`);
  const skill = current.json() as Skill;
  const res = await app.inject({
    method: 'POST',
    url: `/skills/${skillId}/approval`,
    payload: { version: skill.approval.version, body_sha256: skill.approval.body_sha256, reason },
  });
  if (res.statusCode !== 200) throw new Error(`approve ${skillId} → ${res.statusCode}: ${res.body}`);
  return res.json() as Skill;
}

/** Approve every skill in the caller's workspace (the current content of each). */
export async function approveAllSkills(app: FastifyInstance): Promise<void> {
  const list = await app.inject({ method: 'GET', url: '/skills' });
  for (const skill of list.json() as Skill[]) {
    if (skill.approval.status !== 'approved') await approveSkill(app, skill.id);
  }
}
