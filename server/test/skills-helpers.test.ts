import { describe, expect, it } from 'vitest';
import { isSkillConfigChange, toSkillDto, toSkillVersionDto } from '../src/modules/skills/helpers.js';

const row = {
  id: 'skill-1',
  workspaceId: 'workspace-1',
  name: 'Assertions',
  description: 'Check assertions.',
  type: 'rubric' as const,
  source: 'manual' as const,
  body: 'Observe behavior.',
  enabled: true,
  version: 1,
  evidenceFiles: null,
  createdAt: new Date('2026-09-22T12:00:00.000Z'),
};

describe('skill mappings and version rule', () => {
  it('maps database names to the public text-only contract', () => {
    expect(toSkillDto(row)).toEqual({
      id: 'skill-1',
      name: 'Assertions',
      description: 'Check assertions.',
      type: 'rubric',
      source: 'manual',
      body: 'Observe behavior.',
      enabled: true,
      version: 1,
      evidence_files: null,
    });
  });

  it('creates history for changed config but not runtime enablement', () => {
    expect(isSkillConfigChange(row, { enabled: false })).toBe(false);
    expect(isSkillConfigChange(row, { body: row.body })).toBe(false);
    expect(isSkillConfigChange(row, { description: 'New description' })).toBe(true);
    expect(isSkillConfigChange(row, { body: 'New body' })).toBe(true);
  });

  it('maps immutable body history with the forward-compatible null message', () => {
    expect(
      toSkillVersionDto({
        skillId: row.id,
        version: 2,
        body: 'New body',
        createdAt: new Date('2026-09-22T13:00:00.000Z'),
      }),
    ).toEqual({
      skill_id: row.id,
      version: 2,
      body: 'New body',
      message: null,
      created_at: '2026-09-22T13:00:00.000Z',
    });
  });
});

