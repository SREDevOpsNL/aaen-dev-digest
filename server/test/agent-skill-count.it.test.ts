import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[agent-skill-count] Docker not available — skipping integration tests.');

type App = Awaited<ReturnType<typeof buildApp>>;
type ListedAgent = { id: string; name: string; skill_count?: number };

d('GET /agents linked-skill count', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: App;
  let counter = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const unique = (prefix: string) => `${prefix} ${Date.now()}-${++counter}`;
  const listAgents = async () => {
    const response = await app.inject({ url: '/agents' });
    expect(response.statusCode).toBe(200);
    return response.json() as ListedAgent[];
  };
  const countOf = async (agentId: string) => (await listAgents()).find((a) => a.id === agentId)?.skill_count;
  async function skill() {
    const response = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: unique('Count skill'), description: '', type: 'rubric', body: 'Check behavior.' },
    });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }
  async function agentWith(count: number) {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: unique('Count agent'), provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
      })
    ).json() as { id: string };
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await skill());
    if (count > 0) {
      const set = await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: ids } });
      expect(set.statusCode).toBe(200);
    }
    return { agentId: agent.id, ids };
  }

  it('reports 0, 1 and several linked skills, including the seeded reviewers', async () => {
    const none = await agentWith(0);
    const one = await agentWith(1);
    const three = await agentWith(3);
    const agents = await listAgents();
    const byId = new Map(agents.map((a) => [a.id, a.skill_count]));
    expect(byId.get(none.agentId)).toBe(0);
    expect(byId.get(one.agentId)).toBe(1);
    expect(byId.get(three.agentId)).toBe(3);

    const byName = new Map(agents.map((a) => [a.name, a.skill_count]));
    expect(byName.get('Test Quality Reviewer')).toBe(4);
    expect(byName.get('API Contract Reviewer')).toBe(3);
    expect(byName.get('General Reviewer')).toBe(0);
  });

  it('matches the attached count and follows link, unlink and skill deletion', async () => {
    const { agentId, ids } = await agentWith(3);
    const attached = (await app.inject({ url: `/agents/${agentId}/skills` })).json() as unknown[];
    expect(await countOf(agentId)).toBe(attached.length);

    const extra = await skill();
    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [...ids, extra] } });
    expect(await countOf(agentId)).toBe(4);

    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [ids[0]] } });
    expect(await countOf(agentId)).toBe(1);

    expect((await app.inject({ method: 'DELETE', url: `/skills/${ids[0]}` })).statusCode).toBe(200);
    expect(await countOf(agentId)).toBe(0);
  });

  it('counts a globally disabled linked skill', async () => {
    const { agentId, ids } = await agentWith(2);
    const disable = await app.inject({ method: 'PUT', url: `/skills/${ids[1]}`, payload: { enabled: false } });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().enabled).toBe(false);
    expect(await countOf(agentId)).toBe(2);
  });

  it('is workspace-scoped: no foreign agents, and foreign skills or links are never counted', async () => {
    const { agentId } = await agentWith(1);
    const db = pg.handle.db;
    const [other] = await db.insert(t.workspaces).values({ name: unique('other') }).returning();
    const [foreignAgent] = await db
      .insert(t.agents)
      .values({ workspaceId: other!.id, name: unique('Foreign agent'), provider: 'openai', model: 'm', systemPrompt: 'p' })
      .returning();
    const foreignSkills = await db
      .insert(t.skills)
      .values(
        [1, 2].map(() => ({ workspaceId: other!.id, name: unique('Foreign skill'), description: '', type: 'rubric' as const, source: 'manual' as const, body: 'b' })),
      )
      .returning();
    await db.insert(t.agentSkills).values(foreignSkills.map((s, order) => ({ agentId: foreignAgent!.id, skillId: s.id, order })));
    // A link from this workspace's agent to a foreign skill cannot be made through
    // the API; inserted directly, it still must not count.
    await db.insert(t.agentSkills).values({ agentId, skillId: foreignSkills[0]!.id, order: 1 });

    const agents = await listAgents();
    expect(agents.some((a) => a.id === foreignAgent!.id)).toBe(false);
    expect(agents.find((a) => a.id === agentId)?.skill_count).toBe(1);
    expect(await db.select().from(t.agentSkills).where(eq(t.agentSkills.agentId, foreignAgent!.id))).toHaveLength(2);
  });

  it('keeps the list order and leaves single-agent responses unchanged', async () => {
    const plain = await pg.handle.db.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    expect((await listAgents()).map((a) => a.id)).toEqual(plain.map((a) => a.id));

    const { agentId } = await agentWith(1);
    const one = (await app.inject({ url: `/agents/${agentId}` })).json();
    expect(one).not.toHaveProperty('skill_count');
  });
});
