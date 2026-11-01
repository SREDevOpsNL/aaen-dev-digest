import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Explicit ownership of the child processes a test starts.
 *
 * Every child gets `HW2_TEST_OWNER=<uuid of this owner>` in its environment,
 * so anything it leaves behind (including a grandchild that inherited the
 * environment) can be found later through `/proc/<pid>/environ`.
 *
 * The rules:
 * - only a pid this owner spawned itself is ever signalled, and only while
 *   its `exit` has not been observed (so a reused pid is never hit);
 * - every wait for `exit` is bounded;
 * - `leftovers()` only reports; it never signals anything;
 * - a child gets a minimal environment (`CHILD_ENV_ALLOWLIST`), never the
 *   whole parent environment, so a child that prints its environment cannot
 *   put a developer's or CI's keys into test output. Extra variables are
 *   passed explicitly through `opts.env`;
 * - output quoted in an error message is cut to its last `ERROR_OUTPUT_BYTES`.
 *
 * No `pkill`, no pattern matching on command lines.
 */
export const OWNER_ENV = 'HW2_TEST_OWNER';

/** The server package root: `--import tsx` and the tsconfig path aliases resolve from here. */
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const DEFAULT_EXIT_TIMEOUT_MS = 5_000;

/**
 * The only parent variables a child inherits by default (each copied only if
 * set). None of them is required for correctness: the crash-recovery tests
 * passed 4/4 with an empty environment, but took about 12 s instead of about
 * 4 s. These keep that runtime: PATH for binaries, HOME and TMPDIR for tsx's
 * cache, and NODE_OPTIONS so a deliberate node flag still applies. None of
 * them holds a secret.
 */
export const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS'] as const;

/** How much of a child's output an error message quotes (the end, where the failure usually is). */
export const ERROR_OUTPUT_BYTES = 2_048;

/** The allowlisted subset of `from`. */
export function minimalEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) if (from[key] !== undefined) env[key] = from[key];
  return env;
}

/** The last `ERROR_OUTPUT_BYTES` of `out`, marked when cut. */
export function boundedOutput(out: string): string {
  const buf = Buffer.from(out, 'utf8');
  if (buf.length <= ERROR_OUTPUT_BYTES) return out;
  return `[…${buf.length - ERROR_OUTPUT_BYTES} bytes cut] ${buf.subarray(buf.length - ERROR_OUTPUT_BYTES).toString('utf8')}`;
}

export interface ExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface OwnedChild {
  readonly proc: ChildProcess;
  readonly pid: number | undefined;
  /** Settles once, on the child's `exit` event (or with code null if it failed to spawn). */
  readonly exited: Promise<ExitStatus>;
  hasExited(): boolean;
  /** Everything the child wrote to stdout and stderr so far. */
  output(): string;
  /**
   * Resolves with the output once it contains `text`. Rejects when the child
   * exits first (a partial startup failure) or when `timeoutMs` passes.
   */
  ready(text: string, timeoutMs?: number): Promise<string>;
  /**
   * Sends `signal` (default SIGKILL) unless the child has already exited, and
   * waits for `exit` at most `timeoutMs`; throws if it does not come.
   */
  kill(signal?: NodeJS.Signals, timeoutMs?: number): Promise<ExitStatus>;
}

export interface SpawnOptions {
  /** Variables added to the minimal environment, explicitly, by the caller. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Aborting it kills the child with SIGKILL (parent-side cancellation). */
  signal?: AbortSignal;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message())), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Pids of live processes whose environment carries `HW2_TEST_OWNER=<marker>`. [] where /proc cannot be read. */
export function leftovers(marker: string): number[] {
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return []; // not Linux, or /proc not mounted: nothing to scan
  }
  const needle = `${OWNER_ENV}=${marker}`;
  const found: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let environ: string;
    try {
      environ = readFileSync(`/proc/${entry}/environ`, 'utf8');
    } catch {
      continue; // gone meanwhile, or another user's process
    }
    // A zombie's environ reads as empty, so only live processes match.
    if (environ.split('\0').includes(needle)) found.push(Number(entry));
  }
  return found;
}

/** Whether `leftovers()` can see anything on this host. */
export function canScanProcesses(): boolean {
  try {
    readFileSync(`/proc/${process.pid}/environ`);
    return true;
  } catch {
    return false;
  }
}

export class ProcessOwner {
  readonly marker = randomUUID();
  private readonly children: OwnedChild[] = [];

  spawn(command: string, args: string[], opts: SpawnOptions = {}): OwnedChild {
    let out = '';
    const proc = spawn(command, args, {
      cwd: opts.cwd ?? SERVER_ROOT,
      env: { ...minimalEnv(), ...opts.env, [OWNER_ENV]: this.marker },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const exited = new Promise<ExitStatus>((resolve) => {
      proc.once('exit', (code, signal) => {
        done = true;
        resolve({ code, signal });
      });
      // A failed spawn (ENOENT, …) emits `error` and possibly no `exit`.
      proc.on('error', () => {
        if (proc.pid === undefined) {
          done = true;
          resolve({ code: null, signal: null });
        }
      });
    });
    proc.stdout!.on('data', (d) => (out += d));
    proc.stderr!.on('data', (d) => (out += d));

    const hasExited = () => done || proc.exitCode !== null || proc.signalCode !== null;
    const kill = async (signal: NodeJS.Signals = 'SIGKILL', timeoutMs = DEFAULT_EXIT_TIMEOUT_MS) => {
      if (!hasExited()) proc.kill(signal); // only this owner's own child, only while it is alive
      return withTimeout(exited, timeoutMs, () => `child ${proc.pid} did not exit within ${timeoutMs} ms of ${signal}`);
    };

    if (opts.signal) {
      const onAbort = () => void kill('SIGKILL').catch(() => {});
      if (opts.signal.aborted) onAbort();
      else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        void exited.then(() => opts.signal!.removeEventListener('abort', onAbort));
      }
    }

    const ready = (text: string, timeoutMs = 20_000) =>
      withTimeout(
        new Promise<string>((resolve, reject) => {
          const check = () => {
            if (out.includes(text)) resolve(out);
          };
          proc.stdout!.on('data', check);
          proc.stderr!.on('data', check);
          check();
          void exited.then(({ code, signal }) =>
            out.includes(text)
              ? resolve(out)
              : reject(new Error(`child exited (code ${code}, signal ${signal}) before "${text}": ${boundedOutput(out)}`)),
          );
        }),
        timeoutMs,
        () => `child ${proc.pid} printed no "${text}" within ${timeoutMs} ms: ${boundedOutput(out)}`,
      );

    const child: OwnedChild = { proc, pid: proc.pid, exited, hasExited, output: () => out, ready, kill };
    this.children.push(child);
    return child;
  }

  /** One process running `script` under tsx's loader: a SIGKILL lands on the process doing the work. */
  spawnTsx(script: string, opts: SpawnOptions = {}): OwnedChild {
    return this.spawn(process.execPath, ['--import', 'tsx', '-e', script], opts);
  }

  /**
   * SIGKILL every tracked child that has not exited and wait (bounded) for
   * each exit. Safe to call repeatedly, in `afterEach` or a `finally`. Every
   * child is attempted before an error is thrown.
   */
  async cleanupAll(timeoutMs = DEFAULT_EXIT_TIMEOUT_MS): Promise<void> {
    const results = await Promise.allSettled(this.children.splice(0).map((c) => c.kill('SIGKILL', timeoutMs)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((f) => f.reason), `${failures.length} owned child(ren) did not exit`);
  }

  /** Live processes carrying this owner's marker. Reports only. */
  leftovers(): number[] {
    return leftovers(this.marker);
  }

  /**
   * Polls `leftovers()` until it is empty or `timeoutMs` passes, and returns
   * what is left. Gives a grandchild that exits on its own (for example a
   * tool service that stops when its parent's pipe closes) a bounded moment
   * to go. Reports only.
   */
  async settledLeftovers(timeoutMs = 3_000): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = this.leftovers();
      if (left.length === 0 || Date.now() >= deadline) return left;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
