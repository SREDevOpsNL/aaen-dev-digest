import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest, manifestFingerprint, type Manifest } from '../src/experiments/hw2/manifest.js';
import { buildSchedule } from '../src/experiments/hw2/schedule.js';
import { implementationFingerprint, preregisteredManifest } from '../src/experiments/hw2/source.js';

/**
 * Operator workflow (docs/plans/HW2-experiment-operator-guide.md, Gate 4): the
 * confirmatory manifest freezes the stack's disposable database identity, and
 * `scripts/e2e.sh --serve` creates a new one (`devdigest_hw2f_<nonce>`) on every
 * start. The manifest must therefore be generated, pre-registered and run on one
 * stack that is never restarted in between; a pre-registration-only commit on
 * that stack must keep it valid. Mirrors the `run` check in `cli.ts`:
 * `manifestFingerprint(current) !== manifestFingerprint(frozen)` refuses.
 */
describe('confirmatory manifest identity across stacks and the pre-registration commit (real git)', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  const prereg = 'docs/plans/HW2-experiment-preregistration.md';
  const preregWith = (manifest: unknown) => `# Pre-registration\n\n\`\`\`json manifest\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n`;

  /** The manifest `currentManifest` would build on a stack whose database is `database`. */
  const manifestOn = (database: string) =>
    buildManifest({
      implementationFingerprint: implementationFingerprint(root).sha256,
      nonSkillFingerprints: { '17': 'a'.repeat(64), '18': 'b'.repeat(64) },
      stack: {
        database,
        provider: 'example/fp8',
        providerName: 'Example',
        model: 'deepseek/deepseek-v4-flash',
        maxOutputTokens: 4000,
        prices: { input: 2.7e-7, output: 1.1e-6, request: 0 },
        generationLookup: { attempts: 5, delayMs: 1000 },
      },
      skills: [{ name: 'breaking-change', body: '# breaking-change\n' }],
      agents: [{ name: 'API Contract Reviewer', system_prompt: 'Review.', model: 'deepseek/deepseek-v4-flash', strategy: 'single-pass', repo_intel: false }],
      schedule: { seed: 20261020, slots: buildSchedule({ seed: 20261020, phase: 'confirmatory', experiments: ['17', '18'], trials: 5 }) },
      rules: { '18': { anchors: [{ file: 'src/api/payments.ts', start_line: 10, end_line: 12 }], keywords: ['breaking'] } },
      perSlotReservationUsd: 0.04,
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hw2-manifest-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    write('server/src/app.ts', 'export const a = 1;\n');
    write('reviewer-core/src/engine.ts', 'export const b = 2;\n');
    write('scripts/e2e.sh', '#!/usr/bin/env bash\n');
    write(prereg, '# template\n');
    commit('implementation');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('a pre-registration-only commit on the same stack keeps the manifest fingerprint', async () => {
    const stackE = 'devdigest_hw2f_0a1b2c3d';
    const frozen = await manifestOn(stackE);
    write(prereg, preregWith(frozen));
    commit('pre-register on stack E');

    const committed = preregisteredManifest<Manifest>(join(root, prereg), root);
    const current = await manifestOn(stackE); // recomputed by `run` on the same, still-running stack
    expect(manifestFingerprint(committed)).toBe(manifestFingerprint(frozen));
    expect(manifestFingerprint(current)).toBe(manifestFingerprint(committed));
  });

  it('a different disposable database identity (a restarted or new stack) changes the fingerprint', async () => {
    const frozen = await manifestOn('devdigest_hw2f_0a1b2c3d');
    write(prereg, preregWith(frozen));
    commit('pre-register on stack E');

    const committed = preregisteredManifest<Manifest>(join(root, prereg), root);
    const afterRestart = await manifestOn('devdigest_hw2f_9f8e7d6c'); // --serve picked a new nonce
    expect(manifestFingerprint(afterRestart)).not.toBe(manifestFingerprint(committed)); // `run` refuses, before any request
    expect(afterRestart.stack.database).not.toBe(committed.stack.database);
  });
});
