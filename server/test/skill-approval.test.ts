import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertSkillsApproved,
  skillApprovalState,
  skillBodySha256,
  unapprovedSkillsMessage,
} from '../src/modules/_shared/skill-approval.js';
import { SkillNotApprovedError } from '../src/platform/errors.js';

const skill = { version: 3, body: 'Flag unbounded retries.' };
const sha = createHash('sha256').update(skill.body, 'utf8').digest('hex');
const at = new Date('2026-10-30T10:00:00.000Z');
const approve = (version: number, bodySha256: string) => ({
  decision: 'approve' as const,
  version,
  bodySha256,
  actorUserId: 'owner-1',
  createdAt: at,
});

describe('skill content approval policy', () => {
  it('hashes the exact body with no normalisation', () => {
    expect(skillBodySha256(skill.body)).toBe(sha);
    expect(skillBodySha256(`${skill.body} `)).not.toBe(sha);
    expect(skillBodySha256(skill.body.replace('.', '.\r'))).not.toBe(sha);
  });

  it('is unapproved with no decision', () => {
    expect(skillApprovalState(skill, undefined)).toEqual({
      status: 'unapproved',
      version: 3,
      body_sha256: sha,
      approved_version: null,
      approved_at: null,
      approved_by: null,
    });
  });

  it('is approved only for exactly the current version and digest', () => {
    expect(skillApprovalState(skill, approve(3, sha))).toMatchObject({
      status: 'approved',
      approved_version: 3,
      approved_at: at.toISOString(),
      approved_by: 'owner-1',
    });
  });

  it('is stale when the version moved, even with the same digest (restore)', () => {
    expect(skillApprovalState(skill, approve(2, sha)).status).toBe('stale');
  });

  it('is stale when the body changed under the same version', () => {
    expect(skillApprovalState(skill, approve(3, 'f'.repeat(64))).status).toBe('stale');
  });

  it('is revoked when the latest decision is a revoke', () => {
    expect(skillApprovalState(skill, { ...approve(3, sha), decision: 'revoke' })).toMatchObject({
      status: 'revoked',
      approved_version: null,
    });
  });

  it('the gate names every blocked skill and its reason, and passes approved ones', () => {
    const ok = { skill: { name: 'a' }, approval: { status: 'approved' as const } };
    expect(() => assertSkillsApproved([])).not.toThrow();
    expect(() => assertSkillsApproved([ok])).not.toThrow();
    const blocked = [
      ok,
      { skill: { name: 'b' }, approval: { status: 'stale' as const } },
      { skill: { name: 'c' }, approval: { status: 'revoked' as const } },
    ];
    let thrown: unknown;
    try {
      assertSkillsApproved(blocked);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillNotApprovedError);
    const err = thrown as SkillNotApprovedError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe(
      unapprovedSkillsMessage([
        { name: 'b', status: 'stale' },
        { name: 'c', status: 'revoked' },
      ]),
    );
    expect(err.message).toContain('"b" (stale), "c" (revoked)');
    expect(err.message).not.toContain('"a"');
  });
});
