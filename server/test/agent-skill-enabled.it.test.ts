import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { MockEmbedder, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns, waitForRunTrace } from './helpers/runs.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const approve: Review = { verdict: 'approve', summary: 'No findings.', score: 100, findings: [] };
const DIFF = `diff --git a/src/add.ts b/src/add.ts
--- a/src/add.ts
+++ b/src/add.ts
@@ -1 +1 @@
-export const add = (a, b) => a + b
+export const add = (a, b) => Number(a) + Number(b)`;

interface Link { skill_id: string; order: number; enabled: boolean; link_enabled: boolean }

/** Criteria 13, 31 and 37: a per-agent enabled switch on each agent-skill link. */
d('per-agent skill switch (agent_skills.enabled)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => pg?.stop());

  async function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: approve }) },
      },
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  async function skill(app: App, name: string) {
    const res = await app.inject({ method: 'POST', url: '/skills', payload: { name: `${name} ${seq++}`, description: '', type: 'rubric', body: `${name} criteria.` } });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string };
  }
  async function agentWith(app: App, skillIds: string[]) {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Switch agent ${seq++}`, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.', repo_intel: false },
      })
    ).json() as { id: string };
    const set = await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: skillIds } });
    expect(set.statusCode).toBe(200);
    return agent.id;
  }
  const links = async (app: App, agentId: string) =>
    (await app.inject({ url: `/agents/${agentId}/skills` })).json() as Link[];
  const setEnabled = (app: App, agentId: string, skillId: string, enabled: unknown) =>
    app.inject({ method: 'PATCH', url: `/agents/${agentId}/skills/${skillId}`, payload: { enabled } });

  async function reviewSkillsBlock(app: App, agentId: string): Promise<{ skills: string | null; tokens: number | null }> {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `switch-${seq}`, fullName: `acme/switch-${seq++}` })
      .returning();
    const [pull] = await pg.handle.db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: 1, title: 'Change addition', author: 'dev', branch: 'b', base: 'main', headSha: 'sha1', status: 'needs_review' })
      .returning();
    const started = (await app.inject({ method: 'POST', url: `/pulls/${pull!.id}/review`, payload: { agentId } })).json() as {
      runs: Array<{ run_id: string }>;
    };
    await waitForPrRuns(pg.handle.db, pull!.id, { expected: 1 });
    await waitForRunTrace(pg.handle.db, started.runs[0]!.run_id);
    const trace = (await app.inject({ url: `/runs/${started.runs[0]!.run_id}/trace` })).json();
    return { skills: trace.prompt_assembly.skills ?? null, tokens: trace.prompt_assembly.skills_tokens ?? null };
  }

  it('links start enabled; PATCH turns one off for this agent only and leaves the skill itself enabled', async () => {
    const app = await makeApp();
    const a = await skill(app, 'Alpha');
    const b = await skill(app, 'Beta');
    const agentId = await agentWith(app, [a.id, b.id]);
    const otherAgent = await agentWith(app, [a.id]);
    expect((await links(app, agentId)).map((l) => l.link_enabled)).toEqual([true, true]);

    const res = await setEnabled(app, agentId, a.id, false);
    expect(res.statusCode).toBe(200);
    const after = res.json() as Link[];
    expect(after.find((l) => l.skill_id === a.id)).toMatchObject({ link_enabled: false, enabled: true, order: 0 });
    expect(after.find((l) => l.skill_id === b.id)).toMatchObject({ link_enabled: true });

    // The other agent's link and the skill's own switch are untouched.
    expect((await links(app, otherAgent))[0]).toMatchObject({ skill_id: a.id, link_enabled: true });
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, a.id));
    expect(row!.enabled).toBe(true);
    const [link] = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, a.id)));
    expect(link!.enabled).toBe(false);

    expect((await setEnabled(app, agentId, a.id, true)).json()[0]).toMatchObject({ skill_id: a.id, link_enabled: true });
    await app.close();
  });

  it('leaves a link-disabled skill out of the review prompt and its token count, keeping the others in order', async () => {
    const app = await makeApp();
    const first = await skill(app, 'First');
    const middle = await skill(app, 'Middle');
    const last = await skill(app, 'Last');
    const agentId = await agentWith(app, [first.id, middle.id, last.id]);

    const all = await reviewSkillsBlock(app, agentId);
    expect(all.skills).toContain(middle.name);

    expect((await setEnabled(app, agentId, middle.id, false)).statusCode).toBe(200);
    const without = await reviewSkillsBlock(app, agentId);
    expect(without.skills).not.toContain(middle.name);
    expect(without.skills!.indexOf(first.name)).toBeLessThan(without.skills!.indexOf(last.name));
    expect(without.tokens).toBeGreaterThan(0);
    expect(without.tokens!).toBeLessThan(all.tokens!);

    // With every link switched off there is no Skills block at all.
    await setEnabled(app, agentId, first.id, false);
    await setEnabled(app, agentId, last.id, false);
    expect(await reviewSkillsBlock(app, agentId)).toEqual({ skills: null, tokens: null });
    await app.close();
  });

  it('keeps the switch through a reorder; an unlinked and relinked skill starts enabled again', async () => {
    const app = await makeApp();
    const a = await skill(app, 'Keep');
    const b = await skill(app, 'Move');
    const agentId = await agentWith(app, [a.id, b.id]);
    await setEnabled(app, agentId, a.id, false);

    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [b.id, a.id] } });
    expect(await links(app, agentId)).toEqual([
      expect.objectContaining({ skill_id: b.id, order: 0, link_enabled: true }),
      expect.objectContaining({ skill_id: a.id, order: 1, link_enabled: false }),
    ]);

    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [b.id] } });
    await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_id: a.id } });
    expect((await links(app, agentId)).find((l) => l.skill_id === a.id)).toMatchObject({ link_enabled: true });
    await app.close();
  });

  it('a disabled link still counts toward the 4-skill limit and the agent skill count', async () => {
    const app = await makeApp();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await skill(app, 'Limit')).id);
    const agentId = await agentWith(app, ids);
    await setEnabled(app, agentId, ids[0]!, false);

    const extra = await skill(app, 'Extra');
    const over = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [...ids, extra.id] } });
    expect(over.statusCode).toBe(422);
    const listed = (await app.inject({ url: '/agents' })).json() as Array<{ id: string; skill_count?: number }>;
    expect(listed.find((agent) => agent.id === agentId)?.skill_count).toBe(4);
    await app.close();
  });

  it('rejects an unlinked skill, a foreign agent and a malformed body without writing', async () => {
    const app = await makeApp();
    const linked = await skill(app, 'Linked');
    const unlinked = await skill(app, 'Unlinked');
    const agentId = await agentWith(app, [linked.id]);

    expect((await setEnabled(app, agentId, unlinked.id, false)).statusCode).toBe(404);
    expect((await setEnabled(app, agentId, linked.id, 'no')).statusCode).toBe(422);
    expect(
      (await app.inject({ method: 'PATCH', url: `/agents/${agentId}/skills/${linked.id}`, payload: { enabled: false, order: 3 } })).statusCode,
    ).toBe(422);

    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: `foreign-${seq++}` }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws!.id, name: 'Foreign', provider: 'openai', model: 'm', systemPrompt: 's' })
      .returning();
    expect((await setEnabled(app, foreignAgent!.id, linked.id, false)).statusCode).toBe(404);

    expect((await links(app, agentId))[0]).toMatchObject({ skill_id: linked.id, link_enabled: true });
    await app.close();
  });
});
