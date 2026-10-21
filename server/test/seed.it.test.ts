import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { seed } from '../src/db/seed.js';
import { EXPERIMENT_FIXTURES, SYNTHETIC_CONVENTIONS, SYNTHETIC_CONVENTION_LABEL } from '../src/db/seed-fixtures.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { createDb } from '../src/db/client.js';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns, waitForRunTrace } from './helpers/runs.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[seed] Docker not available — skipping integration tests.');

const approve: Review = { verdict: 'approve', summary: 'No findings.', score: 100, findings: [] };

d('seed: API Contract Reviewer and HW2 experiment fixtures', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db)); // the default seed, as `pnpm db:seed` runs it
  });
  afterAll(async () => pg?.stop());

  const db = () => pg.handle.db;
  async function agentNamed(name: string) {
    const rows = await db().select().from(t.agents).where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }
  async function linkedNames(agentId: string) {
    const rows = await db()
      .select({ name: t.skills.name })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((row) => row.name);
  }

  it('the default seed creates no experiment fixtures and keeps #482 and every agent', async () => {
    const pulls = await db().select().from(t.pullRequests);
    expect(pulls.map((pull) => pull.number)).toEqual([482]);
    const agents = await db().select({ name: t.agents.name }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      'API Contract Reviewer',
      'General Reviewer',
      'Performance Reviewer',
      'Security Reviewer',
      'Test Quality Reviewer',
    ]);

    // The default seed keeps the Test Quality Reviewer's normal configuration.
    expect(await agentNamed('Test Quality Reviewer')).toMatchObject({ strategy: 'single-pass', repoIntel: true, version: 1 });

    // Opting in on this disposable database (devdigest_test) adds them; twice is idempotent.
    await seed(db(), { experimentFixtures: true });
    await seed(db(), { experimentFixtures: true });
  });

  it('fixture mode makes the experiment 17 reviewer experiment-ready as one new config version', async () => {
    // Seeded first without fixtures (above), then twice with them: one update, one new version.
    const tqr = await agentNamed('Test Quality Reviewer');
    expect(tqr).toMatchObject({ strategy: 'single-pass', repoIntel: false, version: 2 });
    const versions = await db().select().from(t.agentVersions).where(eq(t.agentVersions.agentId, tqr.id)).orderBy(asc(t.agentVersions.version));
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.configJson).toMatchObject({ strategy: 'single-pass', repo_intel: true });
    expect(versions[1]!.configJson).toMatchObject({ strategy: 'single-pass', repo_intel: false });
    const links = await db().select({ skillId: t.agentSkills.skillId }).from(t.agentSkills).where(eq(t.agentSkills.agentId, tqr.id)).orderBy(asc(t.agentSkills.order));
    expect((versions[1]!.configJson as { skills: string[] }).skills).toEqual(links.map((l) => l.skillId)); // the snapshot holds the current links
    // The other reviewers keep their configuration.
    expect(await agentNamed('General Reviewer')).toMatchObject({ repoIntel: true, version: 1 });
    expect(await agentNamed('API Contract Reviewer')).toMatchObject({ strategy: 'single-pass', repoIntel: false, version: 1 });
  });

  it('seeds the API Contract Reviewer once, single-pass without repo intel, with three ordered skills', async () => {
    const agent = await agentNamed('API Contract Reviewer');
    expect(agent).toMatchObject({ strategy: 'single-pass', repoIntel: false, enabled: true });
    expect(await linkedNames(agent.id)).toEqual(['breaking-change', 'response-schema', 'semver-discipline']);

    const skills = await db().select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
    const apiSkills = skills.filter((skill) => ['breaking-change', 'response-schema', 'semver-discipline', 'deprecation-policy'].includes(skill.name));
    expect(apiSkills.map((skill) => skill.name).sort()).toEqual(['breaking-change', 'response-schema', 'semver-discipline']);
    expect(apiSkills.every((skill) => skill.source === 'manual' && skill.enabled && skill.version === 1)).toBe(true);
    expect(skills.filter((skill) => skill.name === 'deprecation-policy')).toEqual([]); // imported, never seeded

    const [version] = await db().select().from(t.agentVersions).where(eq(t.agentVersions.agentId, agent.id));
    expect((version!.configJson as { skills: string[] }).skills).toHaveLength(3);
  });

  it('keeps the Test Quality Reviewer and every seeded agent within the 4-skill limit', async () => {
    const tqr = await agentNamed('Test Quality Reviewer');
    expect(await linkedNames(tqr.id)).toEqual(['Behavioral Coverage', 'Assertion Quality', 'Edge Cases and Error Paths', 'Test Isolation and Determinism']);
    const agents = await db().select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    for (const agent of agents) expect((await linkedNames(agent.id)).length).toBeLessThanOrEqual(4);
  });

  it('seeds PRs #501 and #502 once each in acme/payments-api, with patches and a commit', async () => {
    const [repo] = await db().select().from(t.repos).where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    const pulls = await db().select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repo!.id));
    expect(pulls.map((pull) => pull.number).sort()).toEqual([482, 501, 502]); // no demo PR #3 here
    for (const fixture of EXPERIMENT_FIXTURES) {
      const pull = pulls.find((p) => p.number === fixture.number)!;
      const files = await db().select().from(t.prFiles).where(eq(t.prFiles.prId, pull.id));
      expect(files.map((file) => [file.path, file.patch])).toEqual(fixture.files.map((file) => [file.path, file.patch]));
      expect(await db().select().from(t.prCommits).where(eq(t.prCommits.prId, pull.id))).toHaveLength(1);
    }
  });

  it('a review of a fixture PR makes exactly one model call, from the stored patch', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: approve });
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: db(),
      // The fixture repository is never cloned, so `git diff` yields no files and
      // the executor falls back to the stored pr_files patches, as on a real stack.
      overrides: { git: new MockGitClient({ diff: '' }), github: new MockGitHubClient(), llm: { openrouter: llm } },
    });
    const agent = await agentNamed('API Contract Reviewer');
    const [pull] = await db().select().from(t.pullRequests).where(eq(t.pullRequests.number, 502));
    const started = (await app.inject({ method: 'POST', url: `/pulls/${pull!.id}/review`, payload: { agentId: agent.id } })).json() as {
      runs: Array<{ run_id: string }>;
    };
    await waitForPrRuns(db(), pull!.id, { expected: 1 });
    await waitForRunTrace(db(), started.runs[0]!.run_id);
    const trace = (await app.inject({ url: `/runs/${started.runs[0]!.run_id}/trace` })).json();

    expect(llm.calls.filter((call) => call.method === 'completeStructured')).toHaveLength(1);
    expect(trace.prompt_assembly.user).toContain('src/api/payments.ts'); // reviewed from the stored patch
    expect(trace.prompt_assembly.user).toContain('amount: (payment.amountCents / 100).toFixed(2)');
    expect(trace.prompt_assembly.user).not.toContain('src/config.ts'); // not the mock git diff
    expect(trace.prompt_assembly.skills).toContain('breaking-change');
    await app.close();
  });

  it('leaves the #482 demo review untouched and creates no runs', async () => {
    const [pr482] = await db().select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
    const reviews = await db().select().from(t.reviews).where(eq(t.reviews.prId, pr482!.id));
    expect(reviews).toHaveLength(1);
    expect(await db().select().from(t.findings).where(eq(t.findings.reviewId, reviews[0]!.id))).toHaveLength(2);
    expect(await db().select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr482!.id))).toEqual([]);
    const fixturePrIds = (await db().select().from(t.pullRequests).where(inArray(t.pullRequests.number, [501, 502]))).map((p) => p.id);
    const reviewsOnFixtures = await db().select().from(t.reviews).where(inArray(t.reviews.prId, fixturePrIds));
    expect(reviewsOnFixtures.every((review) => review.model !== 'seed')).toBe(true); // the seed adds no fixture reviews
  });

  it('adds labelled synthetic convention candidates only when asked, once', async () => {
    const [repo] = await db().select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    expect(await db().select().from(t.conventions).where(eq(t.conventions.repoId, repo!.id))).toEqual([]);
    await seed(db(), { syntheticConventions: true });
    await seed(db(), { syntheticConventions: true });
    const candidates = await db().select().from(t.conventions).where(eq(t.conventions.repoId, repo!.id));
    expect(candidates).toHaveLength(SYNTHETIC_CONVENTIONS.length);
    expect(candidates.every((c) => c.status === 'pending' && c.rationale!.startsWith(SYNTHETIC_CONVENTION_LABEL))).toBe(true);
    await db().delete(t.conventions).where(eq(t.conventions.repoId, repo!.id));
  });

  it('refuses fixtures on a database named like the dev database, before any write', async () => {
    await pg.handle.sql.unsafe('create database devdigest');
    const devNamed = createDb(pg.url.replace(/\/devdigest_test(\?|$)/, '/devdigest$1'), { max: 1 });
    try {
      // No migrations ran there: a write would fail differently, so this proves the check comes first.
      await expect(seed(devNamed.db, { experimentFixtures: true })).rejects.toThrow(/"devdigest" is not a disposable database/);
      await expect(seed(devNamed.db, { syntheticConventions: true })).rejects.toThrow(/"devdigest" is not a disposable database/);
      await expect(seed(devNamed.db)).rejects.toThrow(); // and the default seed, unguarded, would try to write
    } finally {
      await devNamed.close();
    }
  });

  it('refuses fixtures when the database holds another repository, and writes nothing', async () => {
    await db().insert(t.repos).values({ workspaceId, owner: 'someone', name: 'real-repo', fullName: 'someone/real-repo' });
    const before = await db().select().from(t.pullRequests);
    await expect(seed(db(), { experimentFixtures: true })).rejects.toThrow(/holds other repositories \(someone\/real-repo\)/);
    expect(await db().select().from(t.pullRequests)).toHaveLength(before.length);
  });
});

d('seed: a fresh fixture database (insert path and workspace isolation)', () => {
  let pg: PgFixture;
  let other: { workspaceId: string; agentId: string };

  beforeAll(async () => {
    pg = await startPg();
    // Another workspace's Test Quality Reviewer, with repo intel on, exists before the seed.
    const [workspace] = await pg.handle.db.insert(t.workspaces).values({ name: 'someone-else' }).returning();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: workspace!.id, name: 'Test Quality Reviewer', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', systemPrompt: 'theirs' })
      .returning();
    other = { workspaceId: workspace!.id, agentId: agent!.id };
    await seed(pg.handle.db, { experimentFixtures: true });
    await seed(pg.handle.db, { experimentFixtures: true }); // repeated: idempotent
  });
  afterAll(async () => pg?.stop());

  it('inserts the experiment 17 reviewer experiment-ready at version 1, once', async () => {
    const [workspace] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    const rows = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspace!.id), eq(t.agents.name, 'Test Quality Reviewer')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ strategy: 'single-pass', repoIntel: false, version: 1 });
    const versions = await pg.handle.db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, rows[0]!.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.configJson).toMatchObject({ strategy: 'single-pass', repo_intel: false });
  });

  it("leaves another workspace's Test Quality Reviewer untouched", async () => {
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, other.agentId));
    expect(agent).toMatchObject({ workspaceId: other.workspaceId, repoIntel: true, version: 1, systemPrompt: 'theirs' });
    expect(await pg.handle.db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, other.agentId))).toEqual([]);
  });
});
