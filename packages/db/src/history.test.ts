import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { rowsFromEntry, type HistoryEntry } from '@pt/core';
import { asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
const ids = {} as Record<string, string>;

const entry = (): HistoryEntry => ({
  id: crypto.randomUUID(),
  clientId: null,
  clientName: 'Sam',
  coach: 'Dee',
  title: 'Leg day',
  date: '2026-11-15',
  startedAt: Date.UTC(2026, 10, 15, 7, 30),
  totalMs: 140_000,
  plannedMin: 8,
  doneN: 2,
  gymId: ids.gym!,
  gymName: 'Virgin Active Bedfordview',
  steps: [
    {
      n: 1,
      eid: ids.equip!,
      machine: 'Treadmill',
      zone: 'Cardio',
      exercise: 'Incline walk',
      sets: 1,
      reps: '8 min',
      rest: 0,
      ms: 65_000,
      done: true,
      order: 1,
    },
    {
      n: 2,
      eid: '',
      machine: 'Gone',
      zone: '',
      exercise: 'Leg press',
      sets: 3,
      reps: '10',
      rest: 60,
      ms: 15_000,
      done: false,
      order: 0,
    },
  ],
});

/** Saves an entry the way the app does: upsert the run, replace its steps. */
async function save(user: TestUser, e: HistoryEntry) {
  const { run, steps } = rowsFromEntry(user.trainerId, e);
  await asUser(db, user.userId, async (q) => {
    const cols = Object.keys(run);
    await q(
      `insert into runs (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})
       on conflict (id) do update set ${cols
         .filter((c) => c !== 'id')
         .map((c) => `${c} = excluded.${c}`)
         .join(', ')}`,
      cols.map((c) => (run as Record<string, unknown>)[c]),
    );
    await q('delete from run_steps where run_id = $1', [e.id]);
    for (const s of steps) {
      const sc = Object.keys(s);
      await q(
        `insert into run_steps (${sc.join(',')}) values (${sc.map((_, i) => '$' + (i + 1)).join(',')})`,
        sc.map((c) => (s as Record<string, unknown>)[c]),
      );
    }
  });
}

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  await asUser(db, alice.userId, async (q) => {
    ids.gym = (
      await q<{ id: string }>("insert into gyms (trainer_id, name) values ($1, 'Gym') returning id", [
        alice.trainerId,
      ])
    )[0]!.id;
    const f = (await q<{ id: string }>('insert into floors (gym_id) values ($1) returning id', [ids.gym]))[0]!
      .id;
    const z = (
      await q<{ id: string }>(
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Cardio','cardio',0,0,200,100) returning id",
        [f],
      )
    )[0]!.id;
    ids.equip = (
      await q<{ id: string }>(
        "insert into equipment (zone_id, name, type, x, y) values ($1,'Treadmill','cardio',10,10) returning id",
        [z],
      )
    )[0]!.id;
  });
});

describe('run history in the database', () => {
  it('a finished run is saved with its steps, and saving again replaces them (undo then re-finish)', async () => {
    const e = entry();
    await save(alice, e);
    const first = await asUser(db, alice.userId, (q) =>
      q<{ n: number }>('select count(*)::int as n from run_steps where run_id = $1', [e.id]),
    );
    expect(first[0]!.n).toBe(2);
    await save(alice, { ...e, totalMs: 200_000, steps: e.steps.slice(0, 1) });
    const rows = await asUser(db, alice.userId, (q) =>
      q<{ total_ms: string; steps: number }>(
        'select total_ms::text, (select count(*)::int from run_steps s where s.run_id = r.id) as steps from runs r where id = $1',
        [e.id],
      ),
    );
    expect(rows).toEqual([{ total_ms: '200000', steps: 1 }]);
    expect(
      (await asUser(db, alice.userId, (q) => q('select * from runs where id = $1', [e.id]))).length,
    ).toBe(1);
  });

  it("another trainer cannot see, add to or delete a trainer's runs", async () => {
    const e = entry();
    await save(alice, e);
    for (const table of ['runs', 'run_steps']) {
      expect(await asUser(db, bob.userId, (q) => q(`select * from ${table}`)), table).toHaveLength(0);
    }
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into run_steps (run_id, n, exercise_name) values ($1, 9, 'sneaky')",
        [e.id],
      ),
    ).toMatch(/row-level security/);
    expect(
      await failsAs(db, bob.userId, "insert into runs (trainer_id, title) values ($1, 'forged')", [
        alice.trainerId,
      ]),
    ).toMatch(/row-level security/);
    await asUser(db, bob.userId, (q) => q('delete from runs'));
    expect((await db.query('select * from runs where id = $1', [e.id])).rows).toHaveLength(1);
  });

  it("a run cannot point at another trainer's gym", async () => {
    const e = entry();
    const { run } = rowsFromEntry(bob.trainerId, e); // alice's gym id, bob's trainer id
    expect(
      await failsAs(db, bob.userId, 'insert into runs (id, trainer_id, gym_id, title) values ($1,$2,$3,$4)', [
        run.id,
        run.trainer_id,
        run.gym_id,
        run.title,
      ]),
    ).toMatch(/row-level security/);
  });

  it('history stays readable when the machine or the gym is later deleted', async () => {
    const e = entry();
    await save(alice, e);
    await asUser(db, alice.userId, async (q) => {
      await q('delete from equipment where id = $1', [ids.equip]);
      await q('delete from gyms where id = $1', [ids.gym]);
    });
    const run = await asUser(db, alice.userId, (q) =>
      q<{ gym_id: string | null; gym_name: string }>('select gym_id, gym_name from runs where id = $1', [
        e.id,
      ]),
    );
    expect(run).toEqual([{ gym_id: null, gym_name: 'Virgin Active Bedfordview' }]);
    const steps = await asUser(db, alice.userId, (q) =>
      q<{ equipment_id: string | null; machine: string }>(
        'select equipment_id, machine from run_steps where run_id = $1 order by n',
        [e.id],
      ),
    );
    expect(steps).toEqual([
      { equipment_id: null, machine: 'Treadmill' },
      { equipment_id: null, machine: 'Gone' },
    ]);
  });

  it('deleting a run removes its steps', async () => {
    const e = entry();
    e.gymId = null;
    e.steps.forEach((s) => (s.eid = '')); // the machine from the earlier tests is gone
    await save(alice, e);
    await asUser(db, alice.userId, (q) => q('delete from runs where id = $1', [e.id]));
    expect((await db.query('select * from run_steps where run_id = $1', [e.id])).rows).toHaveLength(0);
  });
});
