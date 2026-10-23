import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { spent } from '../src/experiments/hw2/budget.js';
import { Ledger, type LedgerEvent } from '../src/experiments/hw2/ledger.js';

/**
 * The operator guide's settlement and X3 first-use procedure, run verbatim:
 * - `docs/plans/hw2-settle.py`, the settlement script both procedures call;
 * - the guide's bash blocks, extracted from the Markdown and run in bash
 *   against synthetic stacks under a temporary HOME;
 * - ledgers written by the runner's own `Ledger`, a mock stack API, and a
 *   stub `pnpm`, so no capability is created and nothing is dispatched.
 *
 * The X and X2 ledgers below are the sealed Gate 3 ledgers' events.
 */
const run = promisify(execFile);
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SETTLE = join(REPO, 'docs', 'plans', 'hw2-settle.py');
const GUIDE = readFileSync(join(REPO, 'docs', 'plans', 'HW2-experiment-operator-guide.md'), 'utf8');
const BLOCKS = [...GUIDE.matchAll(/^```bash\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
const block = (marker: string) => {
  const found = BLOCKS.filter((b) => b.includes(marker));
  if (found.length !== 1) throw new Error(`expected one guide block with ${marker}, found ${found.length}`);
  return found[0]!;
};
const X3_VALUES = block('XS_MAX=0.10');
const X3_CHECK = block('xs_cross_stack_check() {');
const X3_AMOUNT = block('equals the next X3 capability');
const X3_LIFECYCLE = block('LOCK="$DIR/lifecycle.lock"');

const X = 'hw2f-f53ed971';
const X2 = 'hw2f-39febf41';
const X3 = 'hw2f-x3aaaa01';
const X_LEDGER = [
  '{"at":"2026-10-21T09:46:09.853Z","slot_id":"x-18-with-1","phase":"exploration","reservation_usd":0.01,"state":"reserved","detail":{"condition":"with","experiment":"18"}}',
  '{"at":"2026-10-21T09:46:09.924Z","slot_id":"x-18-with-1","phase":"exploration","reservation_usd":0.01,"state":"dispatched","run_id":"b111a514-113f-407a-bca9-23d1ebdd2878"}',
  '{"at":"2026-10-21T09:46:47.884Z","slot_id":"x-18-with-1","phase":"exploration","reservation_usd":0.01,"state":"completed","run_id":"b111a514-113f-407a-bca9-23d1ebdd2878","cost_usd":0.00022896}',
  '{"at":"2026-10-21T16:14:26.762Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"reserved","detail":{"condition":"without","experiment":"18"}}',
  '{"at":"2026-10-21T16:14:26.807Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"dispatched","run_id":"6fd06290-8e91-46b5-a57f-3fe695d6a867"}',
  '{"at":"2026-10-21T16:14:27.866Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"failed","run_id":"6fd06290-8e91-46b5-a57f-3fe695d6a867","cost_usd":null}',
];
const X2_LEDGER = [
  '{"at":"2026-10-22T21:30:13.974Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"reserved","detail":{"condition":"without","experiment":"18"}}',
  '{"at":"2026-10-22T21:30:14.015Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"dispatched","run_id":"11476cbf-527c-4c79-89e2-769774a5f8e6"}',
  '{"at":"2026-10-22T21:31:08.446Z","slot_id":"x-18-without-1","phase":"exploration","reservation_usd":0.01,"state":"completed","run_id":"11476cbf-527c-4c79-89e2-769774a5f8e6","cost_usd":0.00017892}',
  '{"at":"2026-10-22T21:53:36.747Z","slot_id":"x-17-with-1","phase":"exploration","reservation_usd":0.01,"state":"reserved","detail":{"condition":"with","experiment":"17"}}',
  '{"at":"2026-10-22T21:53:36.789Z","slot_id":"x-17-with-1","phase":"exploration","reservation_usd":0.01,"state":"dispatched","run_id":"79394d6b-8d45-4293-abe2-d4655f478eb6"}',
  '{"at":"2026-10-22T21:53:37.802Z","slot_id":"x-17-with-1","phase":"exploration","reservation_usd":0.01,"state":"failed","run_id":"79394d6b-8d45-4293-abe2-d4655f478eb6","cost_usd":null}',
];
const ev = (slot: string, state: string, extra: Record<string, unknown> = {}, phase = 'exploration', reservation = 0.01) =>
  JSON.stringify({ at: 't', slot_id: slot, phase, reservation_usd: reservation, state, ...extra });

let home = '';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  if (home) {
    chmodSync(home, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
  home = '';
});
/** A temporary HOME holding `ledgers` (lines written verbatim; null = the directory only); returns the experiments root. */
function stacks(ledgers: Record<string, string[] | null>) {
  home = mkdtempSync(join(tmpdir(), 'hw2-settle-home-'));
  const root = join(home, '.devdigest', 'hw2-experiments');
  mkdirSync(root, { recursive: true });
  for (const [stack, lines] of Object.entries(ledgers)) {
    mkdirSync(join(root, stack, 'clones'), { recursive: true }); // what `scripts/e2e.sh --serve` creates
    if (lines) writeFileSync(join(root, stack, 'ledger.jsonl'), `${lines.join('\n')}\n`);
  }
  return root;
}
/** Append events with the runner's own Ledger, as `run` does. */
function runnerAppend(root: string, stack: string, events: Array<Omit<LedgerEvent, 'at'>>) {
  const ledger = new Ledger(join(root, stack));
  ledger.acquire({ pid: process.pid, stackId: stack });
  try {
    for (const e of events) ledger.append(e);
  } finally {
    ledger.release();
  }
}
function settle(root: string, env: Record<string, string> = {}) {
  try {
    return { code: 0, out: execFileSync('python3', ['-I', SETTLE, root], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}
function oracle(root: string, names: string[]) {
  let exploration = 0;
  let confirmatory = 0;
  for (const stack of names) {
    const slots = [...new Ledger(join(root, stack)).slots().values()];
    exploration += spent(slots, 'exploration');
    confirmatory += spent(slots, 'confirmatory');
  }
  return { exploration, confirmatory };
}
const charged = (out: string) => {
  const m = /^charged: exploration \$([0-9.]+), confirmatory \$([0-9.]+), total \$([0-9.]+)$/m.exec(out);
  if (!m) throw new Error(`no charged line in:\n${out}`);
  return { exploration: Number(m[1]), confirmatory: Number(m[2]) };
};

/** A stand-in for X3's API: its identity, and the runs it holds per slot id. */
async function stackApi(runs: Record<string, string[]> = {}, identity: Record<string, unknown> = {}) {
  const server = createServer((req, res) => {
    const slot = /^\/experiments\/slots\/([^/?]+)$/.exec(req.url ?? '')?.[1];
    const body =
      req.url === '/experiments/identity'
        ? { stack_id: X3, database: `devdigest_hw2f_${X3.slice('hw2f-'.length)}`, in_flight_slot: null, ...identity }
        : slot !== undefined
          ? { runs: (runs[slot] ?? []).map((run_id) => ({ run_id })) }
          : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
/** The §3 variables for X3, the proposed X3 values (verbatim block), then `script`, in bash. */
async function x3(api: string, script: string, env: Record<string, string> = {}) {
  const prelude = [
    `ID=${X3}`,
    `API=${api}; DB="devdigest_hw2f_\${ID#hw2f-}"; LEDGER="$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl"; STACK=(--api "$API" --stack "$ID")`,
    X3_VALUES,
    // Stubs: `pnpm` records what it is asked to do; authorize writes a capability as cli.ts does.
    `pnpm() { echo "pnpm $*" >> "$HOME/pnpm.log"; if [[ " $* " == *" authorize "* ]]; then sleep "\${STUB_AUTHORIZE_DELAY:-0}"; printf '{"stack_id":"%s","phase":"exploration","gate":3,"budget_usd":%s,"expires_at":"2099-01-01T00:00:00Z"}' "$ID" "$AUTHORIZED_BUDGET" > "$HOME/.devdigest/hw2-experiments/$ID/capability.json"; fi; }`,
    `x2_endpoint_check() { [ -z "\${STUB_ENDPOINT_FAILS:-}" ]; }`,
    `x2_settings_check() { true; }`,
    'X2_EXPERIMENT=17; X2_CONDITION=with',
  ].join('\n');
  try {
    const { stdout, stderr } = await run('bash', ['-c', `${prelude}\n${script}`], { cwd: join(REPO, 'server'), env: { PATH: process.env.PATH ?? '', HOME: home, ...env } });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: `${e.stdout}${e.stderr}` };
  }
}
const pnpmLog = () => (existsSync(join(home, 'pnpm.log')) ? readFileSync(join(home, 'pnpm.log'), 'utf8') : '');

describe('settlement script (docs/plans/hw2-settle.py)', () => {
  it('the guide calls the shared script from both procedures', () => {
    expect(block('export SETTLE_EXPECT="$ID"')).toBeDefined();
    expect(BLOCKS.filter((b) => b.includes('docs/plans/hw2-settle.py')).length).toBe(2); // E recovery and X3's check
  });

  it('settles the real X and X2 ledgers: 0.01022896 + 0.01017892 = 0.02040788, as the runner does', () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    const { code, out } = settle(root);
    expect(code).toBe(0);
    expect(out).toContain(`stack ${X}: 2 slot(s), charged $0.01022896`);
    expect(out).toContain(`stack ${X2}: 2 slot(s), charged $0.01017892`);
    expect(out).toMatch(/^charged: exploration \$0\.02040788, confirmatory \$0, total \$0\.02040788$/m);
    expect(charged(out).exploration).toBeCloseTo(oracle(root, [X, X2]).exploration, 12);
    expect(out).toContain(`(${X}, x-18-without-1)`);
    expect(out).toContain(`(${X2}, x-18-without-1)`);
  });

  it('includes an additional exploration stack and a confirmatory stack, with every slot state', () => {
    const root = stacks({
      [X]: X_LEDGER,
      [X2]: X2_LEDGER,
      'hw2f-x3333333': [ev('x-17-with-1', 'reserved'), ev('x-17-with-1', 'failed', { cost_usd: null }), ev('x-17-without-1', 'completed', { cost_usd: 0.0003 })],
      'hw2f-eeee4444': [
        ev('c-17-with-1', 'completed', { cost_usd: 0.0005 }, 'confirmatory'),
        ev('c-18-without-1', 'refused', { cost_usd: 0 }, 'confirmatory'),
        ev('c-17-without-1', 'reserved', {}, 'confirmatory'),
        ev('c-18-with-1', 'dispatched', {}, 'confirmatory'),
        ev('c-18-without-2', 'ambiguous', { cost_usd: null }, 'confirmatory'),
      ],
    });
    const { code, out } = settle(root, { SETTLE_EXPECT: 'hw2f-x3333333 hw2f-eeee4444' });
    expect(code).toBe(0);
    const want = oracle(root, [X, X2, 'hw2f-x3333333', 'hw2f-eeee4444']);
    expect(charged(out).exploration).toBeCloseTo(want.exploration, 12);
    expect(charged(out).confirmatory).toBeCloseTo(0.0305, 12);
    expect(out).toMatch(/^refused: \(hw2f-eeee4444, c-18-without-1\)$/m);
    expect(out).not.toMatch(/never replay: .*c-18-without-1\)/);
  });

  it('keeps the first terminal state of a slot, as the runner does, and reports later events', () => {
    const root = stacks({ [X]: [...X_LEDGER, ev('x-18-without-1', 'completed', { cost_usd: 0.0001 })], [X2]: X2_LEDGER });
    const { code, out } = settle(root);
    expect(code).toBe(0);
    expect(out).toContain(`stack ${X}: 2 slot(s), charged $0.01022896`);
    expect(out).toContain('events after a slot\'s terminal state (ignored, as by the runner): 1');
  });

  it.each([
    ['7. a historical stack whose directory disappeared', () => stacks({ [X2]: X2_LEDGER }), {}, `${X}: ledger missing`],
    ['an expected stack that is missing', () => stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER }), { SETTLE_EXPECT: 'hw2f-x3333333' }, 'hw2f-x3333333: ledger missing'],
    ['9. a corrupt ledger line', () => stacks({ [X]: X_LEDGER, [X2]: [...X2_LEDGER, '{"slot_id": "x-17-with-1", "state": '] }), {}, `${X2}: line 7 is not a ledger event`],
    ['an event with an unknown state', () => stacks({ [X]: X_LEDGER, [X2]: [...X2_LEDGER, ev('x-17-with-2', 'pending')] }), {}, `${X2}: line 7 is not a ledger event`],
    ['a closed stack whose charge changed', () => stacks({ [X]: [...X_LEDGER, ev('x-17-with-1', 'reserved')], [X2]: X2_LEDGER }), {}, `${X}: charged $0.02022896, but closed at $0.01022896`],
    ['no ledger at all', () => stacks({}), {}, `${X}: ledger missing`],
    ['2. a stack listed as new that already has a ledger', () => stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: [ev('x-17-with-1', 'completed', { cost_usd: 0.0002 })] }), { SETTLE_NEW: X3 }, `${X3}: listed as new, but it already has a ledger`],
    ['6. a stack listed as new whose ledger was lost (a kept token remains)', () => {
      const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
      writeFileSync(join(root, X3, 'capability.token.revoked-20261101T000000Z'), 'x');
      return root;
    }, { SETTLE_NEW: X3 }, `${X3}: listed as new, but it has no ledger and capability.token.revoked-20261101T000000Z`],
    ['a stack listed as new without a stack directory', () => stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER }), { SETTLE_NEW: X3 }, `${X3}: listed as new, but its stack directory does not exist`],
    ['a closed stack listed as new', () => stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER }), { SETTLE_NEW: X }, `${X}: listed as new, but it is a pinned or expected stack`],
  ])('fails closed with %s', (_label, make, env, problem) => {
    const { code, out } = settle(make(), env as Record<string, string>);
    expect(code).toBe(1);
    expect(out).toContain('FAILED:');
    expect(out).toContain(problem);
    expect(out).not.toMatch(/^settled$/m);
  });

  it.skipIf(userInfo().uid === 0)('9. fails closed with an unreadable ledger', () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    chmodSync(join(root, X2, 'ledger.jsonl'), 0o000);
    const { code, out } = settle(root);
    expect(code).toBe(1);
    expect(out).toContain(`${X2}: ledger unreadable (PermissionError)`);
  });

  it('11. checks the key usage: known costs at least, plus unknown-cost reservations at most', () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    expect(settle(root, { SETTLE_KEY_USAGE: '0.00040788' }).code).toBe(0);
    for (const usage of ['0.0001', '0.03']) {
      const bad = settle(root, { SETTLE_KEY_USAGE: usage });
      expect(bad.code).toBe(1);
      expect(bad.out).toContain(`key usage $${usage} is outside [0.00040788, 0.02040788]`);
    }
  });

  it('refuses to size a next capability for an undeclared stack', () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = settle(root, { SETTLE_NEXT_STACK: X3, SETTLE_STACK_MAX: '0.10', SETTLE_ENVELOPE: '0.15', SETTLE_RESERVATION: '0.01' });
    expect(code).toBe(1);
    expect(out).toContain(`the next stack ${X3} is in neither SETTLE_EXPECT nor SETTLE_NEW`);
  });
});

describe('X3 first use and authorization (guide blocks, verbatim)', () => {
  const check = X3_CHECK;

  it('1. a fresh X3 (directory from --serve, no ledger, no run) gets a USD 0.01 first capability', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), check);
    expect(out).toContain(`${X3}: no ledger and no run on its server: first use`);
    expect(out).toContain(`stack ${X3}: new, no ledger yet, charged $0`);
    expect(out).toContain('next X3 capability: $0.01');
    expect(out).toContain('(stack maximum $0.10; exploration $0.03040788 of $0.15)');
    expect(code).toBe(0);
  });

  it('3. after one completed slot, the next capability is its cost plus a reservation', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    runnerAppend(root, X3, [
      { slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' },
      { slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'dispatched', run_id: 'r-1' },
      { slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'completed', run_id: 'r-1', cost_usd: 0.0004 },
    ]);
    const { code, out } = await x3(await stackApi({ 'x-17-with-1': ['r-1'] }), check);
    expect(out).toContain(`${X3}: ledger present`);
    expect(out).toContain('next X3 capability: $0.0104');
    expect(code).toBe(0);
  });

  it('4. after a failed unknown-cost slot, its full reservation stays charged', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    runnerAppend(root, X3, [
      { slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' },
      { slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'failed', run_id: 'r-1', cost_usd: null },
    ]);
    const { code, out } = await x3(await stackApi({ 'x-17-with-1': ['r-1'] }), check);
    expect(out).toContain('next X3 capability: $0.02');
    expect(code).toBe(0);
  });

  it('5. an unresolved (reserved or dispatched) X3 slot stops authorization: reconcile first', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    runnerAppend(root, X3, [{ slot_id: 'x-17-with-1', phase: 'exploration', reservation_usd: 0.01, state: 'reserved' }]);
    const { code, out } = await x3(await stackApi(), check);
    expect(code).toBe(1);
    expect(out).toContain(`${X3} has unresolved slots (${X3}, x-17-with-1): reconcile first`);
  });

  it('6. a lost ledger cannot pass as first use: the server still has runs', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi({ 'x-17-with-1': ['r-1'] }), check);
    expect(code).toBe(1);
    expect(out).toContain(`${X3} has no ledger, but its server has runs for x-17-with-1: the ledger may be lost`);
  });

  it('7. a missing historical ledger stops X3 too', async () => {
    stacks({ [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), check);
    expect(code).toBe(1);
    expect(out).toContain(`${X}: ledger missing`);
  });

  it('8. duplicate local slot ids across stacks stay apart', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    runnerAppend(root, X3, [{ slot_id: 'x-18-without-1', phase: 'exploration', reservation_usd: 0.01, state: 'completed', run_id: 'r-9', cost_usd: 0.0002 }]);
    const { code, out } = await x3(await stackApi({ 'x-18-without-1': ['r-9'] }), check);
    expect(code).toBe(0);
    for (const stack of [X, X2, X3]) expect(out).toContain(`(${stack}, x-18-without-1)`);
    expect(out).toContain('next X3 capability: $0.0102');
  });

  it('9. a corrupt X3 ledger stops authorization', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: ['{"slot_id": broken'] });
    const { code, out } = await x3(await stackApi(), check);
    expect(code).toBe(1);
    expect(out).toContain(`${X3}: line 1 is not a ledger event`);
  });

  it('10. an exhausted budget stops authorization', async () => {
    const full = Array.from({ length: 10 }, (_, i) => ev(`x-17-with-${i + 1}`, 'failed', { cost_usd: null, run_id: `r-${i}` }));
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: full });
    const runs = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`x-17-with-${i + 1}`, [`r-${i}`]]));
    const { code, out } = await x3(await stackApi(runs), check);
    expect(code).toBe(1);
    expect(out).toContain(`the next ${X3} slot does not fit: $0.11 of $0.10`);
  });

  it('11. key usage the ledgers do not explain stops authorization', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), check, { SETTLE_KEY_USAGE: '0.5' });
    expect(code).toBe(1);
    expect(out).toContain('key usage $0.5 is outside');
  });

  it('identity: the wrong stack, a slot in flight, or X2 as the target all stop it', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    expect((await x3(await stackApi({}, { stack_id: 'hw2f-other001' }), check)).out).toContain("serves 'hw2f-other001'");
    expect((await x3(await stackApi({}, { in_flight_slot: 'x-17-with-1' }), check)).out).toContain('is in flight');
    expect((await x3(await stackApi(), `ID=${X2}\n${check}`)).out).toContain("must be the new stack's own id");
  });

  it('the authorized amount must equal the computed capability', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const api = await stackApi();
    expect((await x3(api, `${check}\nAUTHORIZED_BUDGET=0.01\n${X3_AMOUNT}`)).out).toContain('authorized budget $0.01 equals the next X3 capability');
    const wrong = await x3(api, `${check}\nAUTHORIZED_BUDGET=0.02\n${X3_AMOUNT}`);
    expect(wrong.code).not.toBe(0);
    expect(wrong.out).toContain('FAILED: the authorization says 0.02, the next X3 capability is 0.01');
  });

  it('the guarded lifecycle authorizes once, runs once, revokes and releases its lock', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), `${check}\nAUTHORIZED_BUDGET=0.01\n${X3_LIFECYCLE}`);
    expect(code, out).toBe(0);
    const calls = pnpmLog().trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.01');
    expect(calls[1]).toContain('run --phase exploration --authorized-gate 3 --confirm-spend');
    expect(calls[1]).toContain('--count 1 --reservation 0.01');
    expect(out).toMatch(/capability revoked/);
    expect(existsSync(join(root, X3, 'capability.json'))).toBe(false);
    expect(existsSync(join(root, X3, 'lifecycle.lock'))).toBe(false);
  });

  it('a failed check after authorizing revokes, dispatches nothing, and releases the lock', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), `${check}\nAUTHORIZED_BUDGET=0.01\n${X3_LIFECYCLE}`, { STUB_ENDPOINT_FAILS: '1' });
    expect(code).toBe(1);
    expect(out).toContain('FAILED: endpoint check; nothing was dispatched');
    expect(pnpmLog()).not.toContain(' run ');
    expect(existsSync(join(root, X3, 'capability.json'))).toBe(false);
    expect(existsSync(join(root, X3, 'lifecycle.lock'))).toBe(false);
  });

  it('a wrong authorization amount authorizes nothing', async () => {
    stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const { code, out } = await x3(await stackApi(), `${check}\nAUTHORIZED_BUDGET=0.02\n${X3_LIFECYCLE}`);
    expect(code).toBe(1);
    expect(out).toContain('nothing was authorized');
    expect(pnpmLog()).toBe('');
  });

  it('12. two concurrent lifecycles on one stack: exactly one authorizes', async () => {
    const root = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, [X3]: null });
    const api = await stackApi();
    const script = `${check}\nAUTHORIZED_BUDGET=0.01\n${X3_LIFECYCLE}`;
    const [a, b] = await Promise.all([x3(api, script, { STUB_AUTHORIZE_DELAY: '1' }), x3(api, script, { STUB_AUTHORIZE_DELAY: '1' })]);
    const results = [a, b].sort((p, q) => p.code - q.code);
    expect(results.map((r) => r.code)).toEqual([0, 1]);
    expect(results[1]!.out).toContain('another lifecycle holds');
    expect(pnpmLog().match(/ authorize /g)).toHaveLength(1);
    expect(existsSync(join(root, X3, 'lifecycle.lock'))).toBe(false);
  }, 30_000);
});
