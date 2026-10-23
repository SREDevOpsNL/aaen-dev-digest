import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_API_HOST, loadConfig } from '../src/platform/config.js';

/**
 * An HW2 experiment stack must be reachable on loopback only: its runner calls
 * the API at 127.0.0.1, and nothing outside the host may drive the stack.
 * These tests read the kernel's listening sockets (`/proc/net/tcp*`, `ss`), not
 * the URLs the clients use. Hermetic: no Docker, no database (the boot-time
 * stale-run reaper fails against a closed port, which is non-fatal), no key.
 */
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = join(SERVER_ROOT, '..');
const CLOSED_DB = 'postgres://none:none@127.0.0.1:9/none';
const EXPERIMENT_ENV = {
  DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-loop0001',
  DEVDIGEST_EXPERIMENT_PROVIDER: 'example/fp8',
  DEVDIGEST_EXPERIMENT_MODEL: 'deepseek/deepseek-v4-flash',
  DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '4000',
  DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000009',
  DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000018',
};
const linux = process.platform === 'linux' && existsSync('/proc/net/tcp');

/** IPv4 and IPv6 addresses of every TCP socket listening on `port`, from the kernel's tables. */
function listenersOn(port: number): string[] {
  const out: string[] = [];
  for (const [file, v6] of [['/proc/net/tcp', false], ['/proc/net/tcp6', true]] as const) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
      const [, local, , state] = line.trim().split(/\s+/);
      if (!local || state !== '0A') continue; // 0A = LISTEN
      const [hex, portHex] = local.split(':') as [string, string];
      if (parseInt(portHex, 16) !== port) continue;
      out.push(v6 ? `[${hex}]` : (hex.match(/../g) ?? []).reverse().map((b) => parseInt(b, 16)).join('.'));
    }
  }
  return out.sort();
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** A local IPv4 address that is not loopback, if this host has one. */
function nonLoopbackIPv4(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list ?? []) if (nic.family === 'IPv4' && !nic.internal) return nic.address;
  }
  return null;
}

/** Whether a TCP connection to host:port is accepted. */
function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2_000 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

describe('API listen host', () => {
  it('keeps 0.0.0.0 outside experiment mode', () => {
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).apiHost).toBe('0.0.0.0');
  });

  it('is loopback only in experiment mode', () => {
    expect(EXPERIMENT_API_HOST).toBe('127.0.0.1');
    expect(loadConfig({ NODE_ENV: 'test', ...EXPERIMENT_ENV } as NodeJS.ProcessEnv).apiHost).toBe('127.0.0.1');
  });
});

describe.skipIf(!linux)('the real entrypoint (src/server.ts) binds the host it is given', () => {
  let child: ChildProcess | null = null;
  let home: string | null = null;
  afterEach(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child!.once('exit', done));
      child.kill('SIGINT');
      await exited;
    }
    child = null;
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  /** Starts `tsx src/server.ts` with no .env, a throwaway HOME and a closed database; resolves once /health answers. */
  async function start(extraEnv: Record<string, string>): Promise<number> {
    const port = await freePort();
    home = mkdtempSync(join(tmpdir(), 'hw2-loopback-home-'));
    const proc = spawn(join(SERVER_ROOT, 'node_modules', '.bin', 'tsx'), ['src/server.ts'], {
      cwd: SERVER_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        DOTENV_CONFIG_PATH: join(home, 'no.env'),
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: CLOSED_DB,
        API_PORT: String(port),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;
    let output = '';
    proc.stdout?.on('data', (d) => (output += d));
    proc.stderr?.on('data', (d) => (output += d));
    for (let i = 0; i < 150; i++) {
      if (proc.exitCode !== null) throw new Error(`server exited early (${proc.exitCode}): ${output}`);
      const up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
      if (up) return port;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error(`server never answered /health on 127.0.0.1:${port}: ${output}`);
  }

  it('experiment mode: the only listener is 127.0.0.1, and a non-loopback address is refused', async () => {
    const port = await start(EXPERIMENT_ENV);
    expect(listenersOn(port)).toEqual(['127.0.0.1']);
    const external = nonLoopbackIPv4();
    if (external) expect(await accepts(external, port)).toBe(false);
  }, 60_000);

  it('normal mode is unchanged: it listens on 0.0.0.0 (also shows the check sees a non-loopback bind)', async () => {
    const port = await start({});
    expect(listenersOn(port)).toEqual(['0.0.0.0']);
  }, 60_000);
});

/**
 * `scripts/e2e.sh --serve` binds the UI to loopback and refuses to serve unless
 * every listener on the API and web ports is 127.0.0.1. The check is extracted
 * verbatim from the script and run against real sockets.
 */
describe.skipIf(!linux)('scripts/e2e.sh --serve listeners', () => {
  const script = readFileSync(join(REPO_ROOT, 'scripts', 'e2e.sh'), 'utf8');
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  });

  const assertFn = (() => {
    const match = /^assert_loopback_listeners\(\) \{\n[\s\S]*?^\}\n/m.exec(script);
    if (!match) throw new Error('assert_loopback_listeners not found in scripts/e2e.sh');
    return match[0];
  })();
  const check = (...ports: number[]) => {
    try {
      return { code: 0, out: execFileSync('bash', ['-c', `${assertFn}\nassert_loopback_listeners "$@"`, 'check', ...ports.map(String)], { encoding: 'utf8' }) };
    } catch (err) {
      const e = err as { status: number; stdout: string };
      return { code: e.status, out: e.stdout };
    }
  };
  async function listen(host: string): Promise<number> {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, host, done));
    servers.push(server);
    return (server.address() as { port: number }).port;
  }

  it('passes only when every listener is 127.0.0.1', async () => {
    const a = await listen('127.0.0.1');
    const b = await listen('127.0.0.1');
    expect(check(a, b)).toEqual({ code: 0, out: '' });
  });

  it('fails for 0.0.0.0, for a dual-stack listener, and for a port with no listener', async () => {
    const loop = await listen('127.0.0.1');
    const any4 = await listen('0.0.0.0');
    const dual = await listen('::');
    const none = await freePort();
    const result = check(loop, any4, dual, none);
    expect(result.code).toBe(1);
    expect(result.out).toContain(`listener 0.0.0.0:${any4} is not loopback-only`);
    expect(result.out).toContain(`:${dual} is not loopback-only`);
    expect(result.out).toContain(`no listener on :${none}`);
    expect(result.out).not.toContain(`:${loop} `);
  });

  it('wires the UI host, the check and the loopback Postgres port into --serve', () => {
    expect(script).toContain('WEB_HOST_ARGS=(-H 127.0.0.1)');
    expect(script).toContain('pnpm exec next dev -p "$WEB_PORT" "${WEB_HOST_ARGS[@]}"');
    expect(script).toMatch(/assert_loopback_listeners "\$API_PORT" "\$WEB_PORT" \|\| \{[^}]*exit 1; \}\n\s*log "listeners on/);
    expect(script.indexOf('assert_loopback_listeners "$API_PORT"')).toBeLessThan(script.indexOf('HW2 experiment stack is up'));
    expect(script).toContain('-p "127.0.0.1:${PG_PORT}:5432"');
  });
});
