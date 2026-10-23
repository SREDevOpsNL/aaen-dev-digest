import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import { assertInjectedTestDatabase, assertTestDatabaseIsolated, databaseNameOf } from '../src/db/disposable.js';
import { createDb } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import { SECRET_ENV_KEYS, TEST_DATABASE_URL } from './setup/isolate-database.js';

/**
 * The app's boot reaper (`UPDATE agent_runs SET status = 'failed' WHERE status
 * = 'running'`) writes to whatever database `databaseUrl` names. Before this
 * guard, a test that booted the app without an injected `db` reached
 * `server/.env`'s database, or the default `localhost:5432/devdigest`: the
 * development database. These tests never touch a real database; a decoy TCP
 * listener counts connection attempts and drops them.
 */
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = join(SERVER_ROOT, 'node_modules', '.bin', 'tsx');

type Decoy = { port: number; connections: () => number; close: () => Promise<void> };
const decoys: Decoy[] = [];
async function decoy(): Promise<Decoy> {
  let count = 0;
  const server: Server = createServer((socket) => {
    count++;
    socket.destroy();
    // Stop listening: the client's retries are then refused, so a connection
    // attempt fails fast instead of keeping the boot reaper waiting.
    server.close();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const d = {
    port: (server.address() as { port: number }).port,
    connections: () => count,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
  decoys.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(decoys.splice(0).map((d) => d.close()));
});
const url = (port: number, name: string) => `postgres://devdigest:devdigest@127.0.0.1:${port}/${name}`;

describe('test runs are isolated from the development database', () => {
  it('the setup file gives every test a closed, disposable DATABASE_URL and no .env', () => {
    expect(process.env.DATABASE_URL).toBe(TEST_DATABASE_URL);
    expect(process.env.DOTENV_CONFIG_PATH).toBe('/dev/null');
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(databaseNameOf(config.databaseUrl)).toBe('devdigest_test');
    expect(new URL(config.databaseUrl).port).toBe('9');
    // Secrets: a test-owned empty file, and nothing from the developer's shell.
    expect(config.secretsPath).toBe(process.env.DEVDIGEST_TEST_SECRETS_PATH);
    expect(config.secretsPath).toMatch(/devdigest-test-secrets-/);
    for (const key of SECRET_ENV_KEYS) expect(process.env[key]).toBeUndefined();
  });

  it('server/.env is not read under test (and would be read without the setup)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-dotenv-'));
    try {
      writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://u:p@127.0.0.1:1/decoy_from_dotenv\n');
      const script = `import(${JSON.stringify(join(SERVER_ROOT, 'src', 'platform', 'config.ts'))}).then((m) => console.log(m.loadConfig().databaseUrl))`;
      const { DATABASE_URL: _unset, DOTENV_CONFIG_PATH: _path, ...base } = process.env;
      const read = (env: NodeJS.ProcessEnv) => execFileSync(TSX, ['-e', script], { cwd: dir, env, encoding: 'utf8' }).trim();
      expect(read({ ...base, DOTENV_CONFIG_PATH: '/dev/null' })).not.toContain('decoy_from_dotenv');
      expect(read(base)).toContain('decoy_from_dotenv'); // control: dotenv would have loaded it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('in a test run, buildApp refuses the development database before connecting', async () => {
    const d = await decoy();
    // A disposable-looking name is not enough: a development server may hold a database of that name.
    for (const name of ['devdigest', 'postgres', 'devdigest_prod', 'devdigest_test', 'devdigest_e2e']) {
      const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url(d.port, name) } as NodeJS.ProcessEnv);
      await expect(buildApp({ config })).rejects.toThrow(/may only use the closed test URL/);
    }
    expect(d.connections()).toBe(0);
    // The default URL (no DATABASE_URL at all) is the development database too.
    // Checked without buildApp, so that no regression of the guard can ever
    // connect to it.
    expect(() => assertTestDatabaseIsolated(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), {})).toThrow(/named devdigest\b/);
  });

  it('a config that does not say "test" is still refused under vitest', async () => {
    const d = await decoy();
    const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: url(d.port, 'devdigest') } as NodeJS.ProcessEnv);
    await expect(buildApp({ config })).rejects.toThrow(/closed test URL/);
    expect(d.connections()).toBe(0);
  });

  it('the closed test URL is allowed: the reaper fails fast and non-fatally', async () => {
    const app = await buildApp({ config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv) });
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('an injected db that cannot prove it is a marked test database is refused before anything writes', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    await expect(buildApp({ config, db: {} as Db })).rejects.toThrow(/could not be verified/);
    // A real client to an unreachable server (the decoy): refused, and only the read-only check was attempted.
    const d = await decoy();
    const handle = createDb(url(d.port, 'devdigest'), { max: 1 });
    try {
      await expect(buildApp({ config, db: handle.db })).rejects.toThrow(/not a marked disposable test database/);
    } finally {
      await handle.close();
    }
    // Answers that are not a marked disposable database.
    const answering = (rows: unknown[]) => ({ execute: async () => rows }) as unknown as Db;
    await expect(assertInjectedTestDatabase(answering([{ name: 'devdigest', marked: true }]), { nodeEnv: 'test' })).rejects.toThrow(/database devdigest/);
    await expect(assertInjectedTestDatabase(answering([{ name: 'devdigest_test', marked: false }]), { nodeEnv: 'test' })).rejects.toThrow(/no marker/);
    await expect(assertInjectedTestDatabase(answering([{ name: 'devdigest_test', marked: true }]), { nodeEnv: 'test' })).resolves.toBeUndefined();
    await expect(assertInjectedTestDatabase(answering([]), { nodeEnv: 'development' }, {})).resolves.toBeUndefined(); // outside tests: nothing
  });

  it('an environment change after the setup cannot reintroduce the development database', async () => {
    const previous = process.env.DATABASE_URL;
    const d = await decoy();
    process.env.DATABASE_URL = url(d.port, 'devdigest_test');
    try {
      await expect(buildApp({ config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv) })).rejects.toThrow(/closed test URL/);
      expect(d.connections()).toBe(0);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('secrets: the real key files outside test runs, never in a test run', () => {
    const home = mkdtempSync(join(tmpdir(), 'devdigest-secrets-home-'));
    try {
      const script = `import(${JSON.stringify(join(SERVER_ROOT, 'src', 'platform', 'config.ts'))}).then((m) => console.log(m.loadConfig().secretsPath))`;
      const experiment = { DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-sec00001', DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra/fp8', DEVDIGEST_EXPERIMENT_MODEL: 'm', DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '100', DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.1', DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.1' };
      // No VITEST, development mode: production behaviour.
      const read = (env: Record<string, string>) => execFileSync(TSX, ['-e', script], { cwd: home, env: { PATH: process.env.PATH ?? '', HOME: home, DOTENV_CONFIG_PATH: '/dev/null', ...env }, encoding: 'utf8' }).trim();
      expect(read({ NODE_ENV: 'development' })).toBe(join(home, '.devdigest', 'secrets.json'));
      expect(read({ NODE_ENV: 'development', ...experiment })).toBe(join(home, '.devdigest', 'hw2-experiments', 'secrets.json'));
      expect(read({ NODE_ENV: 'development', DEVDIGEST_TEST_SECRETS_PATH: '/tmp/x' })).toBe(join(home, '.devdigest', 'secrets.json')); // ignored outside tests
      // In a test run: the test-owned file, or nothing.
      expect(read({ NODE_ENV: 'test', DEVDIGEST_TEST_SECRETS_PATH: '/tmp/x', ...experiment })).toBe('/tmp/x');
      expect(read({ NODE_ENV: 'test', ...experiment })).toBe('/dev/null');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('outside tests the check does nothing', () => {
    for (const nodeEnv of ['development', 'production']) {
      expect(() => assertTestDatabaseIsolated({ nodeEnv, databaseUrl: 'postgres://u:p@localhost:5432/devdigest' }, {})).not.toThrow();
    }
    expect(() => assertTestDatabaseIsolated({ nodeEnv: 'test', databaseUrl: 'not a url' }, {})).toThrow(/unreadable URL/);
  });

  it('normal startup is unchanged: the real entrypoint in development mode boots and runs its stale-run recovery', async () => {
    const d = await decoy();
    const port = await new Promise<number>((done) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => done(p));
      });
    });
    const home = mkdtempSync(join(tmpdir(), 'devdigest-dev-home-'));
    const proc = spawn(TSX, ['src/server.ts'], {
      cwd: SERVER_ROOT,
      // No VITEST, no NODE_ENV=test: an ordinary development start against a non-disposable database name.
      env: { PATH: process.env.PATH ?? '', HOME: home, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'development', LOG_LEVEL: 'silent', DATABASE_URL: url(d.port, 'devdigest'), API_PORT: String(port) },
      stdio: 'ignore',
    });
    try {
      let up = false;
      for (let i = 0; i < 150 && !up; i++) {
        if (proc.exitCode !== null) throw new Error(`server exited early (${proc.exitCode})`);
        up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
        if (!up) await new Promise((done) => setTimeout(done, 200));
      }
      expect(up).toBe(true);
      expect(d.connections()).toBeGreaterThan(0); // the reaper tried its (decoy) database
    } finally {
      const exited = new Promise((done) => proc.once('exit', done));
      proc.kill('SIGINT');
      await exited;
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
