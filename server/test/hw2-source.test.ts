import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { implementationFingerprint, preregisteredManifest } from '../src/experiments/hw2/source.js';

/** A real Git repository: the pre-registration lifecycle must not depend on HEAD. */
describe('implementation fingerprint and pre-registration lifecycle (real git)', () => {
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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hw2-git-'));
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

  it('committing the pre-registration (a later HEAD) keeps the frozen fingerprint valid', () => {
    const frozen = implementationFingerprint(root);
    const headBefore = git('rev-parse', 'HEAD').trim();
    write(prereg, preregWith({ implementation_fingerprint: frozen.sha256 }));
    commit('pre-register');
    expect(git('rev-parse', 'HEAD').trim()).not.toBe(headBefore); // HEAD moved…
    expect(implementationFingerprint(root).sha256).toBe(frozen.sha256); // …the implementation did not
    expect(preregisteredManifest<{ implementation_fingerprint: string }>(join(root, prereg), root).implementation_fingerprint).toBe(frozen.sha256);

    // A later docs-only commit (e.g. the results report) changes nothing either.
    write('docs/plans/HW2-skills-experiments.md', '# results\n');
    commit('results');
    expect(implementationFingerprint(root).sha256).toBe(frozen.sha256);
  });

  it('a committed implementation change produces a different fingerprint (the manifest no longer matches)', () => {
    const frozen = implementationFingerprint(root).sha256;
    write('server/src/app.ts', 'export const a = 2;\n');
    commit('change the code');
    expect(implementationFingerprint(root).sha256).not.toBe(frozen);
    write('reviewer-core/src/engine.ts', 'export const b = 3;\n');
    commit('change the engine');
    write('scripts/e2e.sh', '#!/usr/bin/env bash\necho changed\n');
    commit('change the stack script');
    expect(new Set([frozen, implementationFingerprint(root).sha256]).size).toBe(2);
  });

  it('refuses uncommitted implementation changes, so the fingerprint always describes the running code', () => {
    write('server/src/app.ts', 'export const a = 99;\n');
    expect(() => implementationFingerprint(root)).toThrow(/Uncommitted implementation changes/);
    write('server/src/new-file.ts', 'export {};\n');
    expect(() => implementationFingerprint(root)).toThrow(/Uncommitted/);
  });

  it('accepts only a committed, unmodified pre-registration with a manifest block', () => {
    write(prereg, preregWith({ implementation_fingerprint: 'x' }));
    expect(() => preregisteredManifest(join(root, prereg), root)).toThrow(/uncommitted changes/);
    commit('pre-register');
    expect(preregisteredManifest(join(root, prereg), root)).toEqual({ implementation_fingerprint: 'x' });
    write('docs/plans/other.md', preregWith({}));
    expect(() => preregisteredManifest(join(root, 'docs/plans/other.md'), root)).toThrow(/not committed/);
    write(prereg, '# no manifest block\n');
    commit('drop the block');
    expect(() => preregisteredManifest(join(root, prereg), root)).toThrow(/no ```json manifest block/);
  });
});
