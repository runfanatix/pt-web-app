import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { planPrototypeImport, runImport } from '@pt/core';
import { REPO_ROOT, asUser, createTestDb, createUser, pgliteSink, type TestUser } from './harness.ts';

const exportJson: unknown = JSON.parse(
  readFileSync(join(REPO_ROOT, 'exports', 'bedfordview-v11.json'), 'utf8'),
);

let db: PGlite;
let owner: TestUser;
let other: TestUser;
let gymId = '';

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, 'pt@example.com');
  other = await createUser(db, 'other@example.com');
});

describe('importing the Bedfordview export into the real schema', () => {
  it('dry run reports 14 zones and 41 machines', () => {
    const { plan } = planPrototypeImport(exportJson, { trainerId: owner.trainerId });
    expect(plan.zones).toHaveLength(14);
    expect(plan.equipment).toHaveLength(41);
    expect(plan.floors).toHaveLength(2);
  });

  it('writes the whole gym in one go (every row satisfies the table constraints)', async () => {
    const { plan } = planPrototypeImport(exportJson, { trainerId: owner.trainerId, includeSession: true });
    const summary = await runImport(plan, pgliteSink(db));
    gymId = summary.gymId;
    expect(summary).toMatchObject({
      floors: 2,
      zones: 14,
      structs: 3,
      equipment: 41,
      links: 139,
      templates: 2,
    });
    const counts = await db.query<{ zones: number; equipment: number }>(
      'select (select count(*) from zones)::int as zones, (select count(*) from equipment)::int as equipment',
    );
    expect(counts.rows[0]).toEqual({ zones: 14, equipment: 41 });
  });

  it('the owning trainer reads the imported gym with RLS on', async () => {
    const rows = await asUser(db, owner.userId, (q) =>
      q<{ name: string; branch: string; zones: number; machines: number }>(
        `select g.name, g.branch,
                (select count(*) from zones z join floors f on f.id = z.floor_id where f.gym_id = g.id)::int as zones,
                (select count(*) from equipment e join zones z on z.id = e.zone_id join floors f on f.id = z.floor_id where f.gym_id = g.id)::int as machines
           from gyms g`,
      ),
    );
    expect(rows).toEqual([{ name: 'Virgin Active', branch: 'Bedfordview', zones: 14, machines: 41 }]);
  });

  it('another trainer sees none of it, nor the imported exercises', async () => {
    for (const table of ['gyms', 'floors', 'zones', 'equipment', 'templates', 'exercise_equipment']) {
      expect(await asUser(db, other.userId, (q) => q(`select * from ${table}`)), table).toHaveLength(0);
    }
    expect(await asUser(db, other.userId, (q) => q('select * from exercises'))).toHaveLength(0);
    expect(await asUser(db, owner.userId, (q) => q('select * from exercises'))).not.toHaveLength(0);
    expect(gymId).not.toBe('');
  });

  it('a second import reuses existing exercises by name instead of duplicating them', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int as n from exercises')).rows[0]!.n;
    const { plan } = planPrototypeImport(exportJson, { trainerId: owner.trainerId, gymName: 'Second copy' });
    const summary = await runImport(plan, pgliteSink(db));
    expect(summary.exercisesCreated).toBe(0);
    expect((await db.query<{ n: number }>('select count(*)::int as n from exercises')).rows[0]!.n).toBe(
      before,
    );
  });
});
