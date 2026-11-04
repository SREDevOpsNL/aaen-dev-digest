import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCapability } from '../src/experiments/hw2/cli.js';

/**
 * `authorize` (writeCapability) enforces the capability rules on every path,
 * not only in the guide's X3 block: no replacement, no symlink, nothing beside
 * another stack's live capability, one authorize at a time.
 */
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function home() {
  const h = mkdtempSync(join(tmpdir(), 'hw2-authguard-'));
  homes.push(h);
  return h;
}
const dir = (h: string, s: string) => join(h, '.devdigest', 'hw2-experiments', s);
const auth = (h: string, stackId = 'hw2f-guard001') => writeCapability({ stackId, phase: 'exploration', budgetUsd: 0.01, hours: 1, home: h });

describe('writeCapability guard', () => {
  it('writes both files exclusively with mode 0600 and releases its lock', () => {
    const h = home();
    auth(h);
    for (const f of ['capability.json', 'capability.token']) expect(statSync(join(dir(h, 'hw2f-guard001'), f)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(h, '.devdigest', 'hw2-experiments', 'authorize.lock'))).toBe(false);
  });

  it('never replaces an existing capability', () => {
    const h = home();
    auth(h);
    const before = readFileSync(join(dir(h, 'hw2f-guard001'), 'capability.json'), 'utf8');
    expect(() => auth(h)).toThrow(/already exists/);
    expect(readFileSync(join(dir(h, 'hw2f-guard001'), 'capability.json'), 'utf8')).toBe(before);
  });

  it('refuses a symlinked capability path and writes nothing through it', () => {
    const h = home();
    mkdirSync(dir(h, 'hw2f-guard001'), { recursive: true });
    const target = join(h, 'elsewhere.json');
    symlinkSync(target, join(dir(h, 'hw2f-guard001'), 'capability.json'));
    expect(() => auth(h)).toThrow(/already exists \(or is a symlink\)/);
    expect(existsSync(target)).toBe(false);
    expect(lstatSync(join(dir(h, 'hw2f-guard001'), 'capability.json')).isSymbolicLink()).toBe(true);
  });

  it('refuses an old token that was not kept, and leaves no usable capability behind', () => {
    const h = home();
    mkdirSync(dir(h, 'hw2f-guard001'), { recursive: true });
    writeFileSync(join(dir(h, 'hw2f-guard001'), 'capability.token'), 'old');
    expect(() => auth(h)).toThrow(/keep the old token first/);
    expect(existsSync(join(dir(h, 'hw2f-guard001'), 'capability.json'))).toBe(false);
    expect(readFileSync(join(dir(h, 'hw2f-guard001'), 'capability.token'), 'utf8')).toBe('old');
  });

  it.each([['a file', false], ['a symlink', true]])("refuses while another stack holds a live capability (%s)", (_l, link) => {
    const h = home();
    mkdirSync(dir(h, 'hw2f-other01'), { recursive: true });
    if (link) symlinkSync('/nonexistent', join(dir(h, 'hw2f-other01'), 'capability.json'));
    else writeFileSync(join(dir(h, 'hw2f-other01'), 'capability.json'), '{}');
    expect(() => auth(h)).toThrow(/Another stack holds a live capability \(hw2f-other01\)/);
    expect(existsSync(join(dir(h, 'hw2f-guard001'), 'capability.json'))).toBe(false);
  });

  it('a kept token or a ledger on another stack does not block', () => {
    const h = home();
    mkdirSync(dir(h, 'hw2f-other01'), { recursive: true });
    writeFileSync(join(dir(h, 'hw2f-other01'), 'capability.token'), 'unkept old token of a closed stack');
    writeFileSync(join(dir(h, 'hw2f-other01'), 'ledger.jsonl'), '');
    expect(() => auth(h)).not.toThrow();
  });

  it('a leftover authorize.lock is refused, not stolen', () => {
    const h = home();
    mkdirSync(join(h, '.devdigest', 'hw2-experiments'), { recursive: true });
    writeFileSync(join(h, '.devdigest', 'hw2-experiments', 'authorize.lock'), '123\n');
    expect(() => auth(h)).toThrow(/Another authorize holds/);
    expect(existsSync(join(h, '.devdigest', 'hw2-experiments', 'authorize.lock'))).toBe(true);
  });

  it('two authorize processes on two stacks at once: exactly one capability exists afterwards', async () => {
    const h = home();
    const cli = fileURLToPath(new URL('../src/experiments/hw2/cli.ts', import.meta.url));
    const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
    const script = (s: string) => `import(${JSON.stringify(cli)}).then((m) => { try { m.writeCapability({ stackId: '${s}', phase: 'exploration', budgetUsd: 0.01, hours: 1, home: ${JSON.stringify(h)} }); console.log('ok'); } catch (e) { console.log('refused: ' + e.message); } })`;
    const go = (s: string) => new Promise<string>((done) => { let out = ''; const p = spawn(tsx, ['-e', script(s)], { env: { ...process.env } }); p.stdout.on('data', (d) => (out += d)); p.on('close', () => done(out.trim())); });
    const results = await Promise.all([go('hw2f-race0001'), go('hw2f-race0002')]);
    const live = ['hw2f-race0001', 'hw2f-race0002'].filter((s) => existsSync(join(dir(h, s), 'capability.json')));
    expect(live).toHaveLength(1);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.find((r) => r !== 'ok')).toMatch(/refused: (Another stack holds a live capability|Another authorize holds)/);
  }, 60_000);
});
