import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
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

const git = (root: string, args: string[], input?: string) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });

export function repoRoot(from = process.cwd()): string {
  return git(from, ['rev-parse', '--show-toplevel']).trim();
}

/**
 * `git status --porcelain` for `paths`, plus every committed file whose content
 * differs from HEAD. Status trusts the index's cached stat (whole seconds on
 * common builds), so a same-size rewrite in the second the file was last
 * indexed can look clean, notably on WSL2 whose wall clock jumps ahead for a
 * few milliseconds every few seconds. Re-hashing does not depend on the clock.
 */
function uncommittedChanges(root: string, paths: readonly string[]): string {
  const status = git(root, ['status', '--porcelain', '--', ...paths]).trim();
  if (status) return status;
  const blobs = git(root, ['ls-tree', '-r', '-z', 'HEAD', '--', ...paths])
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [meta, path] = entry.split('\t') as [string, string];
      const [mode, type, oid] = meta.split(' ') as [string, string, string];
      return { mode, type, oid, path };
    })
    // Symlinks would be followed by hash-object; status already covers them.
    .filter((entry) => entry.type === 'blob' && entry.mode !== '120000' && !entry.path.includes('\n'));
  if (blobs.length === 0) return '';
  const hashes = git(root, ['hash-object', '--stdin-paths'], blobs.map((entry) => `${entry.path}\n`).join('')).split('\n');
  return blobs
    .filter((entry, i) => hashes[i] !== entry.oid)
    .map((entry) => ` M ${entry.path}`)
    .join('\n');
}

/** sha256 over `mode type blob path` of every committed implementation file; refuses uncommitted changes. */
export function implementationFingerprint(root: string): { sha256: string; files: number } {
  const dirty = uncommittedChanges(root, IMPLEMENTATION_PATHS);
  if (dirty) throw new Error(`Uncommitted implementation changes; the running code would not match its fingerprint:\n${dirty}`);
  const entries = git(root, ['ls-tree', '-r', 'HEAD', '--', ...IMPLEMENTATION_PATHS])
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .sort();
  if (entries.length === 0) throw new Error('No implementation files found at HEAD');
  return { sha256: sha256(entries.join('\n')), files: entries.length };
}

/**
 * The manifest of a pre-registration that is committed and unmodified: the
 * whole file for a `.json` file (what `cli.ts manifest --out` writes),
 * otherwise its ```json manifest block.
 */
export function preregisteredManifest<T>(file: string, root: string): T {
  const path = relative(root, resolve(file));
  try {
    git(root, ['ls-files', '--error-unmatch', '--', path]);
  } catch {
    throw new Error(`${path} is not committed; commit the pre-registration before any confirmatory run`);
  }
  if (uncommittedChanges(root, [path])) {
    throw new Error(`${path} has uncommitted changes; commit the pre-registration before any confirmatory run`);
  }
  // A committed symlink would read whatever untracked file it points at.
  if (lstatSync(resolve(root, path)).isSymbolicLink()) throw new Error(`${path} is a symlink; commit the pre-registration itself`);
  const text = readFileSync(resolve(root, path), 'utf8');
  let json: string;
  if (path.endsWith('.json')) {
    json = text;
  } else {
    const match = /```json manifest\n([\s\S]*?)\n```/.exec(text);
    if (!match) throw new Error(`${path} has no \`\`\`json manifest block`);
    json = match[1]!;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`${path} does not hold a manifest object`);
  return manifest as T;
}
