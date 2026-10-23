import { ne, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * Names of databases that exist only to be thrown away: the integration-test
 * container (`devdigest_test`), the hermetic e2e stack (`devdigest_e2e`) and a
 * HW2 experiment stack (`devdigest_hw2f`), each optionally with a nonce. The
 * development database is `devdigest` and never matches.
 */
export const DISPOSABLE_DATABASE_NAME = /^devdigest_(e2e|test|hw2f)(_[a-z0-9]{4,32})?$/;

export function isDisposableDatabaseName(name: string): boolean {
  return DISPOSABLE_DATABASE_NAME.test(name);
}

/** The database name in a Postgres URL, or null when the URL names none or cannot be parsed. */
export function databaseNameOf(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** The only database URL a test run may connect by: a closed loopback port (9, discard) with a disposable name. */
export const TEST_DATABASE_URL = 'postgres://devdigest:devdigest@127.0.0.1:9/devdigest_test';

/**
 * A table only the testcontainers helper (`test/helpers/pg.ts`) creates, in a
 * fresh container: a database that has it was made for a test. A disposable
 * name alone is not provenance (a development server may hold a database of
 * that name too).
 */
export const DISPOSABLE_MARKER_TABLE = 'devdigest_disposable_marker';

/** A test run: `NODE_ENV=test`, or anything under vitest. */
export function isTestRun(nodeEnv: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return nodeEnv === 'test' || Boolean(env.VITEST);
}

/**
 * A test run without an injected `db` may only use `TEST_DATABASE_URL`. On
 * boot the app's stale-run reaper writes to whatever `databaseUrl` names, and
 * an unset or `.env`-loaded URL is the development database; so is a
 * disposable-looking name on a real server. Throws before any connection is
 * opened, naming no more of the URL than its database. Outside tests it does
 * nothing.
 */
export function assertTestDatabaseIsolated(config: { nodeEnv: string; databaseUrl: string }, env: NodeJS.ProcessEnv = process.env): void {
  if (!isTestRun(config.nodeEnv, env)) return;
  if (config.databaseUrl !== TEST_DATABASE_URL) {
    const name = databaseNameOf(config.databaseUrl);
    throw new Error(
      `Refusing to connect: a test run without an injected db may only use the closed test URL, not a database named ${name ?? '(unreadable URL)'}. Inject a testcontainers db (test/helpers/pg.ts), or use test/setup/isolate-database.ts.`,
    );
  }
}

/**
 * A test run with an injected `db` must show that the db was made for a test:
 * a disposable `current_database()` and the testcontainers helper's marker
 * table. Runs one read-only query before anything writes; a db that cannot
 * answer (a fake, an unreachable server) is refused too. Outside tests it does
 * nothing.
 */
export async function assertInjectedTestDatabase(db: Db, config: { nodeEnv: string }, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!isTestRun(config.nodeEnv, env)) return;
  let row: { name?: unknown; marked?: unknown } | undefined;
  try {
    const rows = (await db.execute(
      sql`select current_database() as name, to_regclass(${`public.${DISPOSABLE_MARKER_TABLE}`}) is not null as marked`,
    )) as unknown as Array<{ name?: unknown; marked?: unknown }>;
    row = rows[0];
  } catch {
    row = undefined;
  }
  if (!row || typeof row.name !== 'string' || !isDisposableDatabaseName(row.name) || row.marked !== true) {
    throw new Error(
      `Refusing to use the injected db in a test run: it is not a marked disposable test database (${row && typeof row.name === 'string' ? `database ${row.name}${row.marked === true ? '' : ', no marker'}` : 'it could not be verified'}). Use test/helpers/pg.ts.`,
    );
  }
}

/** The only repository a freshly seeded disposable database may hold. */
const SEEDED_REPO = 'acme/payments-api';

/**
 * Refuse unless `db` is demonstrably a disposable database: its actual name
 * (`current_database()`, not the URL) matches DISPOSABLE_DATABASE_NAME, and it
 * holds no repository besides the seeded demo one. Called before any write.
 */
export async function assertDisposableDatabase(db: Db): Promise<void> {
  const rows = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = [...rows][0]?.name ?? '';
  if (!isDisposableDatabaseName(name)) {
    throw new Error(
      `Refusing to seed experiment fixtures: database "${name}" is not a disposable database ` +
        '(expected devdigest_test, devdigest_e2e or devdigest_hw2f, optionally with _<nonce>).',
    );
  }
  const others = await db
    .select({ fullName: t.repos.fullName })
    .from(t.repos)
    .where(ne(t.repos.fullName, SEEDED_REPO));
  if (others.length > 0) {
    throw new Error(
      `Refusing to seed experiment fixtures: database "${name}" holds other repositories ` +
        `(${others.map((repo) => repo.fullName).join(', ')}), so it is not a freshly seeded disposable database.`,
    );
  }
}
