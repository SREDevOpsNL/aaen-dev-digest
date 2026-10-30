import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { API_CONTRACT_SEED_SKILLS, TEST_QUALITY_SEED_SKILLS } from './seed-skills.js';
import { approveReviewedSeedSkill } from './reviewed-seed-skills.js';
import { EXPERIMENT_FIXTURES, SYNTHETIC_CONVENTIONS, patchStats } from './seed-fixtures.js';
import { assertDisposableDatabase } from './disposable.js';
import { AgentsRepository } from '../modules/agents/repository.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * The review shape every HW2 experiment reviewer must have (the executor
 * refuses anything else, see modules/reviews/experiment-run.ts): one
 * whole-diff call and no repo-intel context. The API Contract Reviewer is
 * always seeded this way; the Test Quality Reviewer (experiment 17) gets it
 * only with `experimentFixtures`, so a normal seed keeps its default config.
 */
export const EXPERIMENT_REVIEWER_SHAPE = { strategy: 'single-pass', repoIntel: false } as const;
const EXPERIMENT_17_REVIEWER = 'Test Quality Reviewer';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, four reusable test-quality skills, three API Contract
 * skills, five built-in agents (General + Security + Performance + Test Quality
 * + API Contract), all on the default openrouter/deepseek-v4-flash
 * provider+model. With `experimentFixtures` (disposable databases only), also
 * the two HW2 experiment fixture PRs (#501, #502).
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export interface SeedOptions {
  /**
   * Also seed the HW2 experiment fixture PRs #501 and #502. Opt-in, and only
   * into a demonstrably disposable database (./disposable.ts): the plain
   * `pnpm db:seed` never creates them. The CLI enables it with
   * DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1.
   */
  experimentFixtures?: boolean;
  /**
   * Also seed synthetic, labelled convention candidates for the demo repo, for
   * the final Conventions walkthrough without a paid extraction. Opt-in and
   * disposable-only like the fixtures (CLI: DEVDIGEST_SEED_SYNTHETIC_CONVENTIONS=1).
   */
  syntheticConventions?: boolean;
  /** Disposable conventions stack: seed only the local user/workspace/settings, never demo data. */
  identityOnly?: boolean;
}

export async function seed(
  db: Db,
  options: SeedOptions = {},
): Promise<{ workspaceId: string; userId: string }> {
  // Checked before any write, so a refused run changes nothing.
  if (options.experimentFixtures || options.syntheticConventions || options.identityOnly) await assertDisposableDatabase(db);
  if (options.identityOnly && (options.experimentFixtures || options.syntheticConventions)) {
    throw new Error('Identity-only seed cannot add review fixtures or synthetic conventions');
  }

  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  if (options.identityOnly) return { workspaceId, userId };

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- HW2 experiment fixtures: PRs #501 and #502 (opt-in, disposable only) ----
  if (options.experimentFixtures) await seedExperimentFixtures(db, workspaceId, repoId);
  if (options.syntheticConventions) await seedSyntheticConventions(db, workspaceId, repoId);

  // ---- built-in skills (text configuration only; never executable) ----
  const seedSkills: Array<typeof t.skills.$inferInsert> = TEST_QUALITY_SEED_SKILLS.map((content) => ({
    workspaceId,
    ...content,
    source: 'manual' as const,
    enabled: true,
    version: 1,
  }));
  const skillIds: string[] = [];
  for (const skill of seedSkills) {
    let [stored] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skill.name)));
    if (!stored) {
      [stored] = await db.insert(t.skills).values(skill).returning();
    }
    skillIds.push(stored!.id);
    await db
      .insert(t.skillVersions)
      .values({ skillId: stored!.id, version: 1, body: stored!.body })
      .onConflictDoNothing();
    // Approved for the system message only if this exact body was reviewed.
    await approveReviewedSeedSkill(db, stored!, userId);
  }

  // ---- API Contract skills (three seeded; deprecation-policy is imported) ----
  const apiContractSkillIds: string[] = [];
  for (const content of API_CONTRACT_SEED_SKILLS) {
    let [stored] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, content.name)));
    if (!stored) {
      [stored] = await db
        .insert(t.skills)
        .values({ workspaceId, ...content, type: 'rubric', source: 'manual', enabled: true, version: 1 })
        .returning();
    }
    apiContractSkillIds.push(stored!.id);
    await db
      .insert(t.skillVersions)
      .values({ skillId: stored!.id, version: 1, body: stored!.body })
      .onConflictDoNothing();
    // Approved for the system message only if this exact body was reviewed.
    await approveReviewedSeedSkill(db, stored!, userId);
  }

  // ---- built-in agents (the starter presets + Test Quality + API Contract) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks behavioral coverage, assertions, edge cases, and test isolation.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Flags breaking route, schema, versioning and deprecation changes for existing API clients.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      // Fixed review shape: one whole-diff call and no repo-intel context, so
      // runs differ only in their inputs (the fixtures have no clone anyway).
      strategy: 'single-pass',
      repoIntel: false,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  // Seeded links per agent (order = index). Within the 4-skill limit.
  const linkedSkills: Record<string, string[]> = {
    'Test Quality Reviewer': skillIds,
    'API Contract Reviewer': apiContractSkillIds,
  };
  const agentIds: Record<string, string> = {};
  for (const a of seedAgents) {
    // Fixture mode (disposable databases only) gives the experiment 17 reviewer
    // the experiment shape; a normal seed leaves its default config alone.
    const shape = options.experimentFixtures && a.name === EXPERIMENT_17_REVIEWER ? EXPERIMENT_REVIEWER_SHAPE : null;
    let [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) [existing] = await db.insert(t.agents).values({ ...a, ...shape }).returning();
    else if (shape && (existing.strategy !== shape.strategy || existing.repoIntel !== shape.repoIntel)) {
      // Seeded earlier without fixtures: change it as a new config version (the
      // repository bumps the version and snapshots the current links).
      existing = await new AgentsRepository(db).update(workspaceId, existing.id, { ...shape });
    }
    agentIds[a.name] = existing!.id;

    await db
      .insert(t.agentVersions)
      .values({
        agentId: existing!.id,
        version: existing!.version,
        configJson: {
          provider: existing!.provider,
          model: existing!.model,
          system_prompt: existing!.systemPrompt,
          output_schema: existing!.outputSchema,
          strategy: existing!.strategy,
          ci_fail_on: existing!.ciFailOn,
          repo_intel: existing!.repoIntel,
          skills: linkedSkills[a.name] ?? [],
        },
      })
      .onConflictDoNothing();
  }

  for (const [agentName, ids] of Object.entries(linkedSkills)) {
    const agentId = agentIds[agentName];
    if (!agentId || ids.length === 0) continue;
    await db
      .insert(t.agentSkills)
      .values(ids.map((skillId, order) => ({ agentId, skillId, order })))
      .onConflictDoNothing();
  }

  return { workspaceId, userId };
}

/**
 * Seed the HW2 experiment fixture PRs (./seed-fixtures.ts) into the demo
 * repository. Only called after assertDisposableDatabase.
 */
async function seedExperimentFixtures(db: Db, workspaceId: string, repoId: string): Promise<void> {
  // Reviewed from their stored patches only. Existing rows are left as they are.
  for (const fixture of EXPERIMENT_FIXTURES) {
    let [fixturePr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, fixture.number)));
    if (!fixturePr) {
      const stats = fixture.files.map((file) => ({ file, ...patchStats(file.patch) }));
      [fixturePr] = await db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: fixture.number,
          title: fixture.title,
          author: fixture.author,
          branch: fixture.branch,
          base: 'main',
          headSha: fixture.headSha,
          additions: stats.reduce((sum, f) => sum + f.additions, 0),
          deletions: stats.reduce((sum, f) => sum + f.deletions, 0),
          filesCount: fixture.files.length,
          status: 'needs_review',
          body: fixture.body,
        })
        .returning();
      await db.insert(t.prFiles).values(
        stats.map(({ file, additions, deletions }) => ({
          prId: fixturePr!.id,
          path: file.path,
          additions,
          deletions,
          patch: file.patch,
        })),
      );
      await db.insert(t.prCommits).values({
        prId: fixturePr!.id,
        sha: fixture.headSha,
        message: fixture.commitMessage,
        author: fixture.author,
      });
    }
  }
}

/**
 * Seed the labelled synthetic convention candidates (./seed-fixtures.ts), once:
 * nothing is added when the repository already has candidates.
 */
async function seedSyntheticConventions(db: Db, workspaceId: string, repoId: string): Promise<void> {
  const existing = await db.select({ id: t.conventions.id }).from(t.conventions).where(eq(t.conventions.repoId, repoId));
  if (existing.length > 0) return;
  await db.insert(t.conventions).values(
    SYNTHETIC_CONVENTIONS.map((candidate) => ({ workspaceId, repoId, status: 'pending' as const, ...candidate })),
  );
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db, {
    experimentFixtures: process.env.DEVDIGEST_SEED_EXPERIMENT_FIXTURES === '1',
    syntheticConventions: process.env.DEVDIGEST_SEED_SYNTHETIC_CONVENTIONS === '1',
    identityOnly: process.env.DEVDIGEST_SEED_IDENTITY_ONLY === '1',
  })
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
