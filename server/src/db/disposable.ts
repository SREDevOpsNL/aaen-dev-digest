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
