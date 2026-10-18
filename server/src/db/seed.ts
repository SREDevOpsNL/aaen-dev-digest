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
import { API_CONTRACT_SEED_SKILLS } from './seed-skills.js';
import { EXPERIMENT_FIXTURES, patchStats } from './seed-fixtures.js';
import type { IntentAnalysis } from '@devdigest/shared';
import { INTENT_PROMPT_VERSION } from '@devdigest/reviewer-core';
import { contextHash, identifyLinkedIssue, issueHash } from '../modules/intent/helpers.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, four reusable test-quality skills, three API Contract
 * skills, five built-in agents (General + Security + Performance + Test Quality
 * + API Contract), all on the default openrouter/deepseek-v4-flash
 * provider+model, and the two HW2 experiment fixture PRs (#501, #502).
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
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

  // ---- cached PR intent for #482 (L03) ----
  // A demo intent fingerprinted exactly as IntentService does, so it reads as
  // fresh: opening the seeded PR never triggers generation, and seeded e2e
  // flows stay read-only with no model call. Never overwrites a real one.
  await seedFreshIntent(db, pr!, {
    intent: 'Adds a token-bucket rate limiter to the public API endpoints',
    analysis: {
      claimed_purpose:
        'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      supported_points: [
        {
          statement: 'Adds a token-bucket rate limiter to the public API endpoints',
          evidence: [{ file: 'src/middleware/ratelimit.ts', side: 'new', start_line: 1, end_line: 12 }],
        },
      ],
      discrepancies: [
        {
          kind: 'undeclared_change',
          statement: 'Also changes payment configuration in src/config.ts',
          evidence: [{ file: 'src/config.ts', side: 'new', start_line: 12, end_line: 12 }],
        },
      ],
      in_scope: ['public API rate limiting', 'rate-limit configuration'],
      out_of_scope: ['authenticated endpoints', 'billing'],
      confidence: 'medium',
      unverified_statements: [],
    },
    filesExcerpted: 2,
  });

  // ---- HW2 experiment fixtures: PRs #501 and #502 (see ./seed-fixtures.ts) ----
  // Reviewed from their stored patches only; each gets a fresh cached intent so
  // a review batch never derives one. Existing rows are left as they are.
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
    await seedFreshIntent(db, fixturePr!, {
      intent: fixture.intent.summary,
      analysis: fixture.intent.analysis,
      filesExcerpted: fixture.files.length,
    });
  }

  // ---- built-in skills (text configuration only; never executable) ----
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'Behavioral Coverage',
      description: 'Checks that tests prove public behavior rather than implementation details.',
      type: 'rubric',
      source: 'manual',
      body:
        'Identify every caller-visible behavior changed by the diff. Require focused tests for meaningful success, failure, and state-transition paths. Do not request tests solely to increase line coverage.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'Assertion Quality',
      description: 'Rejects assertions that can pass while the intended behavior is broken.',
      type: 'rubric',
      source: 'manual',
      body:
        'Check that assertions observe the externally meaningful result, error, or side effect. Flag tests that only assert mocks were called, snapshots changed, or values exist when those checks would miss a realistic regression.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'Edge Cases and Error Paths',
      description: 'Covers boundaries and failure behavior introduced by the change.',
      type: 'rubric',
      source: 'manual',
      body:
        'Look for untested empty, missing, malformed, boundary, authorization, and dependency-failure inputs relevant to this diff. Require fail-closed behavior where security or data integrity is involved.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'Test Isolation and Determinism',
      description: 'Finds order dependence, leaked state, time races, and unintended external I/O.',
      type: 'convention',
      source: 'manual',
      body:
        'Tests must be deterministic and independently runnable. Flag shared mutable state, unbounded timing assumptions, real network calls, cross-test database leakage, and cleanup that is skipped on failure.',
      enabled: true,
      version: 1,
    },
  ];
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
    let [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) [existing] = await db.insert(t.agents).values(a).returning();
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
 * Store a cached intent for `pr`, fingerprinted exactly as IntentService does,
 * so it reads as fresh and a review batch reuses it instead of deriving one.
 * Never overwrites an existing intent row.
 */
async function seedFreshIntent(
  db: Db,
  pr: typeof t.pullRequests.$inferSelect,
  input: { intent: string; analysis: IntentAnalysis; filesExcerpted: number },
): Promise<void> {
  const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
  const linked = identifyLinkedIssue(pr.body, { owner: 'acme', name: 'payments-api' });
  await db
    .insert(t.prIntent)
    .values({
      prId: pr.id,
      intent: input.intent,
      inScope: input.analysis.in_scope,
      outOfScope: input.analysis.out_of_scope,
      status: 'ready',
      analysis: input.analysis,
      evidence: { files_listed: files.length, files_excerpted: input.filesExcerpted, truncated: false, invalid_citations: 0 },
      headSha: pr.headSha,
      contextHash: contextHash({
        title: pr.title,
        body: pr.body,
        files,
        linkedIssueNumber: linked.status === 'identified' ? linked.number : null,
      }),
      issueHash: issueHash(null),
      promptVersion: INTENT_PROMPT_VERSION,
      provider: 'seed',
      model: 'seed',
      derivedAt: new Date('2026-10-01T00:00:00Z'),
      startedAt: new Date('2026-10-01T00:00:00Z'),
    })
    .onConflictDoNothing();
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
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
