import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { IntentAnalysisRaw, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

// A short deadline for this file only, so the timeout fires within the test.
vi.mock('../src/modules/intent/constants.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/intent/constants.js')>()),
  INTENT_TIMEOUT_MS: 150,
  INTENT_TIMEOUT_MARGIN_MS: 50,
}));

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const INTENT_RAW: IntentAnalysisRaw = {
  claimed_purpose: 'Add the Stripe key to config',
  supported_points: [
    { statement: 'Adds a Stripe key', evidence: [{ file: 'src/config.ts', side: 'new', start_line: 11, end_line: 11 }] },
  ],
  discrepancies: [],
  in_scope: ['payment configuration'],
  out_of_scope: [],
  confidence: 'medium',
};

/**
 * The first classifier call behaves like a provider request that never answers:
 * it settles only when its signal aborts. Later calls answer at once.
 */
class HangingIntentLLM extends MockLLMProvider {
  events: string[] = [];
  signals: (AbortSignal | undefined)[] = [];

  constructor() {
    super('openai', {});
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.schemaName !== 'Intent') return super.completeStructured(req);
    const call = this.signals.push(req.signal);
    this.events.push(`start:${call}`);
    if (call === 1) {
      await new Promise<never>((_, reject) => {
        req.signal?.addEventListener('abort', () => {
          this.events.push('abort:1');
          reject(req.signal!.reason);
        });
      });
    }
    this.events.push(`end:${call}`);
    return {
      data: INTENT_RAW as unknown as T,
      model: 'cheap-intent-model',
      tokensIn: 300,
      tokensOut: 80,
      providerCostUsd: 0.004,
      costUsd: 0.004,
      raw: JSON.stringify(INTENT_RAW),
      attempts: 1,
    };
  }
}

d('Intent derivation deadline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('aborts a timed-out classifier request before a new one begins, and marks its cost unknown', async () => {
    const llm = new HangingIntentLLM();
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'deadline', fullName: 'acme/deadline' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId, repoId: repo!.id, number: 9, title: 'Add Stripe config', author: 'dev',
        branch: 'feat/stripe', base: 'main', headSha: 'head-1', body: 'Adds payment config.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0 });
    const url = `/pulls/${pr!.id}/intent`;

    const first = (await app.inject({ method: 'POST', url })).json();
    expect(first.state).toBe('failed');
    expect(first.last_error).toMatch(/timed out/i);
    // The request was aborted at the deadline, not left running in the background.
    expect(llm.signals[0]?.aborted).toBe(true);
    expect(llm.events).toEqual(['start:1', 'abort:1']);

    const second = (await app.inject({ method: 'POST', url: `${url}/recompute` })).json();
    expect(second).toMatchObject({ state: 'ready', last_error: null });
    expect(llm.events).toEqual(['start:1', 'abort:1', 'start:2', 'end:2']);
    expect(llm.signals[1]?.aborted).toBe(false);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr!.id));
    expect(row!.totalTokensIn).toBe(300); // only the completed call reported usage
    expect(row!.totalCostComplete).toBe(false); // the interrupted call may have been billed
    await app.close();
  });
});
