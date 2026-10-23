import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spent } from '../src/experiments/hw2/budget.js';
import { Ledger } from '../src/experiments/hw2/ledger.js';

/**
 * The offline settlement of the operator guide ("If stack E stops
 * unexpectedly", step 3), run verbatim: the test extracts the guide's Python
 * block and runs it against ledgers in a temporary directory. The guide is the
 * procedure an operator follows, so it is what is tested. The X and X2
 * ledgers below are the sealed Gate 3 ledgers' events.
 */
const GUIDE = fileURLToPath(new URL('../../docs/plans/HW2-experiment-operator-guide.md', import.meta.url));
const SCRIPT = (() => {
  const blocks = [...readFileSync(GUIDE, 'utf8').matchAll(/^```bash\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
  const settle = blocks.filter((b) => b.includes('PINNED = {'));
  if (settle.length !== 1) throw new Error(`expected one settlement block in the guide, found ${settle.length}`);
  return settle[0]!.split("<<'EOF'\n")[1]!.split('\nEOF\n')[0]!;
})();

const X = 'hw2f-f53ed971';
const X2 = 'hw2f-39febf41';
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

let root: string;
afterEach(() => {
  if (root) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
function stacks(ledgers: Record<string, string[] | string>) {
  root = mkdtempSync(join(tmpdir(), 'hw2-settle-'));
  for (const [stack, lines] of Object.entries(ledgers)) {
    mkdirSync(join(root, stack));
    writeFileSync(join(root, stack, 'ledger.jsonl'), Array.isArray(lines) ? `${lines.join('\n')}\n` : lines);
  }
  return root;
}
function settle(dir: string, env: Record<string, string> = {}) {
  try {
    return { code: 0, out: execFileSync('python3', ['-I', '-', dir], { input: SCRIPT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}
/** The runner's own fold and charge rule, one Ledger per stack directory: the oracle. */
function oracle(dir: string, names: string[]) {
  let exploration = 0;
  let confirmatory = 0;
  for (const stack of names) {
    const slots = [...new Ledger(join(dir, stack)).slots().values()];
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

describe('offline settlement (operator guide, run verbatim)', () => {
  it('settles the real X and X2 ledgers: 0.01022896 + 0.01017892 = 0.02040788, as the runner does', () => {
    const dir = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    const { code, out } = settle(dir);
    expect(code).toBe(0);
    expect(out).toContain(`stack ${X}: 2 slot(s), charged $0.01022896`);
    expect(out).toContain(`stack ${X2}: 2 slot(s), charged $0.01017892`);
    expect(out).toMatch(/^charged: exploration \$0\.02040788, confirmatory \$0, total \$0\.02040788$/m);
    expect(charged(out).exploration).toBeCloseTo(oracle(dir, [X, X2]).exploration, 12);
    // duplicate local slot ids stay apart
    expect(out).toContain(`(${X}, x-18-without-1)`);
    expect(out).toContain(`(${X2}, x-18-without-1)`);
    expect(out).toMatch(/^settled$/m);
  });

  it('includes an additional exploration stack and a confirmatory stack automatically, with every slot state', () => {
    const dir = stacks({
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
    const { code, out } = settle(dir, { SETTLE_EXPECT: 'hw2f-x3333333 hw2f-eeee4444' });
    expect(code).toBe(0);
    const want = oracle(dir, [X, X2, 'hw2f-x3333333', 'hw2f-eeee4444']);
    expect(charged(out).exploration).toBeCloseTo(want.exploration, 12);
    expect(charged(out).confirmatory).toBeCloseTo(want.confirmatory, 12);
    expect(charged(out).confirmatory).toBeCloseTo(0.0305, 12); // 0.0005 + 0 + 3 × 0.01 unresolved or ambiguous
    expect(out).toMatch(/^refused: \(hw2f-eeee4444, c-18-without-1\)$/m);
    expect(out).toMatch(/never replay: .*\(hw2f-eeee4444, c-17-without-1\)/);
    expect(out).not.toMatch(/never replay: .*c-18-without-1\)/);
  });

  it('keeps the first terminal state of a slot, as the runner does, and reports later events', () => {
    const dir = stacks({ [X]: [...X_LEDGER, ev('x-18-without-1', 'completed', { cost_usd: 0.0001 })], [X2]: X2_LEDGER });
    const { code, out } = settle(dir);
    expect(code).toBe(0);
    expect(out).toContain(`stack ${X}: 2 slot(s), charged $0.01022896`);
    expect(out).toContain('events after a slot\'s terminal state (ignored, as by the runner): 1');
    expect(charged(out).exploration).toBeCloseTo(oracle(dir, [X, X2]).exploration, 12);
  });

  it.each([
    ['a closed stack whose directory disappeared', () => stacks({ [X2]: X2_LEDGER }), {}, `${X}: ledger missing`],
    ['an expected open stack that is missing', () => stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER }), { SETTLE_EXPECT: 'hw2f-x3333333' }, 'hw2f-x3333333: ledger missing'],
    ['a corrupt ledger line', () => stacks({ [X]: X_LEDGER, [X2]: [...X2_LEDGER, '{"slot_id": "x-17-with-1", "state": '] }), {}, `${X2}: line 7 is not a ledger event`],
    ['an event with an unknown state', () => stacks({ [X]: X_LEDGER, [X2]: [...X2_LEDGER, ev('x-17-with-2', 'pending')] }), {}, `${X2}: line 7 is not a ledger event`],
    ['a closed stack whose charge changed', () => stacks({ [X]: [...X_LEDGER, ev('x-17-with-1', 'reserved')], [X2]: X2_LEDGER }), {}, `${X}: charged $0.02022896, but closed at $0.01022896`],
    ['no ledger at all', () => stacks({}), {}, `${X}: ledger missing`],
  ])('fails closed with %s', (_label, make, env, problem) => {
    const { code, out } = settle(make(), env as Record<string, string>);
    expect(code).toBe(1);
    expect(out).toContain('FAILED:');
    expect(out).toContain(problem);
    expect(out).not.toMatch(/^settled$/m);
  });

  it.skipIf(userInfo().uid === 0)('fails closed with an unreadable ledger', () => {
    const dir = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    chmodSync(join(dir, X2, 'ledger.jsonl'), 0o000);
    const { code, out } = settle(dir);
    expect(code).toBe(1);
    expect(out).toContain(`${X2}: ledger unreadable (PermissionError)`);
  });

  it('checks the key usage against the ledgers: known costs at least, plus unknown-cost reservations at most', () => {
    const dir = stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER });
    const ok = settle(dir, { SETTLE_KEY_USAGE: '0.00040788' });
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('known costs $0.00040788, unknown-cost reservations $0.02');
    for (const usage of ['0.0001', '0.03']) {
      const bad = settle(dir, { SETTLE_KEY_USAGE: usage });
      expect(bad.code).toBe(1);
      expect(bad.out).toContain(`key usage $${usage} is outside [0.00040788, 0.02040788]`);
    }
  });

  it('sizes the next capability of a further stack and refuses one that does not fit', () => {
    const limits = { SETTLE_STACK_MAX: '0.10', SETTLE_ENVELOPE: '0.15', SETTLE_RESERVATION: '0.01' };
    const fresh = settle(stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, 'hw2f-x3333333': '' }), { SETTLE_EXPECT: 'hw2f-x3333333', SETTLE_NEXT_STACK: 'hw2f-x3333333', ...limits });
    expect(fresh.code).toBe(0);
    expect(fresh.out).toContain('next capability for hw2f-x3333333: $0.01 (stack maximum $0.10; exploration $0.03040788 of $0.15)');
    const full = Array.from({ length: 10 }, (_, i) => ev(`x-17-with-${i + 1}`, 'failed', { cost_usd: null }));
    const atMax = settle(stacks({ [X]: X_LEDGER, [X2]: X2_LEDGER, 'hw2f-x3333333': full }), { SETTLE_EXPECT: 'hw2f-x3333333', SETTLE_NEXT_STACK: 'hw2f-x3333333', ...limits });
    expect(atMax.code).toBe(1);
    expect(atMax.out).toContain('the next hw2f-x3333333 slot does not fit: $0.11 of $0.10');
  });
});
