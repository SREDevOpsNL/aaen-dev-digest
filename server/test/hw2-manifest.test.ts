import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_FIXTURES, type ExperimentFixture } from '../src/db/seed-fixtures.js';
import { authorize, main, type Stack } from '../src/experiments/hw2/cli.js';
import {
  buildManifest,
  byNameThenId,
  exactlyOne,
  frozenSkillProblems,
  manifestDifferences,
  manifestFingerprint,
  verifyPreregistration,
  type Manifest,
  type ManifestInput,
} from '../src/experiments/hw2/manifest.js';
import { buildSchedule } from '../src/experiments/hw2/schedule.js';

const agent = (id: string, name: string, prompt = `${name} instructions`) => ({ id, name, enabled: true, provider: 'openrouter', system_prompt: prompt, output_schema: null, model: 'deepseek/deepseek-v4-flash', strategy: 'single-pass', repo_intel: false });
const skill = (id: string, name: string, body = `${name} body`) => ({ id, name, body, enabled: true, approval: { status: 'approved', approved_version: 1 } });

/** What `currentManifest` passes in, in the order the API happened to list the rows. */
function input(overrides: Partial<ManifestInput> = {}): ManifestInput {
  return {
    implementationFingerprint: 'impl',
    nonSkillFingerprints: { '17': 'n17', '18': 'n18' },
    stack: { database: 'devdigest_hw2f_test', provider: 'deepinfra/fp8', providerName: 'DeepInfra', model: 'deepseek/deepseek-v4-flash', servedModel: 'deepseek/deepseek-v4-flash-20260423', maxOutputTokens: 4000, prices: { input: 0.00000009, output: 0.00000018 }, generationLookup: null },
    skills: [skill('s-2', 'breaking-change'), skill('s-1', 'Edge Cases and Error Paths')],
    agents: [agent('a-2', 'API Contract Reviewer'), agent('a-1', 'Test Quality Reviewer')],
    schedule: { seed: 20261030, slots: buildSchedule({ seed: 20261030, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }) },
    rules: { '17': { anchors: [{ file: 'src/a.ts', start_line: 1, end_line: 2 }], keywords: ['expir'] }, '18': { anchors: [{ file: 'src/b.ts', start_line: 3, end_line: 4 }], keywords: ['break'] } },
    perSlotReservationUsd: 0.005,
    ...overrides,
  };
}
const fingerprint = async (i: ManifestInput) => manifestFingerprint(await buildManifest(i));

describe('manifest determinism', () => {
  it('row order of agents and Skills does not change the fingerprint', async () => {
    const base = input();
    const reversed = input({ agents: [...base.agents].reverse(), skills: [...base.skills].reverse() });
    expect(await fingerprint(reversed)).toBe(await fingerprint(base));
    // The 2026-10-31 failure: the same two reviewers, listed the other way round.
    const manifest = await buildManifest(base);
    expect(manifest.agents.map((a) => a.name)).toEqual(['API Contract Reviewer', 'Test Quality Reviewer']);
    expect(manifest.skills.map((s) => s.name)).toEqual(['Edge Cases and Error Paths', 'breaking-change']);
  });

  it('sorts a copy, by name and then ID, and leaves the input order alone', () => {
    const rows = [{ id: 'b', name: 'x' }, { id: 'z', name: 'a' }, { id: 'a', name: 'x' }];
    expect(byNameThenId(rows).map((r) => r.id)).toEqual(['z', 'a', 'b']);
    expect(rows.map((r) => r.id)).toEqual(['b', 'z', 'a']);
  });

  it('refuses a name that matches no row or more than one, so row order cannot pick between duplicates', () => {
    const rows = [{ id: '1', name: 'breaking-change' }, { id: '2', name: 'breaking-change' }, { id: '3', name: 'other' }];
    expect(exactlyOne(rows, 'other', 'Skill').id).toBe('3');
    expect(() => exactlyOne(rows, 'breaking-change', 'Skill')).toThrow(/exactly one Skill named "breaking-change", found 2/);
    expect(() => exactlyOne(rows, 'missing', 'agent')).toThrow(/found 0/);
  });

  it('keeps the randomized schedule order exactly as built', async () => {
    const base = input();
    const manifest = await buildManifest(base);
    expect(manifest.schedule.slots.map((s) => s.slot_id)).toEqual(base.schedule.slots.map((s) => s.slot_id));
    const swapped = [...base.schedule.slots];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(await fingerprint(input({ schedule: { seed: 20261030, slots: swapped } }))).not.toBe(await fingerprint(base));
  });
});

describe('meaningful changes still invalidate the freeze', () => {
  const changes: Array<[string, (i: ManifestInput) => ManifestInput]> = [
    ['stack model', (i) => ({ ...i, stack: { ...i.stack, model: 'deepseek/deepseek-v4' } })],
    ['served model', (i) => ({ ...i, stack: { ...i.stack, servedModel: 'deepseek/deepseek-v4-flash-20260501' } })],
    ['provider', (i) => ({ ...i, stack: { ...i.stack, provider: 'deepinfra/bf16' } })],
    ['prices', (i) => ({ ...i, stack: { ...i.stack, prices: { input: 0.0000001, output: 0.00000018 } } })],
    ['database', (i) => ({ ...i, stack: { ...i.stack, database: 'devdigest_hw2f_other' } })],
    ['reviewer system prompt', (i) => ({ ...i, agents: [agent('a-2', 'API Contract Reviewer', 'changed'), i.agents[1]!] })],
    ['reviewer model', (i) => ({ ...i, agents: [{ ...i.agents[0]!, model: 'other/model' }, i.agents[1]!] })],
    ['Skill body', (i) => ({ ...i, skills: [skill('s-2', 'breaking-change', 'edited body'), i.skills[1]!] })],
    ['Skill approval revoked', (i) => ({ ...i, skills: [{ ...i.skills[0]!, approval: { status: 'revoked', approved_version: null } }, i.skills[1]!] })],
    ['Skill approval stale', (i) => ({ ...i, skills: [{ ...i.skills[0]!, approval: { status: 'stale', approved_version: 1 } }, i.skills[1]!] })],
    ['approved version', (i) => ({ ...i, skills: [{ ...i.skills[0]!, approval: { status: 'approved', approved_version: 2 } }, i.skills[1]!] })],
    ['non-Skill fingerprint', (i) => ({ ...i, nonSkillFingerprints: { ...i.nonSkillFingerprints, '18': 'other' } })],
    ['implementation', (i) => ({ ...i, implementationFingerprint: 'other' })],
    ['seed and schedule', (i) => ({ ...i, schedule: { seed: 7, slots: buildSchedule({ seed: 7, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }) } })],
    ['rules', (i) => ({ ...i, rules: { ...i.rules, '18': { ...i.rules['18']!, keywords: ['other'] } } })],
    ['reservation', (i) => ({ ...i, perSlotReservationUsd: 0.006 })],
    ['Skill switched off globally', (i) => ({ ...i, skills: [{ ...i.skills[0]!, enabled: false }, i.skills[1]!] })],
    ['reviewer provider', (i) => ({ ...i, agents: [{ ...i.agents[0]!, provider: 'openai' }, i.agents[1]!] })],
    ['reviewer output schema', (i) => ({ ...i, agents: [{ ...i.agents[0]!, output_schema: { type: 'object' } }, i.agents[1]!] })],
    ['reviewer disabled', (i) => ({ ...i, agents: [{ ...i.agents[0]!, enabled: false }, i.agents[1]!] })],
  ];
  it.each(changes)('%s', async (_name, change) => {
    expect(await fingerprint(change(input()))).not.toBe(await fingerprint(input()));
  });

  it('a fixture patch', async () => {
    const before = await fingerprint(input());
    const file = (EXPERIMENT_FIXTURES[1] as ExperimentFixture).files[0]!;
    const patch = file.patch;
    try {
      file.patch = `${patch}\n+// changed`;
      expect(await fingerprint(input())).not.toBe(before);
    } finally {
      file.patch = patch;
    }
    expect(await fingerprint(input())).toBe(before);
  });

  it('names the differing fields', async () => {
    const frozen = await buildManifest(input());
    const current = await buildManifest(input({ stack: { ...input().stack, model: 'x' }, perSlotReservationUsd: 0.006 }));
    expect(manifestDifferences(frozen, current)).toEqual(['per_slot_reservation_usd', 'stack']);
    expect(manifestDifferences(frozen, await buildManifest(input({ agents: [...input().agents].reverse() })))).toEqual([]);
  });
});

describe('the target Skill is checked again when the slots are built', () => {
  it('accepts the frozen Skill and names each later change', async () => {
    const frozen = await buildManifest(input());
    const live = input().skills[0]!;
    expect(frozenSkillProblems(frozen, live)).toEqual([]);
    expect(frozenSkillProblems(frozen, { ...live, body: 'edited' })).toEqual(['Skill "breaking-change" body changed since the freeze']);
    expect(frozenSkillProblems(frozen, { ...live, enabled: false })).toEqual(['Skill "breaking-change" enabled changed since the freeze']);
    expect(frozenSkillProblems(frozen, { ...live, approval: { status: 'revoked', approved_version: null } })).toEqual(['Skill "breaking-change" approval changed since the freeze']);
    expect(frozenSkillProblems(frozen, { ...live, name: 'unknown' })).toEqual(['Skill "unknown" is not in the pre-registration']);
  });
});

/** The path `authorize --phase confirmatory`, `run` and `prereg-check` share, on a real Git repository. */
describe('verifyPreregistration (real git)', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = () => {
    git('read-tree', '--empty');
    git('add', '-A');
    git('commit', '-q', '-m', 'prereg');
  };
  const file = 'docs/prereg/manifest.json';
  let frozen: Manifest;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'hw2-prereg-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    frozen = await buildManifest(input());
    // Exactly what `cli.ts manifest --out` writes.
    write(file, `${JSON.stringify(frozen, null, 2)}\n`);
    commit();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts the committed .json file when the stack builds the same manifest, whatever the row order', async () => {
    const result = await verifyPreregistration(join(root, file), root, async () => buildManifest(input({ agents: [...input().agents].reverse() })));
    expect(result.fingerprint).toBe(manifestFingerprint(frozen));
    expect(result.frozen.schedule.slots).toHaveLength(20);
  });

  it('accepts the same manifest in a Markdown json manifest block', async () => {
    write('docs/prereg/manifest.md', `# Pre-registration\n\n\`\`\`json manifest\n${JSON.stringify(frozen, null, 2)}\n\`\`\`\n`);
    commit();
    const result = await verifyPreregistration(join(root, 'docs/prereg/manifest.md'), root, async () => frozen);
    expect(result.fingerprint).toBe(manifestFingerprint(frozen));
  });

  it('refuses a manifest that no longer matches, naming the field', async () => {
    await expect(
      verifyPreregistration(join(root, file), root, async () => buildManifest(input({ stack: { ...input().stack, database: 'devdigest_hw2f_other' } }))),
    ).rejects.toThrow(/does not match the pre-registered manifest \(differs in: stack\)/);
  });

  it.each([
    ['malformed JSON', '{ "version": 3,', /is not valid JSON/],
    ['not an object', '[1, 2]\n', /does not hold a manifest object/],
    ['an older manifest version', `${JSON.stringify({ ...frozen, version: 2 })}\n`, /manifest version 2/],
  ])('refuses %s before building anything', async (_name, text, error) => {
    write(file, text);
    commit();
    let built = false;
    await expect(verifyPreregistration(join(root, file), root, async () => ((built = true), frozen))).rejects.toThrow(error);
    expect(built).toBe(false);
  });

  it('refuses a committed symlink, which would read an untracked file', async () => {
    write('docs/prereg/untracked-target.json', `${JSON.stringify(frozen)}\n`);
    symlinkSync('untracked-target.json', join(root, 'docs/prereg/link.json'));
    git('add', 'docs/prereg/link.json');
    git('commit', '-q', '-m', 'link');
    await expect(verifyPreregistration(join(root, 'docs/prereg/link.json'), root, async () => frozen)).rejects.toThrow(/is a symlink/);
  });

  it('refuses an uncommitted edit and an uncommitted file', async () => {
    write(file, `${JSON.stringify(frozen)}\n`);
    await expect(verifyPreregistration(join(root, file), root, async () => frozen)).rejects.toThrow(/uncommitted changes/);
    write('docs/prereg/new.json', `${JSON.stringify(frozen)}\n`);
    await expect(verifyPreregistration(join(root, 'docs/prereg/new.json'), root, async () => frozen)).rejects.toThrow(/not committed/);
  });
});

describe('authorize --phase confirmatory fails closed before any capability', () => {
  let home: string;
  const saved = process.env.HOME;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'hw2-authprereg-'));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });
  const base = ['authorize', '--phase', 'confirmatory', '--authorized-gate', '4', '--confirm-spend', '--budget', '0.1', '--ceiling', '0.2', '--stack', 'hw2f-prereg01', '--api', 'http://127.0.0.1:9', '--database', 'd', '--container', 'c'];

  it('without --prereg', async () => {
    await expect(main(base, () => {})).rejects.toThrow(/--prereg is required/);
    expect(existsSync(join(home, '.devdigest'))).toBe(false);
  });

  it('with a pre-registration that is not committed, before contacting the stack', async () => {
    await expect(main([...base, '--prereg', 'docs/homework/L02/prereg/does-not-exist.json'], () => {})).rejects.toThrow(/not committed/);
    expect(existsSync(join(home, '.devdigest'))).toBe(false);
  });
});

/** `authorize` with a stand-in stack: the comparison after the identity check guards the capability. */
describe('authorize (confirmatory) with a stand-in stack', () => {
  let root: string;
  let home: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const stack = { stackId: 'hw2f-standin1' } as Stack;
  const flags = { prereg: '', budget: '0.1', ceiling: '0.2', hours: '1' };
  const capabilityFile = () => join(home, '.devdigest', 'hw2-experiments', 'hw2f-standin1', 'capability.json');

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'hw2-authstand-'));
    home = mkdtempSync(join(tmpdir(), 'hw2-authhome-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(root, 'prereg'));
    writeFileSync(join(root, 'prereg', 'm.json'), `${JSON.stringify(await buildManifest(input()), null, 2)}\n`);
    writeFileSync(join(root, 'prereg', 'old.json'), `${JSON.stringify({ ...(await buildManifest(input())), version: 2 })}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'prereg');
    flags.prereg = join(root, 'prereg', 'm.json');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('writes no capability when the stack no longer builds the frozen manifest', async () => {
    const deps = { stack: async () => stack, verify: async () => Promise.reject(new Error('does not match the pre-registered manifest (differs in: agents)')), root, log: () => {}, home };
    await expect(authorize(flags, 'confirmatory', deps)).rejects.toThrow(/differs in: agents/);
    expect(existsSync(capabilityFile())).toBe(false);
  });

  it('refuses an older manifest version before contacting the stack', async () => {
    let contacted = false;
    const deps = { stack: async () => ((contacted = true), stack), verify: async () => ({ fingerprint: 'x' }), root, log: () => {}, home };
    await expect(authorize({ ...flags, prereg: join(root, 'prereg', 'old.json') }, 'confirmatory', deps)).rejects.toThrow(/manifest version 2/);
    expect(contacted).toBe(false);
    expect(existsSync(capabilityFile())).toBe(false);
  });

  it('writes the capability only after a matching comparison', async () => {
    const order: string[] = [];
    const deps = { stack: async () => (order.push('stack'), stack), verify: async () => (order.push('verify'), { fingerprint: 'f' }), root, log: (m: string) => order.push(m.split(':')[0]!), home };
    await authorize(flags, 'confirmatory', deps);
    expect(order.slice(0, 3)).toEqual(['stack', 'verify', 'pre-registration matches']);
    expect(existsSync(capabilityFile())).toBe(true);
  });
});
