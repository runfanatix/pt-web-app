import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { REPO_ROOT, asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
let aliceEq = '';
let bobEq = '';
let shared = '';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));

async function machine(trainer: TestUser, name: string): Promise<string> {
  const g = (
    await db.query<{ id: string }>("insert into gyms (trainer_id, name) values ($1,'G') returning id", [
      trainer.trainerId,
    ])
  ).rows[0]!.id;
  const f = (
    await db.query<{ id: string }>(
      "insert into floors (gym_id, name, w, h, position) values ($1,'F',1000,620,0) returning id",
      [g],
    )
  ).rows[0]!.id;
  const z = (
    await db.query<{ id: string }>(
      "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Z','strength',0,0,100,100) returning id",
      [f],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      "insert into equipment (zone_id, name, type, x, y) values ($1,$2,'machine',10,10) returning id",
      [z, name],
    )
  ).rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  aliceEq = await machine(alice, 'Alice press');
  bobEq = await machine(bob, 'Bob press');
  shared = (
    await db.query<{ id: string }>(
      "insert into exercises (trainer_id, name, muscles) values (null, 'Bench press', array['chest']) returning id",
    )
  ).rows[0]!.id;
});

describe('the exercise library in the database', () => {
  it('a trainer adds their own exercise with a demo link', async () => {
    const r = await q<{ id: string }>(
      alice,
      "insert into exercises (trainer_id, name, muscles, level, sets, reps, rest, cue, link) values ($1,'Hack squat',array['legs','glutes'],'I',3,'10',90,'Heels down','https://youtu.be/abc') returning id",
      [alice.trainerId],
    );
    expect(r).toHaveLength(1);
    expect((await q(alice, "select link, level from exercises where name = 'Hack squat'"))[0]).toMatchObject({
      link: 'https://youtu.be/abc',
      level: 'I',
    });
  });

  it('only http and https links are allowed, and not too long', async () => {
    for (const link of [
      'javascript:alert(1)',
      'ftp://x.co/a',
      'youtube.com/x',
      'https://has space.com',
      'https://' + 'a'.repeat(300),
    ])
      expect(
        await failsAs(
          db,
          alice.userId,
          "insert into exercises (trainer_id, name, link) values ($1,'Bad',$2)",
          [alice.trainerId, link],
        ),
        link,
      ).not.toBeNull();
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into exercises (trainer_id, name, link) values ($1,'Fine','http://x.co/a')",
        [alice.trainerId],
      ),
    ).toBeNull();
  });

  it('everyone can read the shared exercises but nobody can change or delete them from the app', async () => {
    expect(await q(bob, 'select name from exercises where id = $1', [shared])).toHaveLength(1);
    await q(alice, "update exercises set name = 'Hacked' where id = $1", [shared]);
    await q(alice, 'delete from exercises where id = $1', [shared]);
    expect((await db.query<Json>('select name from exercises where id = $1', [shared])).rows[0]!.name).toBe(
      'Bench press',
    );
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into exercises (trainer_id, name) values (null, 'Sneaky shared')",
      ),
    ).not.toBeNull();
  });

  it('a trainer cannot see, change or delete another trainer’s exercises', async () => {
    expect(await q(bob, "select 1 from exercises where name = 'Hack squat'")).toHaveLength(0);
    await q(bob, "update exercises set name = 'Mine now' where name = 'Hack squat'");
    await q(bob, "delete from exercises where name = 'Hack squat'");
    expect((await db.query<Json>("select 1 from exercises where name = 'Hack squat'")).rows).toHaveLength(1);
    expect(
      await failsAs(db, bob.userId, "insert into exercises (trainer_id, name) values ($1,'Forged')", [
        alice.trainerId,
      ]),
    ).not.toBeNull();
  });

  it('a trainer links a shared exercise or their own to their own machines, never to someone else’s', async () => {
    const own = (await db.query<{ id: string }>("select id from exercises where name = 'Hack squat'"))
      .rows[0]!.id;
    await q(alice, 'insert into exercise_equipment (exercise_id, equipment_id) values ($1,$2), ($3,$2)', [
      shared,
      aliceEq,
      own,
    ]);
    expect(await q(alice, 'select 1 from exercise_equipment')).toHaveLength(2);
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into exercise_equipment (exercise_id, equipment_id) values ($1,$2)',
        [own, bobEq],
      ),
    ).not.toBeNull();
    // bob cannot link alice's own exercise to his machine
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into exercise_equipment (exercise_id, equipment_id) values ($1,$2)',
        [own, bobEq],
      ),
    ).not.toBeNull();
    expect(await q(bob, 'select 1 from exercise_equipment')).toHaveLength(0);
  });

  it('removing a link and deleting an exercise work, and deleting an exercise takes its links', async () => {
    const own = (await db.query<{ id: string }>("select id from exercises where name = 'Hack squat'"))
      .rows[0]!.id;
    await q(alice, 'delete from exercise_equipment where exercise_id = $1 and equipment_id = $2', [
      shared,
      aliceEq,
    ]);
    expect(await q(alice, 'select 1 from exercise_equipment')).toHaveLength(1);
    await q(alice, 'delete from exercises where id = $1', [own]);
    expect((await db.query('select 1 from exercise_equipment')).rows).toHaveLength(0);
  });

  it('a visitor who is not signed in sees nothing', async () => {
    const err = await asAnon(db, async (run) =>
      run('select * from exercises').then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('the migration can be run a second time', async () => {
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261126090000_exercise_link.sql'), 'utf8'),
    );
  });
});
