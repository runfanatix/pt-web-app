import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  addEquipment,
  addFloor,
  addStruct,
  deleteFloor,
  rotateStruct,
  addZone,
  deleteEquipment,
  deleteZone,
  layoutFromFloorRows,
  layoutSavePayload,
  moveEquipment,
  moveZoneBy,
  planPrototypeImport,
  runImport,
  setEquipmentZone,
  setZoneNumber,
  type Layout,
} from '@pt/core';
import {
  REPO_ROOT,
  asAnon,
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

/** Reads a gym back the way the app does: floors with their zones, parts, machines and structures. */
async function loadLayout(userId: string, gym = gymId): Promise<Layout> {
  const rows = await asUser(db, userId, (q) =>
    q<{ r: unknown }>(
      `select coalesce(json_agg(f order by f.position), '[]'::json) as r from (
         select fl.id, fl.name, fl.w, fl.h, fl.position,
           coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name, 'category', z.category, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h,
              'zone_parts', coalesce((select json_agg(json_build_object('x', p.x, 'y', p.y, 'w', p.w, 'h', p.h, 'position', p.position)) from zone_parts p where p.zone_id = z.id), '[]'::json),
              'equipment', coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name, 'type', e.type, 'x', e.x, 'y', e.y, 'muscles', e.muscles, 'notes', e.notes)) from equipment e where e.zone_id = z.id), '[]'::json)))
              from zones z where z.floor_id = fl.id), '[]'::json) as zones,
           coalesce((select json_agg(json_build_object('id', s.id, 'type', s.type, 'x', s.x, 'y', s.y, 'w', s.w, 'h', s.h, 'x2', s.x2, 'y2', s.y2, 'rotation', s.rotation, 'label', s.label, 'shared', s.shared))
              from structs s where s.floor_id = fl.id), '[]'::json) as structs
         from floors fl where fl.gym_id = $1) f`,
      [gym],
    ),
  );
  return layoutFromFloorRows(rows[0]!.r);
}

const save = (userId: string, l: Layout, gym = gymId) =>
  asUser(db, userId, (q) =>
    q('select public.save_gym_layout($1, $2::json)', [gym, JSON.stringify(layoutSavePayload(l))]),
  );

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  const { plan } = planPrototypeImport(exportJson, { trainerId: alice.trainerId, includeSession: true });
  await runImport(plan, pgliteSink(db));
  gymId = plan.gym.id;
});

describe('saving an edited layout', () => {
  it('saving the layout exactly as loaded changes nothing', async () => {
    const before = await loadLayout(alice.userId);
    await save(alice.userId, before);
    expect(await loadLayout(alice.userId)).toEqual(before);
  });

  it('saves moved and resized zones, a renamed machine and a moved machine, and keeps every id', async () => {
    const before = await loadLayout(alice.userId);
    const zone = before.zones.find(
      (z) => z.floor === before.floors[0]!.id && before.equipment.some((e) => e.zone === z.id),
    )!;
    const machine = before.equipment.find((e) => e.zone === zone.id)!;
    const other = before.zones.find((z) => z.floor === zone.floor && z.id !== zone.id)!;
    let l = moveZoneBy(before, zone.id, 30, 20, false);
    l = setZoneNumber(l, zone.id, 0, 'w', 260);
    l = setEquipmentZone(l, machine.id, other.id);
    l = {
      ...l,
      equipment: l.equipment.map((e) =>
        e.id === machine.id ? { ...e, name: 'Renamed machine', notes: 'new note' } : e,
      ),
    };
    await save(alice.userId, l);

    const after = await loadLayout(alice.userId);
    expect(after.zones.find((z) => z.id === zone.id)).toMatchObject({
      x: zone.x + 30,
      y: zone.y + 20,
      w: 260,
    });
    expect(after.equipment.find((e) => e.id === machine.id)).toMatchObject({
      name: 'Renamed machine',
      notes: 'new note',
      zone: other.id,
    });
    expect(after.zones.map((z) => z.id).sort()).toEqual(before.zones.map((z) => z.id).sort());
    expect(after.equipment.map((e) => e.id).sort()).toEqual(before.equipment.map((e) => e.id).sort());
  });

  it('adds a zone and a machine, and they come back as saved', async () => {
    const before = await loadLayout(alice.userId);
    const zoneId = crypto.randomUUID();
    const machineId = crypto.randomUUID();
    let l = addZone(before, before.floors[0]!.id, zoneId, false);
    l = addEquipment(l, { id: machineId, name: 'Hack squat', zoneId, type: 'machine', muscle: 'legs' });
    await save(alice.userId, l);
    const after = await loadLayout(alice.userId);
    expect(after.zones).toHaveLength(before.zones.length + 1);
    expect(after.zones.find((z) => z.id === zoneId)).toMatchObject({
      name: 'New zone',
      cat: 'strength',
      w: 200,
      h: 140,
    });
    expect(after.equipment.find((e) => e.id === machineId)).toMatchObject({
      name: 'Hack squat',
      zone: zoneId,
      muscles: ['legs'],
    });
  });

  it('deleting a machine removes its exercise links, but history, templates and programmes keep their rows', async () => {
    const before = await loadLayout(alice.userId);
    const machine = before.equipment[0]!;
    // a history step and a template item that point at the machine
    await db.query("insert into runs (id, trainer_id, title, total_ms) values ($1,$2,'Old run',1000)", [
      crypto.randomUUID(),
      alice.trainerId,
    ]);
    const run = (await db.query<{ id: string }>("select id from runs where title = 'Old run'")).rows[0]!.id;
    await db.query(
      "insert into run_steps (run_id, n, equipment_id, machine, exercise_name) values ($1,1,$2,'Kept name','Squat')",
      [run, machine.id],
    );
    const links = (
      await db.query<{ n: number }>(
        'select count(*)::int as n from exercise_equipment where equipment_id = $1',
        [machine.id],
      )
    ).rows[0]!.n;
    expect(links).toBeGreaterThan(0);

    await save(alice.userId, deleteEquipment(before, machine.id));

    expect(
      (await db.query('select * from exercise_equipment where equipment_id = $1', [machine.id])).rows,
    ).toHaveLength(0);
    const step = (
      await db.query<{ equipment_id: string | null; machine: string }>(
        'select equipment_id, machine from run_steps where run_id = $1',
        [run],
      )
    ).rows[0]!;
    expect(step).toEqual({ equipment_id: null, machine: 'Kept name' });
    expect((await loadLayout(alice.userId)).equipment.find((e) => e.id === machine.id)).toBeUndefined();
  });

  it('machines that stay keep their exercise links', async () => {
    const l = await loadLayout(alice.userId);
    const keep = l.equipment[0]!;
    const before = (
      await db.query<{ n: number }>(
        'select count(*)::int as n from exercise_equipment where equipment_id = $1',
        [keep.id],
      )
    ).rows[0]!.n;
    await save(alice.userId, moveEquipment(l, keep.id, keep.x + 5, keep.y + 5));
    expect(
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from exercise_equipment where equipment_id = $1',
          [keep.id],
        )
      ).rows[0]!.n,
    ).toBe(before);
  });

  it('deleting a zone deletes its machines; joined-zone parts are replaced', async () => {
    const l = await loadLayout(alice.userId);
    const target = l.zones.find((z) => l.equipment.some((e) => e.zone === z.id))!;
    const { layout, removedMachines } = deleteZone(l, target.id);
    expect(removedMachines).toBeGreaterThan(0);
    await save(alice.userId, layout);
    const after = await loadLayout(alice.userId);
    expect(after.zones.find((z) => z.id === target.id)).toBeUndefined();
    expect(after.equipment.filter((e) => e.zone === target.id)).toHaveLength(0);

    const z = after.zones[0]!;
    const joined: Layout = {
      ...after,
      zones: after.zones.map((q) =>
        q.id === z.id
          ? {
              ...q,
              parts: [
                { x: q.x + q.w, y: q.y, w: 80, h: 60 },
                { x: q.x, y: q.y + q.h, w: 50, h: 40 },
              ],
            }
          : q,
      ),
    };
    await save(alice.userId, joined);
    expect((await loadLayout(alice.userId)).zones.find((q) => q.id === z.id)!.parts).toHaveLength(2);
    await save(alice.userId, {
      ...joined,
      zones: joined.zones.map((q) =>
        q.id === z.id ? { ...q, parts: [{ x: q.x + q.w, y: q.y, w: 90, h: 60 }] } : q,
      ),
    });
    expect((await loadLayout(alice.userId)).zones.find((q) => q.id === z.id)!.parts).toEqual([
      { x: z.x + z.w, y: z.y, w: 90, h: 60 },
    ]);
  });

  it('saves architecture and floors: add a wall and a floor, turn a lift, then delete the floor', async () => {
    const l = await loadLayout(alice.userId);
    const f0 = l.floors[0]!.id;
    let next = addStruct(l, 'wall', f0, crypto.randomUUID(), false);
    next = addStruct(next, 'lift', f0, 'aaaaaaaa-0000-4000-8000-000000000001', false);
    next = rotateStruct(next, 'aaaaaaaa-0000-4000-8000-000000000001', f0);
    const floorId = crypto.randomUUID();
    next = addFloor(next, floorId, f0);
    await save(alice.userId, next);
    const after = await loadLayout(alice.userId);
    expect(after.floors).toHaveLength(l.floors.length + 1);
    expect(after.structs.some((q) => q.type === 'wall')).toBe(true);
    const lift = after.structs.find((q) => q.id === 'aaaaaaaa-0000-4000-8000-000000000001')!;
    expect(lift.shared).toBe(true);
    const gone = deleteFloor(after, after.floors[1]!.id);
    await save(alice.userId, gone.layout);
    const last = await loadLayout(alice.userId);
    expect(last.floors).toHaveLength(after.floors.length - 1);
    expect(last.zones.every((z) => last.floors.some((f) => f.id === z.floor))).toBe(true);
  });

  it('is all or nothing: one bad row stops the whole save', async () => {
    const before = await loadLayout(alice.userId);
    const tooSmall: Layout = {
      ...moveZoneBy(before, before.zones[0]!.id, 100, 100, false),
      zones: before.zones.map((z, i) => ({ ...z, x: z.x + 100, w: i === 1 ? 20 : z.w })), // zone 2 is 20 wide: below the 60 minimum
    };
    expect(
      await failsAs(db, alice.userId, 'select public.save_gym_layout($1, $2::json)', [
        gymId,
        JSON.stringify(layoutSavePayload(tooSmall)),
      ]),
    ).toMatch(/check constraint/);
    expect(await loadLayout(alice.userId)).toEqual(before);
  });

  it('refuses a layout with no floors, and one that points at something missing', async () => {
    const l = await loadLayout(alice.userId);
    const noFloors = JSON.stringify({ ...layoutSavePayload(l), floors: [] });
    expect(
      await failsAs(db, alice.userId, 'select public.save_gym_layout($1, $2::json)', [gymId, noFloors]),
    ).toMatch(/at least one floor/);
    const orphan = JSON.stringify({
      ...layoutSavePayload(l),
      equipment: [{ ...layoutSavePayload(l).equipment[0]!, zone_id: crypto.randomUUID() }],
    });
    expect(
      await failsAs(db, alice.userId, 'select public.save_gym_layout($1, $2::json)', [gymId, orphan]),
    ).toMatch(/not in the layout/);
    expect(await loadLayout(alice.userId)).toEqual(l);
  });

  it('bumps the gym’s updated time', async () => {
    const t0 = (
      await db.query<{ t: string }>('select updated_at::text as t from gyms where id = $1', [gymId])
    ).rows[0]!.t;
    await new Promise((r) => setTimeout(r, 20));
    await save(alice.userId, await loadLayout(alice.userId));
    const t1 = (
      await db.query<{ t: string }>('select updated_at::text as t from gyms where id = $1', [gymId])
    ).rows[0]!.t;
    expect(t1 > t0).toBe(true);
  });
});

describe('only the owner can save a layout', () => {
  it('another trainer cannot save to the gym, whatever they send', async () => {
    const l = await loadLayout(alice.userId);
    expect(
      await failsAs(db, bob.userId, 'select public.save_gym_layout($1, $2::json)', [
        gymId,
        JSON.stringify(layoutSavePayload(l)),
      ]),
    ).toMatch(/not found/);
    const wiped = JSON.stringify({ ...layoutSavePayload(l), zones: [], equipment: [], structs: [] });
    expect(
      await failsAs(db, bob.userId, 'select public.save_gym_layout($1, $2::json)', [gymId, wiped]),
    ).toMatch(/not found/);
    expect(await loadLayout(alice.userId)).toEqual(l);
  });

  it('cannot take over someone else’s rows by reusing their ids in a gym of their own', async () => {
    const mine = await loadLayout(alice.userId);
    const bobGym = (
      await asUser(db, bob.userId, (q) =>
        q<{ id: string }>("insert into gyms (trainer_id, name) values ($1,'Bob Gym') returning id", [
          bob.trainerId,
        ]),
      )
    )[0]!.id;
    // Bob's layout reuses Alice's floor, zone and machine ids
    const stolen = JSON.stringify(layoutSavePayload(mine));
    await expect(
      asUser(db, bob.userId, (q) => q('select public.save_gym_layout($1, $2::json)', [bobGym, stolen])),
    ).rejects.toThrow();
    expect(await loadLayout(alice.userId)).toEqual(mine);
    expect((await db.query('select * from floors where gym_id = $1', [bobGym])).rows).toHaveLength(0);
  });

  it('a visitor who is not logged in cannot call it at all', async () => {
    await expect(
      asAnon(db, (q) => q('select public.save_gym_layout($1, $2::json)', [gymId, '{}'])),
    ).rejects.toThrow(/permission denied/);
  });
});
