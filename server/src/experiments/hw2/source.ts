import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { sha256 } from '../../modules/_shared/experiment.js';

/**
 * The implementation the experiments run on, fingerprinted independently of
 * the pre-registration commit: the committed blob ids of these paths only. A
 * docs-only commit (such as committing the pre-registration itself) leaves it
 * unchanged; any committed change to the code, its lockfiles or the stack
 * script changes it.
 */
export const IMPLEMENTATION_PATHS = [
  'server/src',
  'server/package.json',
  'server/pnpm-lock.yaml',
  'reviewer-core/src',
  'reviewer-core/package.json',
  'reviewer-core/package-lock.json',
  'scripts/e2e.sh',
] as const;

const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function repoRoot(from = process.cwd()): string {
  return git(from, ['rev-parse', '--show-toplevel']).trim();
}

/** sha256 over `mode type blob path` of every committed implementation file; refuses uncommitted changes. */
export function implementationFingerprint(root: string): { sha256: string; files: number } {
  const dirty = git(root, ['status', '--porcelain', '--', ...IMPLEMENTATION_PATHS]).trim();
  if (dirty) throw new Error(`Uncommitted implementation changes; the running code would not match its fingerprint:\n${dirty}`);
  const entries = git(root, ['ls-tree', '-r', 'HEAD', '--', ...IMPLEMENTATION_PATHS])
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .sort();
  if (entries.length === 0) throw new Error('No implementation files found at HEAD');
  return { sha256: sha256(entries.join('\n')), files: entries.length };
}

/** The ```json manifest block of a pre-registration that is committed and unmodified. */
export function preregisteredManifest<T>(file: string, root: string): T {
  const path = relative(root, resolve(file));
  try {
    git(root, ['ls-files', '--error-unmatch', '--', path]);
  } catch {
    throw new Error(`${path} is not committed; commit the pre-registration before any confirmatory run`);
  }
  if (git(root, ['status', '--porcelain', '--', path]).trim()) {
    throw new Error(`${path} has uncommitted changes; commit the pre-registration before any confirmatory run`);
  }
  const match = /```json manifest\n([\s\S]*?)\n```/.exec(readFileSync(resolve(root, path), 'utf8'));
  if (!match) throw new Error(`${path} has no \`\`\`json manifest block`);
  return JSON.parse(match[1]!) as T;
}
