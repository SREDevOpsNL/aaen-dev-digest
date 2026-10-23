/**
 * Runs before every test file (vitest `setupFiles`). A test never reads
 * `server/.env` (dotenv is pointed at the always-empty /dev/null), and its
 * `DATABASE_URL` points at a closed loopback port (9, discard) with a
 * disposable name. An app booted without an injected `db` therefore fails its
 * boot reaper at once and touches nothing, and `buildApp` refuses any
 * non-disposable database in a test run (`assertTestDatabaseIsolated`). Tests
 * that need Postgres inject a testcontainers database (`test/helpers/pg.ts`).
 */
export const TEST_DATABASE_URL = 'postgres://devdigest:devdigest@127.0.0.1:9/devdigest_test';

process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.DATABASE_URL = TEST_DATABASE_URL;
