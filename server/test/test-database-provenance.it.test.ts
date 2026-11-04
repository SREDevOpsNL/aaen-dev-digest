import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * A disposable *name* is not provenance. In a test run, buildApp accepts an
 * injected db only when it is the testcontainers helper's marked database; a
 * second database on the same throwaway server, even with a disposable name,
 * is refused before the stale-run reaper could write to it.
 */
d('injected test databases need provenance (disposable container)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });
  const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  it('accepts the marked testcontainers database', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    await app.close();
  });

  it('refuses an unmarked database with a disposable name, and leaves its rows alone', async () => {
    await pg.handle.sql.unsafe('create database devdigest_e2e');
    const other = createDb(pg.url.replace(/\/devdigest_test(\?|$)/, '/devdigest_e2e$1'), { max: 1 });
    try {
      await other.db.execute(sql`create table agent_runs (id int primary key, status text not null)`);
      await other.db.execute(sql`insert into agent_runs values (1, 'running')`);
      await expect(buildApp({ config: config(), db: other.db })).rejects.toThrow(/database devdigest_e2e, no marker/);
      const rows = (await other.db.execute(sql`select status from agent_runs where id = 1`)) as unknown as Array<{ status: string }>;
      expect(rows[0]!.status).toBe('running'); // the reaper never ran
    } finally {
      await other.close();
    }
  });
});
