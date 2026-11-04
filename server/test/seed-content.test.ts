import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { groundFindings } from '@devdigest/reviewer-core';
import { API_CONTRACT_REVIEWER_PROMPT } from '../src/db/seed-prompts.js';
import { API_CONTRACT_SEED_SKILLS } from '../src/db/seed-skills.js';
import { EXPERIMENT_FIXTURES, patchStats, type ExpectedAnchor } from '../src/db/seed-fixtures.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';

const repoFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const skillDoc = (name: string) => repoFile(`docs/skills/api-contract/${name}.md`).trim();
const ALL_SKILLS = ['breaking-change', 'response-schema', 'semver-discipline', 'deprecation-policy'];

describe('API Contract skill documents', () => {
  it.each(ALL_SKILLS)('%s is importable: heading = name, directive description, good and bad example', (name) => {
    const doc = skillDoc(name);
    expect(doc.split('\n')[0]).toBe(`# ${name}`); // the import drawer names a skill from its first heading
    expect(doc).toMatch(/^Description: Flag .{40,}$/m);
    for (const section of ['## Good', '## Bad']) {
      const at = doc.indexOf(section);
      expect(at).toBeGreaterThan(0);
      expect(doc.slice(at)).toMatch(/```[a-z]*\n[\s\S]+?\n```/);
    }
  });

  it.each(ALL_SKILLS)('%s: every json example is valid JSON', (name) => {
    const blocks = [...skillDoc(name).matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    for (const block of blocks) expect(() => JSON.parse(block)).not.toThrow();
  });

  it('seeds exactly three of them, verbatim, and leaves deprecation-policy to a real import', () => {
    expect(API_CONTRACT_SEED_SKILLS.map((skill) => skill.name)).toEqual(['breaking-change', 'response-schema', 'semver-discipline']);
    for (const skill of API_CONTRACT_SEED_SKILLS) {
      const doc = skillDoc(skill.name);
      expect(skill.body).toBe(doc);
      expect(skill.description).toBe(/^Description: (.+)$/m.exec(doc)![1]);
    }
  });

  it('the API Contract Reviewer prompt matches its reviewable copy', () => {
    expect(API_CONTRACT_REVIEWER_PROMPT).toBe(repoFile('docs/agent-prompts/api-contract-reviewer.md').trim());
  });
});

/** New-side line numbers that the patch adds (context lines excluded). */
function addedLines(patch: string): Set<number> {
  const added = new Set<number>();
  let cursor = 0;
  for (const line of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) cursor = Number(header[1]);
    else if (line.startsWith('+')) added.add(cursor++);
    else if (!line.startsWith('-')) cursor++;
  }
  return added;
}

function anchorFinding(anchor: ExpectedAnchor): Finding {
  return {
    file: anchor.file,
    start_line: anchor.start_line,
    end_line: anchor.end_line,
    severity: 'WARNING',
    category: 'test',
    title: 'expected finding',
    rationale: 'anchor check',
    suggestion: null,
    confidence: 0.9,
  } as Finding;
}

describe.each(EXPERIMENT_FIXTURES.map((fixture) => [fixture.number, fixture] as const))('experiment fixture #%i', (_number, fixture) => {
  const stubRepo = {
    getPrFiles: async () => fixture.files.map((file) => ({ ...file, ...patchStats(file.patch) })),
  } as unknown as ReviewRepository;

  it('parses through the same path as a review (stored patches, no clone)', async () => {
    const diff = await diffFromPrFiles(stubRepo, 'fixture');
    expect(diff.files.map((file) => file.path)).toEqual(fixture.files.map((file) => file.path));
    for (const file of diff.files) {
      const expected = patchStats(fixture.files.find((f) => f.path === file.path)!.patch);
      expect({ additions: file.additions, deletions: file.deletions }).toEqual(expected);
      // Hunk headers must agree with the hunk bodies, or line numbers drift.
      for (const hunk of file.hunks) expect(hunk.newLineNumbers).toHaveLength(hunk.newLines);
    }
  });

  it('every expected anchor survives grounding and cites lines the PR adds', async () => {
    const diff = await diffFromPrFiles(stubRepo, 'fixture');
    const grounded = groundFindings(fixture.expectedAnchors.map(anchorFinding), diff);
    expect(grounded.dropped).toEqual([]);
    for (const anchor of fixture.expectedAnchors) {
      const added = addedLines(fixture.files.find((f) => f.path === anchor.file)!.patch);
      const cited = Array.from({ length: anchor.end_line - anchor.start_line + 1 }, (_, i) => anchor.start_line + i);
      expect(cited.some((line) => added.has(line))).toBe(true);
    }
  });

  it('links no issue from the PR body', () => {
    expect(fixture.body).not.toMatch(/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i);
  });
});
