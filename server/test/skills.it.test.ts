import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) console.warn('[skills] Docker not available — skipping integration tests.');

d('skills API and persistence', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name,
        description: 'Focused review guidance.',
        type: 'rubric',
        body: 'Check the caller-visible behavior.',
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; name: string; version: number };
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; version: number };
  }

  it('seeds one Test Quality Reviewer with four ordered, versioned skills idempotently', async () => {
    await seed(pg.handle.db);
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agents.name, 'Test Quality Reviewer'),
        ),
      );
    expect(agent).toBeDefined();

    const links = await pg.handle.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agent!.id))
      .orderBy(t.agentSkills.order);
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.order)).toEqual([0, 1, 2, 3]);
    expect(new Set(links.map((link) => link.skill.name)).size).toBe(4);

    for (const link of links) {
      const versions = await pg.handle.db
        .select()
        .from(t.skillVersions)
        .where(eq(t.skillVersions.skillId, link.skill.id));
      expect(versions).toHaveLength(1);
      expect(versions[0]!.body).toBe(link.skill.body);
    }
  });

  it('supports workspace-scoped CRUD and deliberately permits duplicate display names', async () => {
    const app = await makeApp();
    const duplicateName = `Duplicate ${Date.now()}`;
    const first = await createSkill(app, duplicateName);
    const second = await createSkill(app, duplicateName);
    expect(second.id).not.toBe(first.id);

    const listed = (await app.inject({ url: '/skills' })).json() as Array<{
      id: string;
      used_by_count: number;
    }>;
    expect(listed.find((skill) => skill.id === first.id)?.used_by_count).toBe(0);

    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspace!.id,
        name: 'Foreign',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'Not visible.',
      })
      .returning();
    expect((await app.inject({ url: `/skills/${foreign!.id}` })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/skills/${foreign!.id}`,
          payload: { body: 'Still not visible.' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/skills/${foreign!.id}` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('snapshots config edits transactionally and ignores enabled-only toggles', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, `Versioned ${Date.now()}`);

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { name: 'Versioned renamed' },
    });
    expect(renamed.json().version).toBe(2);
    const changed = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'Check a different observable behavior.' },
    });
    expect(changed.json().version).toBe(3);
    const toggled = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { enabled: false },
    });
    expect(toggled.json()).toMatchObject({ enabled: false, version: 3 });

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json();
    expect(versions.map((version: { version: number }) => version.version)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({
      skill_id: skill.id,
      body: 'Check a different observable behavior.',
      message: null,
    });
    expect(versions[1].body).toBe('Check the caller-visible behavior.');
    expect((await app.inject({ url: `/skills/${skill.id}/versions/2` })).statusCode).toBe(200);
    await app.close();
  });

  it('records imported provenance as imported_file and reads it back from PostgreSQL', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `Imported ${Date.now()}`,
        description: 'From a file.',
        type: 'custom',
        source: 'imported_file',
        body: '# Imported\n\nFlag removed routes.',
        enabled: false,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ source: 'imported_file', version: 1 });

    // Raw SQL, not the Drizzle row type: the stored text column holds the value.
    const rows = await pg.handle.db.execute<{ source: string; body: string }>(
      sql`select source, body from skills where id = ${response.json().id}`,
    );
    expect([...rows][0]).toEqual({ source: 'imported_file', body: '# Imported\n\nFlag removed routes.' });

    const unknown = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Bad source', type: 'custom', source: 'community', body: 'x' },
    });
    expect(unknown.statusCode).toBe(422); // the API maps request validation errors to 422
    await app.close();
  });

  it('restores a previous body as a new version and keeps the full history', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, `Restorable ${Date.now()}`);
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Second body.' } });
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Third body.' } });

    const restored = await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/1/restore` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 4, body: 'Check the caller-visible behavior.' });

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json() as Array<{
      version: number;
      body: string;
    }>;
    expect(versions.map((v) => [v.version, v.body])).toEqual([
      [4, 'Check the caller-visible behavior.'],
      [3, 'Third body.'],
      [2, 'Second body.'],
      [1, 'Check the caller-visible behavior.'],
    ]);

    // Restoring a version whose body is already current changes nothing.
    const noop = await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/1/restore` });
    expect(noop.json().version).toBe(4);
    expect((await app.inject({ url: `/skills/${skill.id}/versions` })).json()).toHaveLength(4);

    expect(
      (await app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/99/restore` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/skills/${randomUUID()}/versions/1/restore` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('does not restore a skill from another workspace', async () => {
    const app = await makeApp();
    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `restore-other-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspace!.id,
        name: 'Foreign restore',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'Current.',
        version: 2,
      })
      .returning();
    await pg.handle.db.insert(t.skillVersions).values([
      { skillId: foreign!.id, version: 1, body: 'Old.' },
      { skillId: foreign!.id, version: 2, body: 'Current.' },
    ]);

    const response = await app.inject({ method: 'POST', url: `/skills/${foreign!.id}/versions/1/restore` });
    expect(response.statusCode).toBe(404);
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, foreign!.id));
    expect(row).toMatchObject({ body: 'Current.', version: 2 });
    await app.close();
  });

  it('keeps version numbers sequential under concurrent restores and edits', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, `Concurrent ${Date.now()}`);
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Body two.' } });
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Body three.' } });

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/1/restore` }),
      app.inject({ method: 'POST', url: `/skills/${skill.id}/versions/2/restore` }),
      app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'Body edited.' } }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json() as Array<{
      version: number;
      body: string;
    }>;
    expect(versions.map((v) => v.version)).toEqual([6, 5, 4, 3, 2, 1]);
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row!.version).toBe(6);
    expect(row!.body).toBe(versions[0]!.body); // the current body is the newest snapshot
    await app.close();
  });

  it('validates same-workspace links before replacing and returns ordered details', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, `Linked ${Date.now()}`);
    const first = await createSkill(app, `First ${Date.now()}`);
    const second = await createSkill(app, `Second ${Date.now()}`);

    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [second.id, first.id] },
    });
    expect(linked.statusCode).toBe(200);
    expect(
      linked.json().map((link: { skill_id: string; order: number }) => [link.skill_id, link.order]),
    ).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
    expect(linked.json()[0]).toMatchObject({
      agent_id: agent.id,
      enabled: true,
      skill: { id: second.id },
    });

    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `link-other-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWorkspace!.id,
        name: 'Foreign link',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'No.',
      })
      .returning();
    const rejected = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [first.id, foreign!.id] },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe('validation_error');

    const preserved = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
    expect(preserved.map((link: { skill_id: string }) => link.skill_id)).toEqual([
      second.id,
      first.id,
    ]);
    expect((await app.inject({ url: `/agents/${agent.id}` })).json().version).toBe(2);
    await app.close();
  });

  it('deletes history and agent links through the declared cascade policy', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, `Cascade ${Date.now()}`);
    const agent = await createAgent(app, `Cascade agent ${Date.now()}`);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    expect((await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode).toBe(
      200,
    );
    expect(await pg.handle.db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skill.id))).toEqual([]);
    expect(await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, skill.id))).toEqual([]);
    expect((await app.inject({ url: `/agents/${agent.id}/skills` })).json()).toEqual([]);
    await app.close();
  });
});
