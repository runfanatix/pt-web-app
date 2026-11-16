import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { planPrototypeImport, runImport } from '@pt/core';
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
let dan: TestUser;
let eve: TestUser;
let aliceGym = '';
let machineHere = '';
let machineElsewhere = '';
let danClient = '';
let eveClient = '';
let progDan = '';
let progEve = '';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (q) => q<{ r: T }>(sql, params)).then((rows) => rows[0]!.r);

const run = (id: string, over: Json = {}) => ({
  id,
  title: 'My workout',
  run_date: '2026-11-21',
  started_at: '2026-11-21T07:00:00Z',
  total_ms: 600_000,
  planned_min: 12,
  steps: [
    {
      n: 1,
      equipment_id: machineHere,
      machine: 'Press',
      zone: 'Strength',
      exercise_name: 'Chest press',
      sets: 3,
      reps: '10',
      rest: 60,
      ms: 300_000,
      done: true,
      step_order: 1,
    },
    {
      n: 2,
      equipment_id: machineElsewhere,
      machine: 'Other',
      zone: '',
      exercise_name: 'Squat',
      sets: 3,
      reps: '8',
      rest: 60,
      ms: 0,
      done: false,
      step_order: 0,
    },
  ],
  ...over,
});
const save = (u: TestUser, prog: string, r: Json) =>
  call<string | null>(u, 'select public.portal_save_run($1, $2::json) as r', [prog, JSON.stringify(r)]);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  eve = await createUser(db, 'eve@example.com', { role: 'client' });
  const { plan } = planPrototypeImport(exportJson, { trainerId: alice.trainerId });
  await runImport(plan, pgliteSink(db));
  aliceGym = plan.gym.id;
  machineHere = (
    await db.query<{ id: string }>(
      'select e.id from equipment e join zones z on z.id = e.zone_id join floors f on f.id = z.floor_id where f.gym_id = $1 limit 1',
      [aliceGym],
    )
  ).rows[0]!.id;
  // a machine in someone else's gym
  const bobGym = (
    await db.query<{ id: string }>("insert into gyms (trainer_id, name) values ($1, 'Bobs') returning id", [
      bob.trainerId,
    ])
  ).rows[0]!.id;
  const fl = (
    await db.query<{ id: string }>(
      "insert into floors (gym_id, name, w, h, position) values ($1, 'G', 1000, 620, 0) returning id",
      [bobGym],
    )
  ).rows[0]!.id;
  const zn = (
    await db.query<{ id: string }>(
      "insert into zones (floor_id, name, category, x, y, w, h) values ($1, 'Z', 'strength', 0, 0, 100, 100) returning id",
      [fl],
    )
  ).rows[0]!.id;
  machineElsewhere = (
    await db.query<{ id: string }>(
      "insert into equipment (zone_id, name, type, x, y) values ($1, 'Bobs bench', 'machine', 10, 10) returning id",
      [zn],
    )
  ).rows[0]!.id;

  danClient = (
    await db.query<{ id: string }>(
      "insert into clients (trainer_id, name, email) values ($1, 'Dan', 'dan@example.com') returning id",
      [alice.trainerId],
    )
  ).rows[0]!.id;
  eveClient = (
    await db.query<{ id: string }>(
      "insert into clients (trainer_id, name, email) values ($1, 'Eve', 'eve@example.com') returning id",
      [alice.trainerId],
    )
  ).rows[0]!.id;
  progDan = (
    await db.query<{ id: string }>(
      "insert into programmes (client_id, gym_id, title) values ($1, $2, 'Dan plan') returning id",
      [danClient, aliceGym],
    )
  ).rows[0]!.id;
  progEve = (
    await db.query<{ id: string }>(
      "insert into programmes (client_id, gym_id, title) values ($1, $2, 'Eve plan') returning id",
      [eveClient, aliceGym],
    )
  ).rows[0]!.id;
  await asUser(db, alice.userId, (q) =>
    q(
      "insert into client_invites (trainer_id, client_id, email) values ($1,$2,'dan@example.com'), ($1,$3,'eve@example.com')",
      [alice.trainerId, danClient, eveClient],
    ),
  );
  await call(dan, 'select public.portal_overview() as r');
  await call(eve, 'select public.portal_overview() as r');
});

describe('a client saves a workout', () => {
  const id = crypto.randomUUID();

  it('it lands in the trainer’s history for that client, marked as done by the client', async () => {
    expect(await save(dan, progDan, run(id))).toBe(id);
    const rows = await asUser(db, alice.userId, (q) =>
      q<Json>(
        'select client_id, trainer_id, by_client, client_name, gym_name, title, total_ms from runs where id = $1',
        [id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: danClient,
      trainer_id: alice.trainerId,
      by_client: true,
      client_name: 'Dan',
      total_ms: 600000,
    });
    expect(rows[0]!.gym_name).toMatch(/Virgin Active/);
    const steps = await asUser(db, alice.userId, (q) =>
      q<Json>('select n, done, equipment_id from run_steps where run_id = $1 order by n', [id]),
    );
    expect(steps.map((s) => s.done)).toEqual([true, false]);
  });

  it('a machine that is not in the programme’s own gym is not linked', async () => {
    const steps = await asUser(db, alice.userId, (q) =>
      q<Json>('select n, equipment_id from run_steps where run_id = $1 order by n', [id]),
    );
    expect(steps[0]!.equipment_id).toBe(machineHere);
    expect(steps[1]!.equipment_id).toBeNull();
  });

  it('saving the same id again replaces the earlier save (finish, undo, finish)', async () => {
    expect(await save(dan, progDan, run(id, { total_ms: 900_000 }))).toBe(id);
    const rows = await asUser(db, alice.userId, (q) =>
      q<Json>('select total_ms from runs where id = $1', [id]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_ms).toBe(900000);
    expect(
      await asUser(db, alice.userId, (q) => q('select 1 from run_steps where run_id = $1', [id])),
    ).toHaveLength(2);
  });

  it('keeps the client’s record for five years after the workout', async () => {
    const r = await asUser(db, alice.userId, (q) =>
      q<Json>('select retention_until from clients where id = $1', [danClient]),
    );
    expect(String(r[0]!.retention_until)).toContain('2031');
  });

  it('cannot save to someone else’s programme, or use someone else’s run id', async () => {
    expect(await save(dan, progEve, run(crypto.randomUUID()))).toBeNull();
    expect(await save(eve, progDan, run(crypto.randomUUID()))).toBeNull();
    const trainerRun = crypto.randomUUID();
    await db.query("insert into runs (id, trainer_id, client_id, title) values ($1, $2, $3, 'Trainer run')", [
      trainerRun,
      alice.trainerId,
      danClient,
    ]);
    expect(await save(dan, progDan, run(trainerRun))).toBeNull();
    const eveRun = crypto.randomUUID();
    expect(await save(eve, progEve, run(eveRun))).toBe(eveRun);
    expect(await save(dan, progDan, run(eveRun))).toBeNull();
    expect((await db.query<Json>('select title from runs where id = $1', [trainerRun])).rows[0]!.title).toBe(
      'Trainer run',
    );
  });

  it('refuses a workout with more than 100 exercises, and clamps silly numbers', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      n: i,
      exercise_name: 'x',
      sets: 1,
      reps: '1',
      rest: 0,
      ms: 0,
      done: false,
      step_order: 0,
    }));
    expect(
      await failsAs(db, dan.userId, 'select public.portal_save_run($1, $2::json)', [
        progDan,
        JSON.stringify(run(crypto.randomUUID(), { steps: many })),
      ]),
    ).toMatch(/at most 100/);
    const wild = crypto.randomUUID();
    await save(
      dan,
      progDan,
      run(wild, {
        total_ms: 99_999_999_999,
        steps: [
          { n: 1, exercise_name: 'x', sets: 5000, reps: '1', rest: -5, ms: -1, done: true, step_order: 1 },
        ],
      }),
    );
    const r = await asUser(db, alice.userId, (q) =>
      q<Json>('select total_ms from runs where id = $1', [wild]),
    );
    expect(r[0]!.total_ms).toBe(86400000);
    const st = await asUser(db, alice.userId, (q) =>
      q<Json>('select sets, rest, ms from run_steps where run_id = $1', [wild]),
    );
    expect(st[0]).toMatchObject({ sets: 99, rest: 0, ms: 0 });
  });

  it('a visitor who is not signed in cannot call any of it', async () => {
    for (const sql of [
      `select public.portal_save_run('${progDan}', '{}'::json)`,
      'select public.portal_history()',
      `select public.portal_delete_run('${id}')`,
    ]) {
      const err = await asAnon(db, async (q) =>
        q(sql).then(
          () => null,
          (e: Error) => e.message,
        ),
      );
      expect(err, sql).toMatch(/permission denied/);
    }
  });
});

describe('a client’s workout history', () => {
  it('shows their own workouts, with the trainer’s too, and never another client’s', async () => {
    const h = await call<Json[]>(dan, 'select public.portal_history() as r');
    const titles = h.map((x) => x.title);
    expect(titles).toContain('My workout');
    expect(titles).toContain('Trainer run');
    expect(h.every((x) => x.client_id === danClient)).toBe(true);
    const mine = h.find((x) => x.title === 'My workout')!;
    expect(mine.by_client).toBe(true);
    expect(mine.trainer).toBeDefined();
    expect(mine.steps).toHaveLength(2);
    const eveH = await call<Json[]>(eve, 'select public.portal_history() as r');
    expect(eveH.every((x) => x.client_id === eveClient)).toBe(true);
    expect(JSON.stringify(eveH)).not.toContain('Trainer run');
  });

  it('is empty once the trainer switches access off', async () => {
    await asUser(db, alice.userId, (q) =>
      q('update client_accounts set revoked_at = now() where client_id = $1', [eveClient]),
    );
    expect(await call<Json[]>(eve, 'select public.portal_history() as r')).toEqual([]);
    expect(await save(eve, progEve, run(crypto.randomUUID()))).toBeNull();
  });
});

describe('deleting a workout', () => {
  it('a client can delete one they did themselves, but not one their trainer recorded, nor someone else’s', async () => {
    const mine = crypto.randomUUID();
    await save(dan, progDan, run(mine));
    const trainerRun = (await db.query<Json>("select id from runs where title = 'Trainer run'")).rows[0]!.id;
    const del = (u: TestUser, id: string) =>
      call<boolean>(u, 'select public.portal_delete_run($1) as r', [id]);
    expect(await del(dan, trainerRun)).toBe(false);
    expect(await del(eve, mine)).toBe(false);
    expect(await del(dan, mine)).toBe(true);
    expect((await db.query('select 1 from runs where id = $1', [mine])).rows).toHaveLength(0);
    expect((await db.query('select 1 from run_steps where run_id = $1', [mine])).rows).toHaveLength(0);
  });

  it('a client still cannot read or write the runs table directly', async () => {
    expect(await asUser(db, dan.userId, (q) => q('select 1 from runs'))).toHaveLength(0);
    expect(
      await failsAs(db, dan.userId, "insert into runs (trainer_id, client_id, title) values ($1, $2, 'x')", [
        alice.trainerId,
        danClient,
      ]),
    ).not.toBeNull();
  });

  it('the migration can be run a second time', async () => {
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261121090000_client_runs.sql'), 'utf8'),
    );
  });
});
