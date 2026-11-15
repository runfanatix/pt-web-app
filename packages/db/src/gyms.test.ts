import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  blankLayout,
  cloneLayout,
  layoutFromFloorRows,
  layoutSavePayload,
  planPrototypeImport,
  runImport,
} from '@pt/core';
import {
  REPO_ROOT,
  asUser,
  createTestDb,
  createUser,
  failsAs,
  pgliteSink,
  type TestUser,
} from './harness.ts';

const exportJson: unknown = JSON.parse(
  readFileSync(join(REPO_ROOT, 'exports', 'bedfordview-v11.json'), 'utf8'),
);

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
let gymId = '';

const rows = async <T>(userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, (q) => q<T>(sql, params));

async function newGym(user: TestUser, name: string): Promise<string> {
  const r = await rows<{ id: string }>(
    user.userId,
    'insert into gyms (trainer_id, name, branch) values ($1, $2, $3) returning id',
    [user.trainerId, name, 'Branch'],
  );
  return r[0]!.id;
}
const saveLayout = (user: TestUser, gym: string, layout: object) =>
  rows(user.userId, 'select public.save_gym_layout($1, $2::json)', [gym, JSON.stringify(layout)]);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  const { plan } = planPrototypeImport(exportJson, { trainerId: alice.trainerId, includeSession: true });
  await runImport(plan, pgliteSink(db));
  gymId = plan.gym.id;
});

describe('gyms', () => {
  it('a trainer makes a gym with a blank one-floor plan', async () => {
    const id = await newGym(alice, 'Blank Gym');
    await saveLayout(alice, id, layoutSavePayload(blankLayout(crypto.randomUUID())));
    const floors = await rows<{ name: string }>(alice.userId, 'select name from floors where gym_id = $1', [
      id,
    ]);
    expect(floors.map((f) => f.name)).toEqual(['Ground floor']);
    expect(
      await rows(
        alice.userId,
        'select 1 from zones z join floors f on f.id = z.floor_id where f.gym_id = $1',
        [id],
      ),
    ).toHaveLength(0);
  });

  it('a copy of a gym shares no rows with the original, and the exercise links are copied to the new machines', async () => {
    const rowsIn = await rows<{ r: unknown }>(
      alice.userId,
      `select coalesce(json_agg(f order by f.position), '[]'::json) as r from (
         select fl.id, fl.name, fl.w, fl.h, fl.position,
           coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name, 'category', z.category, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h,
              'zone_parts', coalesce((select json_agg(json_build_object('x', p.x, 'y', p.y, 'w', p.w, 'h', p.h, 'position', p.position)) from zone_parts p where p.zone_id = z.id), '[]'::json),
              'equipment', coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name, 'type', e.type, 'x', e.x, 'y', e.y, 'muscles', e.muscles, 'notes', e.notes)) from equipment e where e.zone_id = z.id), '[]'::json)))
              from zones z where z.floor_id = fl.id), '[]'::json) as zones,
           coalesce((select json_agg(json_build_object('id', s.id, 'type', s.type, 'x', s.x, 'y', s.y, 'w', s.w, 'h', s.h, 'x2', s.x2, 'y2', s.y2, 'rotation', s.rotation, 'label', s.label, 'shared', s.shared))
              from structs s where s.floor_id = fl.id), '[]'::json) as structs
         from floors fl where fl.gym_id = $1) f`,
      [gymId],
    );
    const src = layoutFromFloorRows(rowsIn[0]!.r);
    const copy = cloneLayout(src, () => crypto.randomUUID());
    const id = await newGym(alice, 'Copy Gym');
    await saveLayout(alice, id, layoutSavePayload(copy.layout));

    const shared = await rows(
      alice.userId,
      `select e.id from equipment e join zones z on z.id = e.zone_id join floors f on f.id = z.floor_id
        where f.gym_id = $1 and e.id = any($2::uuid[])`,
      [id, src.equipment.map((e) => e.id)],
    );
    expect(shared).toHaveLength(0);

    for (const m of copy.machines) {
      await rows(
        alice.userId,
        `insert into exercise_equipment (exercise_id, equipment_id)
           select exercise_id, $2::uuid from exercise_equipment where equipment_id = $1::uuid`,
        [m.from, m.to],
      );
    }
    const a = await rows<{ n: number }>(
      alice.userId,
      'select count(*)::int as n from exercise_equipment where equipment_id = any($1::uuid[])',
      [src.equipment.map((e) => e.id)],
    );
    const b = await rows<{ n: number }>(
      alice.userId,
      'select count(*)::int as n from exercise_equipment where equipment_id = any($1::uuid[])',
      [copy.machines.map((m) => m.to)],
    );
    expect(b[0]!.n).toBe(a[0]!.n);
    expect(b[0]!.n).toBeGreaterThan(0);
  });

  it('deleting a gym removes its plan, machines and templates, and keeps runs and programmes', async () => {
    const id = await newGym(alice, 'Doomed Gym');
    await saveLayout(alice, id, layoutSavePayload(blankLayout(crypto.randomUUID())));
    await db.query("insert into templates (trainer_id, gym_id, name) values ($1, $2, 'Doomed template')", [
      alice.trainerId,
      id,
    ]);
    await db.query(
      "insert into runs (id, trainer_id, gym_id, title, total_ms) values ($1, $2, $3, 'Run at doomed', 5)",
      [crypto.randomUUID(), alice.trainerId, id],
    );
    await rows(alice.userId, 'delete from gyms where id = $1', [id]);
    expect(await rows(alice.userId, 'select 1 from floors where gym_id = $1', [id])).toHaveLength(0);
    expect(await rows(alice.userId, "select 1 from templates where name = 'Doomed template'")).toHaveLength(
      0,
    );
    const run = await rows<{ gym_id: string | null }>(
      alice.userId,
      "select gym_id from runs where title = 'Run at doomed'",
    );
    expect(run).toHaveLength(1);
    expect(run[0]!.gym_id).toBeNull();
  });

  it('another trainer cannot see, edit, delete or copy links from these gyms', async () => {
    expect(await rows(bob.userId, 'select 1 from gyms where id = $1', [gymId])).toHaveLength(0);
    await rows(bob.userId, "update gyms set name = 'Hijacked' where id = $1", [gymId]);
    await rows(bob.userId, 'delete from gyms where id = $1', [gymId]);
    const still = await rows<{ name: string }>(alice.userId, 'select name from gyms where id = $1', [gymId]);
    expect(still[0]!.name).not.toBe('Hijacked');
    const myGym = await newGym(bob, 'Bobs');
    expect(
      await failsAs(db, bob.userId, 'insert into gyms (trainer_id, name) values ($1, $2)', [
        alice.trainerId,
        'Fake',
      ]),
    ).not.toBeNull();
    expect(myGym).toBeTruthy();
    const alicesMachine = (await db.query<{ id: string }>('select id from equipment limit 1')).rows[0]!.id;
    const anyExercise = (await db.query<{ id: string }>('select id from exercises limit 1')).rows[0]!.id;
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into exercise_equipment (exercise_id, equipment_id) values ($1, $2)',
        [anyExercise, alicesMachine],
      ),
    ).not.toBeNull();
  });

  it('a gym name must not be empty or too long', async () => {
    expect(
      await failsAs(db, alice.userId, "insert into gyms (trainer_id, name) values ($1, '')", [
        alice.trainerId,
      ]),
    ).not.toBeNull();
    expect(
      await failsAs(db, alice.userId, 'insert into gyms (trainer_id, name) values ($1, $2)', [
        alice.trainerId,
        'x'.repeat(61),
      ]),
    ).not.toBeNull();
  });
});
