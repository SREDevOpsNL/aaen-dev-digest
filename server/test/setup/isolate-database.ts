/**
 * Runs before every test file (vitest `setupFiles`):
 * - no test reads `server/.env` (dotenv is pointed at the always-empty /dev/null);
 * - `DATABASE_URL` is `TEST_DATABASE_URL`, a closed loopback port with a
 *   disposable name, the only URL `buildApp` accepts in a test run without an
 *   injected db (`assertTestDatabaseIsolated`);
 * - secrets come from an empty, test-owned file, and secret variables from the
 *   developer's shell are removed.
 *
 * Tests that need Postgres inject a testcontainers database
 * (`test/helpers/pg.ts`), which `buildApp` verifies (`assertInjectedTestDatabase`).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_DATABASE_URL } from '../../src/db/disposable.js';

export { TEST_DATABASE_URL };

/** Keys a test must never pick up from the developer's shell (`LocalSecretsProvider` falls back to process.env). */
export const SECRET_ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GITHUB_PAT'] as const;

process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.DATABASE_URL = TEST_DATABASE_URL;
// A test-owned, empty secrets file instead of ~/.devdigest/secrets.json or the
// experiment key file (loadConfig honours it in a test run only).
process.env.DEVDIGEST_TEST_SECRETS_PATH = join(mkdtempSync(join(tmpdir(), 'devdigest-test-secrets-')), 'secrets.json');
for (const key of SECRET_ENV_KEYS) delete process.env[key];
