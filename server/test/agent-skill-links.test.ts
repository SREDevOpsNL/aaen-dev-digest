import { describe, expect, it } from 'vitest';
import { exceedsSkillLimit, insertSkillAt, MAX_AGENT_SKILLS } from '../src/modules/_shared/agent-skill-links.js';

describe('agent skill link policy', () => {
  it('limits an agent to four skills', () => {
    expect(MAX_AGENT_SKILLS).toBe(4);
    expect(exceedsSkillLimit(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(false);
    expect(exceedsSkillLimit(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e'])).toBe(true);
    expect(exceedsSkillLimit([], ['a', 'b', 'c', 'd', 'e'])).toBe(true);
  });

  it('never blocks reordering or reducing an agent already above the limit', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(exceedsSkillLimit(five, [...five].reverse())).toBe(false);
    expect(exceedsSkillLimit(five, five.slice(0, 4))).toBe(false);
    expect(exceedsSkillLimit(five, ['a', 'b', 'c', 'd', 'x'])).toBe(true); // swapping one in still adds
  });

  it('inserts at the end by default, at an index, or moves an already linked skill', () => {
    expect(insertSkillAt(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(insertSkillAt(['a', 'b'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(insertSkillAt(['a', 'b'], 'c', 99)).toEqual(['a', 'b', 'c']);
    expect(insertSkillAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
});
