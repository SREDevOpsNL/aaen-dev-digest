import { describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { dockerAvailable, startPg } from './helpers/pg.js';

const suite = await dockerAvailable() ? describe : describe.skip;

suite('identity-only conventions seed (Testcontainers pg)', () => {
  it('creates only the local identity and settings in a disposable database', async () => {
    const pg = await startPg();
    try {
      const result = await seed(pg.handle.db, { identityOnly: true });
      expect(result.workspaceId).toBeTruthy();
      expect(await pg.handle.db.select().from(t.repos)).toEqual([]);
      expect(await pg.handle.db.select().from(t.pullRequests)).toEqual([]);
      expect(await pg.handle.db.select().from(t.conventions)).toEqual([]);
      await expect(seed(pg.handle.db, { identityOnly: true, experimentFixtures: true }))
        .rejects.toThrow(/cannot add review fixtures/);
      expect(await pg.handle.db.select().from(t.repos)).toEqual([]);
    } finally { await pg.stop(); }
  });
});
