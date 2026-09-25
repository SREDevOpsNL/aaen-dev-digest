import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { loadConfig } from '../src/platform/config.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const suite = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[conventions] Docker not available — skipping integration tests.');

const usersSource = [
  'import { db } from "../db";',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');
const extraction = { candidates: [
  { category: 'errors', rule: 'Throw NotFoundError for a missing row', rationale: 'Callers rely on the throw.', evidence_path: 'src/api/users.ts', evidence_line: 4, evidence_snippet: '  if (!user) throw new NotFoundError("User not found");', occurrences: 4, confidence: 0.9 },
  { category: 'api', rule: 'Return Result from every handler', rationale: 'Invented.', evidence_path: 'src/api/users.ts', evidence_line: 2, evidence_snippet: 'function handler(): Result<Item> {', occurrences: 5, confidence: 0.95 },
] };

suite('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    workspaceId = (await pg.handle.db.select().from(t.workspaces))[0]!.id;
    repoId = (await pg.handle.db.insert(t.repos).values({ workspaceId, owner: 'acme', name: 'billing-api', fullName: 'acme/billing-api' }).returning())[0]!.id;
  });
  afterAll(async () => pg?.stop());

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        repoIntel: { getConventionSamples: async () => ['src/api/users.ts'] } as unknown as RepoIntel,
        git: new MockGitClient({ files: { 'src/api/users.ts': usersSource, 'package.json': '{ "type": "module" }' } }),
        llm: { openai: new MockLLMProvider('openai', { structured: extraction }) },
      },
    });
  }

  it('grounds candidates, preserves decisions across rescans, and creates a skill through the standard API', async () => {
    const app = await makeApp();
    const first = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })).json();
    expect(first).toMatchObject({ proposed: 2, dropped_ungrounded: 1 });
    expect(first.candidates).toHaveLength(1);
    const conventionId = first.candidates[0].id as string;
    expect((await app.inject({ method: 'PATCH', url: `/conventions/${conventionId}`, payload: { status: 'accepted' } })).statusCode).toBe(200);
    const second = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })).json();
    expect(second.dropped_duplicate).toBe(1);
    expect(second.candidates[0]).toMatchObject({ id: conventionId, status: 'accepted' });
    const draft = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill`, payload: {} })).json();
    expect(draft).toMatchObject({ name: 'billing-api-conventions', type: 'convention', convention_ids: [conventionId] });
    const created = await app.inject({ method: 'POST', url: '/skills', payload: { ...draft, source: 'extracted', enabled: false } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ source: 'extracted', enabled: false, evidence_files: ['src/api/users.ts'] });
    await app.close();
  });
});
