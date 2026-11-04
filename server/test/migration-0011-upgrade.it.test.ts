import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { dockerAvailable } from './helpers/pg.js';
import { runMigrations } from '../src/db/migrate.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
interface JournalEntry { idx: number; when: number; tag: string }
const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: JournalEntry[];
};

/** A migrations folder holding only the entries up to and including `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'devdigest-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  expect(cut).toBeGreaterThanOrEqual(0);
  const entries = journal.entries.slice(0, cut + 1);
  for (const e of entries) copyFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

const LONG_RULE = 'Prefer named exports over default exports in shared modules. '.repeat(40);

/**
 * Upgrade path for migration 0011_add_convention_evidence: a database at 0010
 * with existing conventions rows (the pre-0011 `accepted` boolean, no `status`)
 * is migrated forward, and every row must survive with its status mapped.
 */
d('migration 0011: upgrade from 0010 with existing conventions (Testcontainers pg)', () => {
  let container: StartedPostgreSqlContainer;
  let url: string;
  let sql: postgres.Sql;
  let partialDir: string;
  const ids: Record<string, string> = {};
  let before: Array<Record<string, unknown>>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('devdigest_test')
      .withUsername('devdigest')
      .withPassword('devdigest')
      .start();
    url = container.getConnectionUri();
    sql = postgres(url, { max: 1 });

    // Bring the database to 0010 only.
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    partialDir = migrationsUpTo('0010_small_bug');
    await migrate(drizzle(sql), { migrationsFolder: partialDir });

    const [ws] = await sql`INSERT INTO workspaces (name) VALUES ('upgrade-ws') RETURNING id`;
    const repos = await sql`
      INSERT INTO repos (workspace_id, owner, name, full_name)
      VALUES (${ws!.id}, 'acme', 'one', 'acme/one'), (${ws!.id}, 'acme', 'two', 'acme/two')
      RETURNING id, name`;
    const repoId = (name: string) => repos.find((r) => r.name === name)!.id as string;

    const rows = [
      { key: 'accepted-full', repo: repoId('one'), rule: LONG_RULE, path: 'src/a.ts', snippet: 'export const a = 1;', confidence: 0.92, accepted: true },
      { key: 'pending-nulls', repo: repoId('one'), rule: 'Use kebab-case file names.', path: null, snippet: null, confidence: null, accepted: false },
      { key: 'accepted-repo2', repo: repoId('two'), rule: 'Wrap route handlers in services.', path: 'src/routes.ts', snippet: 'app.get(...)', confidence: 0.5, accepted: true },
      { key: 'pending-no-repo', repo: null, rule: 'Workspace-wide rule.', path: 'AGENTS.md', snippet: null, confidence: 0.1, accepted: false },
    ];
    for (const r of rows) {
      const [inserted] = await sql`
        INSERT INTO conventions (workspace_id, repo_id, rule, evidence_path, evidence_snippet, confidence, accepted)
        VALUES (${ws!.id}, ${r.repo}, ${r.rule}, ${r.path}, ${r.snippet}, ${r.confidence}, ${r.accepted})
        RETURNING id`;
      ids[r.key] = inserted!.id as string;
    }
    before = await sql`
      SELECT id, workspace_id, repo_id, rule, evidence_path, evidence_snippet, confidence, accepted
      FROM conventions ORDER BY id`;

    // An agent-skill link made before 0012 added the per-agent switch.
    const [agent] = await sql`
      INSERT INTO agents (workspace_id, name, provider, model, system_prompt)
      VALUES (${ws!.id}, 'Upgrade Agent', 'openai', 'gpt-4o-mini', 'Review.') RETURNING id`;
    const [skill] = await sql`
      INSERT INTO skills (workspace_id, name, description, type, source, body)
      VALUES (${ws!.id}, 'Upgrade Skill', '', 'rubric', 'manual', 'Check it.') RETURNING id`;
    await sql`INSERT INTO agent_skills (agent_id, skill_id, "order") VALUES (${agent!.id}, ${skill!.id}, 0)`;
    ids.link = `${agent!.id}/${skill!.id}`;

    // Now the real upgrade, through the same entry point `pnpm db:migrate` uses.
    await runMigrations(url);
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await container?.stop();
    if (partialDir) rmSync(partialDir, { recursive: true, force: true });
  });

  it('starts from a real 0010 schema: accepted boolean, no status column', () => {
    expect(before).toHaveLength(4);
    expect(before.every((row) => typeof row.accepted === 'boolean')).toBe(true);
    expect(before.some((row) => 'status' in row)).toBe(false);
  });

  it('maps accepted=true to accepted and accepted=false to pending, and drops accepted', async () => {
    const after = await sql`SELECT id, status FROM conventions`;
    const status = Object.fromEntries(after.map((row) => [row.id, row.status]));
    expect(status[ids['accepted-full']!]).toBe('accepted');
    expect(status[ids['accepted-repo2']!]).toBe('accepted');
    expect(status[ids['pending-nulls']!]).toBe('pending');
    expect(status[ids['pending-no-repo']!]).toBe('pending');

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'conventions' AND column_name = 'accepted'`;
    expect(cols).toHaveLength(0);
  });

  it('preserves ids, repository links, rules and evidence of every row', async () => {
    const after = await sql`
      SELECT id, workspace_id, repo_id, rule, evidence_path, evidence_snippet, confidence
      FROM conventions ORDER BY id`;
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before.map(({ accepted: _accepted, ...rest }) => rest));
    expect(after.find((row) => row.id === ids['accepted-full'])!.rule).toBe(LONG_RULE);
  });

  it('fills the new columns with their defaults', async () => {
    const after = await sql`SELECT category, rationale, evidence_line, created_at FROM conventions`;
    for (const row of after) {
      expect(row.category).toBe('general');
      expect(row.rationale).toBeNull();
      expect(row.evidence_line).toBeNull();
      expect(row.created_at).not.toBeNull();
      expect(Number.isNaN(new Date(row.created_at as string).getTime())).toBe(false);
    }
  });

  it('adds the status and category constraints and the repo/created index', async () => {
    const id = ids['pending-nulls']!;
    await expect(sql`UPDATE conventions SET status = 'archived' WHERE id = ${id}`).rejects.toThrow(/conventions_status_ck/);
    await expect(sql`UPDATE conventions SET category = 'misc' WHERE id = ${id}`).rejects.toThrow(/conventions_category_ck/);
    await sql`UPDATE conventions SET status = 'rejected', category = 'naming' WHERE id = ${id}`;
    const [row] = await sql`SELECT status, category FROM conventions WHERE id = ${id}`;
    expect(row).toMatchObject({ status: 'rejected', category: 'naming' });

    const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'conventions'`;
    expect(indexes.map((i) => i.indexname)).toContain('conventions_repo_created_idx');
  });

  it('records each applied migration with the SHA-256 of its SQL file', async () => {
    const applied = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    expect(applied).toHaveLength(journal.entries.length);
    applied.forEach((row, i) => {
      const entry = journal.entries[i]!;
      const fileHash = createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`))).digest('hex');
      expect(row.hash).toBe(fileHash);
      expect(Number(row.created_at)).toBe(entry.when);
    });
  });

  it('keeps the journal strictly ordered, with 0011 at index 11', () => {
    const entries = journal.entries;
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(entries[i - 1]!.when);
    });
    expect(entries[11]!.tag).toBe('0011_add_convention_evidence');
  });

  it('keeps a pre-existing agent-skill link enabled once 0012 adds the per-agent switch', async () => {
    const [agentId, skillId] = ids.link!.split('/');
    const [link] = await sql`SELECT "order", enabled FROM agent_skills WHERE agent_id = ${agentId!} AND skill_id = ${skillId!}`;
    expect(link).toEqual({ order: 0, enabled: true });
  });

  it('is a no-op when migrated again', async () => {
    const [{ count: beforeCount }] = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    await runMigrations(url);
    const [{ count: afterCount }] = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    expect(afterCount).toBe(beforeCount);
    const [{ count: rows }] = await sql`SELECT count(*)::int AS count FROM conventions`;
    expect(rows).toBe(4);
  });
});
