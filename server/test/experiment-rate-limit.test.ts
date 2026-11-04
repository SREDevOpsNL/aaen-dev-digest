import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { TEST_DATABASE_URL } from '../src/db/disposable.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * The global limit (120/min) is off under NODE_ENV=test, so only a stack run
 * in development mode shows it. In the 2026-10-24 simulation the X3 checks,
 * previews and the runner's 1/s polls exceeded it: polls and a pre-dispatch
 * check got 429. An experiment stack is loopback-only, so loopback is exempt
 * there; outside experiment mode the limit is unchanged.
 */
const EXPERIMENT = {
  DEVDIGEST_EXPERIMENT_STACK_ID: 'hw2f-rate0001', DEVDIGEST_EXPERIMENT_PROVIDER: 'deepinfra/fp8', DEVDIGEST_EXPERIMENT_MODEL: 'deepseek/deepseek-v4-flash',
  DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS: '16000', DEVDIGEST_EXPERIMENT_PRICE_INPUT: '0.00000009', DEVDIGEST_EXPERIMENT_PRICE_OUTPUT: '0.00000018',
};
async function statuses(env: Record<string, string>, n: number, remoteAddress = '127.0.0.1') {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'development', LOG_LEVEL: 'silent', DATABASE_URL: TEST_DATABASE_URL, ...env } as NodeJS.ProcessEnv) });
  try {
    // A route with no database work, registered like any module route, so the global limit covers it.
    app.get('/__rate-probe', async () => ({ ok: true }));
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await app.inject({ method: 'GET', url: '/__rate-probe', remoteAddress })).statusCode);
    return out;
  } finally {
    await app.close();
  }
}

describe('rate limit on an experiment stack', () => {
  it('experiment mode: 150 loopback calls in a minute are never refused with 429', async () => {
    expect((await statuses(EXPERIMENT, 150)).filter((s) => s === 429)).toHaveLength(0);
  }, 60_000);

  it('experiment mode: a non-loopback client is still limited', async () => {
    expect((await statuses(EXPERIMENT, 125, '10.0.0.5')).filter((s) => s === 429).length).toBeGreaterThan(0);
  }, 60_000);

  it('outside experiment mode the limit is unchanged (loopback too)', async () => {
    const s = await statuses({}, 125);
    expect(s.slice(0, 120).filter((x) => x === 429)).toHaveLength(0);
    expect(s.slice(120).every((x) => x === 429)).toBe(true);
  }, 60_000);
});
