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
if (!hasDocker) console.warn('[agent-skill-limit] Docker not available — skipping integration tests.');

type App = Awaited<ReturnType<typeof buildApp>>;

d('agent skill limit and atomic linking', () => {
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

  async function createSkill(extra: Record<string, unknown> = {}) {
    const name = unique('Limit skill');
    const response = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: '', type: 'rubric', body: 'Check behavior.', ...extra },
    });
    return { response, name };
  }
  async function skill() {
    const { response } = await createSkill();
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }
  async function agentWith(count: number) {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: unique('Limit agent'), provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
      })
    ).json() as { id: string };
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(await skill());
    if (count > 0) {
      const set = await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: ids } });
      expect(set.statusCode).toBe(200);
    }
    return { agentId: agent.id, ids };
  }
  const links = async (agentId: string) =>
    ((await app.inject({ url: `/agents/${agentId}/skills` })).json() as Array<{ skill_id: string }>).map((l) => l.skill_id);

  it('refuses a fifth skill on the set path and on link-one, with a clear error', async () => {
    const { agentId, ids } = await agentWith(4);
    const fifth = await skill();

    const set = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [...ids, fifth] } });
    expect(set.statusCode).toBe(422);
    expect(set.json().error).toMatchObject({ code: 'skill_limit_reached', details: { max: 4 } });
    expect(set.json().error.message).toContain('at most 4 skills');

    const one = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: fifth } });
    expect(one.statusCode).toBe(422);
    expect(one.json().error.code).toBe('skill_limit_reached');
    expect(await links(agentId)).toEqual(ids);

    // Re-linking an already linked skill only moves it; it is not a fifth.
    const moved = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: ids[3], order: 0 } });
    expect(moved.statusCode).toBe(200);
    expect(await links(agentId)).toEqual([ids[3], ids[0], ids[1], ids[2]]);
  });

  it('never blocks reordering or reducing an agent that already exceeds the limit', async () => {
    const { agentId, ids } = await agentWith(4);
    const extra = await skill();
    // Legacy state from before the limit existed: five links written directly.
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId: extra, order: 4 });
    const five = [...ids, extra];

    const reordered = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [...five].reverse() } });
    expect(reordered.statusCode).toBe(200);
    const reduced = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: five.slice(0, 3) } });
    expect(reduced.statusCode).toBe(200);
    expect(await links(agentId)).toEqual(five.slice(0, 3));
  });

  it('two simultaneous link-one requests on an agent with 3 skills: one wins, one gets the limit error, nothing is lost', async () => {
    for (let round = 0; round < 3; round++) {
      const { agentId, ids } = await agentWith(3);
      const [a, b] = [await skill(), await skill()];
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: a } }),
        app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: b } }),
      ]);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 422]);
      const winner = responses[0]!.statusCode === 200 ? a : b;
      expect(await links(agentId)).toEqual([...ids, winner]);
    }
  });

  it('two simultaneous link-one requests of different skills on an agent with 1 skill both persist', async () => {
    for (let round = 0; round < 3; round++) {
      const { agentId, ids } = await agentWith(1);
      const [a, b] = [await skill(), await skill()];
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: a } }),
        app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: b } }),
      ]);
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      const final = await links(agentId);
      expect(final).toHaveLength(3); // a lost update would leave 2
      expect(final[0]).toBe(ids[0]);
      expect(new Set(final.slice(1))).toEqual(new Set([a, b]));
    }
  });

  it('creates a skill already linked to an agent, in one request', async () => {
    const { agentId, ids } = await agentWith(2);
    const { response } = await createSkill({ link_agent_id: agentId });
    expect(response.statusCode).toBe(201);
    expect(await links(agentId)).toEqual([...ids, response.json().id]);
  });

  it('create-linked on a full, unknown or foreign agent is refused before any skill is inserted', async () => {
    const { agentId } = await agentWith(4);
    const full = await createSkill({ link_agent_id: agentId });
    expect(full.response.statusCode).toBe(422);
    expect(full.response.json().error.code).toBe('skill_limit_reached');
    expect(await pg.handle.db.select().from(t.skills).where(eq(t.skills.name, full.name))).toEqual([]);

    const [otherWorkspace] = await pg.handle.db.insert(t.workspaces).values({ name: unique('other') }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: otherWorkspace!.id, name: 'Foreign', provider: 'openai', model: 'm', systemPrompt: 'p' })
      .returning();
    for (const target of [foreignAgent!.id, '00000000-0000-4000-8000-000000000000']) {
      const refused = await createSkill({ link_agent_id: target });
      expect(refused.response.statusCode).toBe(422);
      expect(refused.response.json().error.code).toBe('validation_error');
      expect(await pg.handle.db.select().from(t.skills).where(eq(t.skills.name, refused.name))).toEqual([]);
    }
    expect(await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.agentId, foreignAgent!.id))).toEqual([]);
  });

  it('two parallel create-linked requests on an agent with 3 skills: exactly one skill is created', async () => {
    const { agentId, ids } = await agentWith(3);
    const [first, second] = await Promise.all([createSkill({ link_agent_id: agentId }), createSkill({ link_agent_id: agentId })]);
    expect([first.response.statusCode, second.response.statusCode].sort()).toEqual([201, 422]);
    const winner = first.response.statusCode === 201 ? first : second;
    const loser = winner === first ? second : first;
    expect(await links(agentId)).toEqual([...ids, winner.response.json().id]);
    expect(await pg.handle.db.select().from(t.skills).where(eq(t.skills.name, loser.name))).toEqual([]);
  });
});
