import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  assignModel,
  catalogueFromRows,
  catalogueIndex,
  CATALOGUE_SELECT,
  layoutSavePayload,
  planPrototypeImport,
  runImport,
  layoutFromFloorRows,
  type Layout,
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
let sharedMaker = '';

const q = <T>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));
const maker = async (u: TestUser, name: string) =>
  (
    await q<{ id: string }>(u, 'insert into manufacturers (trainer_id, name) values ($1, $2) returning id', [
      u.trainerId,
      name,
    ])
  )[0]!.id;
const model = async (u: TestUser, makerId: string, name: string, code = '') =>
  (
    await q<{ id: string }>(
      u,
      'insert into catalogue_items (trainer_id, manufacturer_id, model_name, code) values ($1, $2, $3, $4) returning id',
      [u.trainerId, makerId, name, code],
    )
  )[0]!.id;

async function loadLayout(u: TestUser): Promise<Layout> {
  const rows = await q<{ r: unknown }>(
    u,
    `select coalesce(json_agg(f order by f.position), '[]'::json) as r from (
       select fl.id, fl.name, fl.w, fl.h, fl.position,
         coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name, 'category', z.category, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h,
            'zone_parts', '[]'::json,
            'equipment', coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name, 'type', e.type, 'x', e.x, 'y', e.y, 'muscles', e.muscles, 'notes', e.notes, 'catalogue_item_id', e.catalogue_item_id)) from equipment e where e.zone_id = z.id), '[]'::json)))
            from zones z where z.floor_id = fl.id), '[]'::json) as zones,
         '[]'::json as structs
       from floors fl where fl.gym_id = $1) f`,
    [gymId],
  );
  return layoutFromFloorRows(rows[0]!.r);
}
const save = (u: TestUser, l: Layout) =>
  q(u, 'select public.save_gym_layout($1, $2::json)', [gymId, JSON.stringify(layoutSavePayload(l))]);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  const { plan } = planPrototypeImport(exportJson, { trainerId: alice.trainerId, includeSession: true });
  await runImport(plan, pgliteSink(db));
  gymId = plan.gym.id;
  sharedMaker = (
    await db.query<{ id: string }>(
      "insert into manufacturers (trainer_id, name) values (null, 'Eleiko') returning id",
    )
  ).rows[0]!.id;
  await db.query(
    "insert into catalogue_items (trainer_id, manufacturer_id, model_name, code) values (null, $1, 'Olympic Bar', 'EL-1')",
    [sharedMaker],
  );
});

describe('the catalogue and its privacy', () => {
  it('the migration can be run a second time without an error or losing data', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int as n from manufacturers')).rows[0]!.n;
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261119090000_catalogue.sql'), 'utf8'),
    );
    const after = (await db.query<{ n: number }>('select count(*)::int as n from manufacturers')).rows[0]!.n;
    expect(after).toBe(before);
  });

  it('a trainer builds their own manufacturers and models, and reads them back through the app query shape', async () => {
    const m = await maker(alice, 'Technogym');
    await model(alice, m, 'Selection Chest Press', 'MPY01');
    const rows = await q<unknown>(
      alice,
      `select m.id, m.trainer_id, m.name, coalesce(json_agg(json_build_object('id', i.id, 'trainer_id', i.trainer_id, 'model_name', i.model_name, 'code', i.code, 'kind', i.kind, 'muscles', i.muscles, 'specs', i.specs, 'notes', i.notes)) filter (where i.id is not null), '[]'::json) as catalogue_items
         from manufacturers m left join catalogue_items i on i.manufacturer_id = m.id group by m.id order by m.name`,
    );
    const c = catalogueFromRows(rows);
    expect(c.manufacturers.map((x) => x.name)).toEqual(['Eleiko', 'Technogym']);
    expect(c.items.map((x) => x.model).sort()).toEqual(['Olympic Bar', 'Selection Chest Press']);
    expect(CATALOGUE_SELECT).toContain('catalogue_items');
  });

  it('another trainer sees shared rows but not mine, and cannot change or delete them', async () => {
    const seen = await q<{ name: string }>(bob, 'select name from manufacturers order by name');
    expect(seen.map((r) => r.name)).toEqual(['Eleiko']);
    await q(bob, "update manufacturers set name = 'Hacked' where name = 'Eleiko'");
    await q(bob, "delete from catalogue_items where code = 'EL-1'");
    const still = await db.query<{ n: number }>(
      "select count(*)::int as n from catalogue_items where code = 'EL-1'",
    );
    expect(still.rows[0]!.n).toBe(1);
    expect(
      (await db.query<{ name: string }>('select name from manufacturers where id = $1', [sharedMaker]))
        .rows[0]!.name,
    ).toBe('Eleiko');
  });

  it('a trainer may add their own model under a shared manufacturer, but not under someone else’s', async () => {
    await model(bob, sharedMaker, 'Bobs Bar', 'BB-1');
    const alicesMaker = (
      await q<{ id: string }>(alice, "select id from manufacturers where name = 'Technogym'")
    )[0]!.id;
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into catalogue_items (trainer_id, manufacturer_id, model_name) values ($1, $2, $3)',
        [bob.trainerId, alicesMaker, 'Sneaky'],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(db, bob.userId, 'insert into manufacturers (trainer_id, name) values (null, $1)', [
        'Fake shared',
      ]),
    ).not.toBeNull();
  });

  it('names and codes must be unique within a manufacturer, ignoring case', async () => {
    const m = await maker(bob, 'Life Fitness');
    await model(bob, m, 'Row', 'LF-1');
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into catalogue_items (trainer_id, manufacturer_id, model_name, code) values ($1, $2, $3, $4)',
        [bob.trainerId, m, 'Other', 'lf-1'],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(db, bob.userId, 'insert into manufacturers (trainer_id, name) values ($1, $2)', [
        bob.trainerId,
        'life fitness',
      ]),
    ).not.toBeNull();
    await model(bob, m, 'No code A');
    await model(bob, m, 'No code B');
  });

  it('rejects empty names, bad kinds, bad muscles and non-array specs', async () => {
    const m = await maker(bob, 'Matrix');
    for (const sql of [
      "insert into catalogue_items (trainer_id, manufacturer_id, model_name) values ($1, $2, '')",
      "insert into catalogue_items (trainer_id, manufacturer_id, model_name, kind) values ($1, $2, 'x', 'tank')",
      "insert into catalogue_items (trainer_id, manufacturer_id, model_name, muscles) values ($1, $2, 'x', array['wings'])",
      "insert into catalogue_items (trainer_id, manufacturer_id, model_name, specs) values ($1, $2, 'x', '{}'::jsonb)",
    ])
      expect(await failsAs(db, bob.userId, sql, [bob.trainerId, m])).not.toBeNull();
  });
});

describe('machines and the catalogue', () => {
  it('saving a layout keeps each machine’s model, and the model comes back on the machine', async () => {
    const m = (await q<{ id: string }>(alice, "select id from manufacturers where name = 'Technogym'"))[0]!
      .id;
    const item = await model(alice, m, 'Leg Press 45', 'LP45');
    const c = catalogueFromRows([
      {
        id: m,
        trainer_id: alice.trainerId,
        name: 'Technogym',
        catalogue_items: [
          {
            id: item,
            trainer_id: alice.trainerId,
            model_name: 'Leg Press 45',
            code: 'LP45',
            kind: 'machine',
            muscles: ['legs'],
            specs: [],
            notes: '',
          },
        ],
      },
    ]);
    const before = await loadLayout(alice);
    const target = before.equipment[0]!;
    await save(alice, assignModel(before, target.id, catalogueIndex(c).get(item)!));
    const after = await loadLayout(alice);
    expect(after.equipment.find((e) => e.id === target.id)!.catalogueId).toBe(item);
    expect(after.equipment.filter((e) => e.catalogueId).length).toBe(1);
  });

  it('a machine cannot use another trainer’s model or an unknown one, and nothing is saved when it tries', async () => {
    const bobsMaker = (
      await q<{ id: string }>(bob, "select id from manufacturers where name = 'Life Fitness'")
    )[0]!.id;
    const bobsItem = (
      await q<{ id: string }>(bob, 'select id from catalogue_items where manufacturer_id = $1 limit 1', [
        bobsMaker,
      ])
    )[0]!.id;
    const before = await loadLayout(alice);
    const hijack: Layout = {
      ...before,
      equipment: before.equipment.map((e, i) =>
        i === 1 ? { ...e, name: 'Changed', catalogueId: bobsItem } : e,
      ),
    };
    expect(
      await failsAs(db, alice.userId, 'select public.save_gym_layout($1, $2::json)', [
        gymId,
        JSON.stringify(layoutSavePayload(hijack)),
      ]),
    ).not.toBeNull();
    expect(await loadLayout(alice)).toEqual(before);
    const unknown: Layout = {
      ...before,
      equipment: before.equipment.map((e, i) => (i === 1 ? { ...e, catalogueId: crypto.randomUUID() } : e)),
    };
    expect(
      await failsAs(db, alice.userId, 'select public.save_gym_layout($1, $2::json)', [
        gymId,
        JSON.stringify(layoutSavePayload(unknown)),
      ]),
    ).not.toBeNull();
  });

  it('a machine may use a shared model', async () => {
    const shared = (await db.query<{ id: string }>("select id from catalogue_items where code = 'EL-1'"))
      .rows[0]!.id;
    const before = await loadLayout(alice);
    const e = before.equipment[2]!;
    await save(alice, {
      ...before,
      equipment: before.equipment.map((x) => (x.id === e.id ? { ...x, catalogueId: shared } : x)),
    });
    expect((await loadLayout(alice)).equipment.find((x) => x.id === e.id)!.catalogueId).toBe(shared);
  });

  it('deleting a model keeps the machine and just clears its link; deleting a manufacturer deletes its models', async () => {
    const sharedId = await sharedItem();
    const used = (await loadLayout(alice)).equipment.find(
      (e) => e.catalogueId && e.catalogueId !== sharedId,
    )!;
    await q(alice, 'delete from catalogue_items where id = $1', [used.catalogueId]);
    const after = (await loadLayout(alice)).equipment.find((e) => e.id === used.id)!;
    expect(after).toBeDefined();
    expect(after.catalogueId ?? null).toBeNull();
    const m = await maker(alice, 'Temp Maker');
    await model(alice, m, 'Temp Model');
    await q(alice, 'delete from manufacturers where id = $1', [m]);
    expect(await q(alice, 'select 1 from catalogue_items where manufacturer_id = $1', [m])).toHaveLength(0);
  });
});

async function sharedItem() {
  return (await db.query<{ id: string }>("select id from catalogue_items where code = 'EL-1'")).rows[0]!.id;
}
