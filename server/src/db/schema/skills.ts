import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey, bigserial, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { users, workspaces } from './core';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
  source: text('source', {
    enum: ['manual', 'imported_file', 'imported_url', 'extracted', 'community'],
  }).notNull(),
  body: text('body').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  evidenceFiles: jsonb('evidence_files').$type<string[]>(),
  createdAt: now(),
});

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);

/**
 * Append-only audit of Skill-content approval decisions. A skill's body may
 * enter the review's system message only when the latest row (highest `id`)
 * is an 'approve' of exactly its current version and body sha256. Application
 * code only inserts here; there is no update or delete path. The trail
 * outlives its skill: deleting the skill sets `skill_id` to null and the row
 * keeps `skill_name`. Rows are removed only with their workspace.
 */
export const skillApprovals = pgTable(
  'skill_approvals',
  {
    // Monotonic: decisions for one skill are written under its row lock, so
    // id order is decision order.
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Null once the skill is deleted; the history itself is kept.
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    /** The skill's name when the decision was made (survives deletion). */
    skillName: text('skill_name').notNull(),
    version: integer('version').notNull(),
    bodySha256: text('body_sha256').notNull(),
    decision: text('decision', { enum: ['approve', 'revoke'] }).notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    createdAt: now(),
  },
  (t) => ({
    bySkill: index('skill_approvals_skill_id_idx').on(t.skillId, t.id),
  }),
);
