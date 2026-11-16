import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { REPO_ROOT, asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
let dan: TestUser;
let danC = '';
let eveC = '';
let noMailC = '';
let bobC = '';
const NOW = '2026-12-01T05:00:00Z';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));
const asService = <T = Json>(sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (await tx.query<T>(sql, params)).rows;
  });
const claim = async (now = NOW) =>
  (await asService<{ r: Json[] }>('select public.claim_due_reminders($1::timestamptz) as r', [now]))[0]!.r;
const at = (hoursFromNow: number) => new Date(Date.parse(NOW) + hoursFromNow * 3600000).toISOString();
const book = async (
  trainer: TestUser,
  client: string,
  startsHours: number,
  extra: { status?: string; response?: string; title?: string } = {},
) =>
  (
    await db.query<{ id: string }>(
      "insert into bookings (trainer_id, client_id, starts_at, ends_at, status, client_response, title) values ($1,$2,$3::timestamptz,$3::timestamptz + interval '1 hour',$4,$5,$6) returning id",
      [
        trainer.trainerId,
        client,
        at(startsHours),
        extra.status ?? 'scheduled',
        extra.response ?? 'pending',
        extra.title ?? 'Training session',
      ],
    )
  ).rows[0]!.id;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  const mk = async (t: TestUser, name: string, email: string) =>
    (
      await db.query<{ id: string }>(
        'insert into clients (trainer_id, name, email) values ($1,$2,$3) returning id',
        [t.trainerId, name, email],
      )
    ).rows[0]!.id;
  danC = await mk(alice, 'Dan Dillon', 'dan@example.com');
  eveC = await mk(alice, 'Eve Evans', 'eve@example.com');
  noMailC = await mk(alice, 'No Mail', '');
  bobC = await mk(bob, 'Zed', 'z@example.com');
  await db.query(
    "update trainers set business_name = 'Alice Fitness', contact_phone = '082 111 2222' where id = $1",
    [alice.trainerId],
  );
  await db.query(
    "insert into gyms (trainer_id, name, branch, address) values ($1,'Virgin Active','Bedfordview','1 Main Rd')",
    [alice.trainerId],
  );
  await q(
    alice,
    "insert into client_invites (trainer_id, client_id, email) values ($1,$2,'dan@example.com')",
    [alice.trainerId, danC],
  );
  await q(dan, 'select public.portal_overview()');
});

describe('who gets a reminder', () => {
  it('nobody until the trainer switches reminders on', async () => {
    await book(alice, danC, 20);
    expect(await claim()).toEqual([]);
  });

  it('sessions inside the window get one, with just what the email needs', async () => {
    await db.query('update trainers set session_reminders = true, reminder_hours = 24 where id = $1', [
      alice.trainerId,
    ]);
    const r = await claim();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      client_name: 'Dan Dillon',
      client_email: 'dan@example.com',
      trainer: 'Alice Fitness',
      trainer_phone: '082 111 2222',
      title: 'Training session',
    });
    expect(Object.keys(r[0]!).sort()).toEqual([
      'client_email',
      'client_name',
      'ends_at',
      'gym',
      'gym_address',
      'id',
      'starts_at',
      'title',
      'trainer',
      'trainer_phone',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/notes|private|goals/);
  });

  it('is claimed once: a second run finds nothing, and concurrent runs cannot both take it', async () => {
    expect(await claim()).toEqual([]);
    const id = await book(alice, eveC, 10);
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.length + b.length).toBe(1);
    expect(
      (await db.query<Json>('select reminder_sent_at from bookings where id = $1', [id])).rows[0]!
        .reminder_sent_at,
    ).not.toBeNull();
  });

  it('leaves out sessions too far away, about to start, already past, cancelled, missed, or that the client declined', async () => {
    await book(alice, danC, 30);
    await book(alice, danC, 0.25);
    await book(alice, danC, -3);
    await book(alice, danC, 8, { status: 'cancelled' });
    await book(alice, danC, 9, { status: 'no_show' });
    await book(alice, danC, 11, { response: 'declined' });
    expect(await claim()).toEqual([]);
  });

  it('reminds again once the day gets close enough', async () => {
    const r = await claim(at(7));
    expect(r.map((x) => x.client_name)).toEqual(['Dan Dillon']);
  });

  it('skips a client with no email address, and a client who turned reminders off', async () => {
    await book(alice, noMailC, 12);
    expect(await claim(at(40))).toEqual([]);
    await db.query('update clients set reminders_off = true where id = $1', [danC]);
    await book(alice, danC, 50);
    expect(await claim(at(40))).toEqual([]);
    await db.query('update clients set reminders_off = false where id = $1', [danC]);
  });

  it('uses each trainer’s own window and on/off', async () => {
    await book(bob, bobC, 20);
    expect(await claim(at(5))).toEqual([]);
    await db.query('update trainers set session_reminders = true, reminder_hours = 2 where id = $1', [
      bob.trainerId,
    ]);
    expect(await claim(at(5))).toEqual([]);
    await db.query('update trainers set reminder_hours = 72 where id = $1', [bob.trainerId]);
    expect((await claim(at(5)))[0]!.client_name).toBe('Zed');
  });

  it('moving a session makes it eligible again; failing to send gives it back', async () => {
    const id = await book(alice, eveC, 100);
    expect(await claim(at(70))).toEqual([]);
    await db.query('update bookings set reminder_sent_at = now() where id = $1', [id]);
    await db.query(
      "update bookings set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1",
      [id],
    );
    expect(
      (await db.query<Json>('select reminder_sent_at from bookings where id = $1', [id])).rows[0]!
        .reminder_sent_at,
    ).toBeNull();
    const first = await claim(at(90));
    expect(first).toHaveLength(1);
    await asService('select public.release_reminder($1)', [id]);
    expect(await claim(at(90))).toHaveLength(1);
  });

  it('only the scheduler can ask: not a trainer, a client or a visitor', async () => {
    for (const u of [alice, dan])
      expect(await failsAs(db, u.userId, 'select public.claim_due_reminders()')).toMatch(/permission denied/);
    expect(await failsAs(db, alice.userId, 'select public.release_reminder(gen_random_uuid())')).toMatch(
      /permission denied/,
    );
    const err = await asAnon(db, async (run) =>
      run('select public.claim_due_reminders()').then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('the trainer’s settings reject nonsense', async () => {
    for (const set of ['reminder_hours = 0', 'reminder_hours = 100'])
      expect(
        await failsAs(db, alice.userId, `update trainers set ${set} where id = $1`, [alice.trainerId]),
        set,
      ).not.toBeNull();
  });
});

describe('the client’s own choice', () => {
  it('sees where reminders stand for each trainer', async () => {
    const r = (await q<{ r: Json[] }>(dan, 'select public.portal_reminder_prefs() as r'))[0]!.r;
    expect(r).toEqual([
      {
        client_id: danC,
        trainer: 'Alice Fitness',
        trainer_sends: true,
        hours: 24,
        has_email: true,
        on: true,
      },
    ]);
  });

  it('turns them off and on for themselves only', async () => {
    const set = (id: string, on: boolean | null) =>
      q<{ ok: boolean }>(dan, 'select public.portal_set_reminders($1, $2) as ok', [id, on]).then(
        (x) => x[0]!.ok,
      );
    expect(await set(danC, false)).toBe(true);
    expect(
      (await db.query<Json>('select reminders_off from clients where id = $1', [danC])).rows[0]!
        .reminders_off,
    ).toBe(true);
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_reminder_prefs() as r'))[0]!.r[0]!.on).toBe(
      false,
    );
    expect(await set(danC, true)).toBe(true);
    expect(await set(eveC, false)).toBe(false);
    expect(await set(danC, null)).toBe(false);
    expect(
      (await db.query<Json>('select reminders_off from clients where id = $1', [eveC])).rows[0]!
        .reminders_off,
    ).toBe(false);
  });

  it('loses it all when access is switched off, and visitors cannot call it', async () => {
    await q(alice, 'update client_accounts set revoked_at = now() where client_id = $1', [danC]);
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_reminder_prefs() as r'))[0]!.r).toEqual([]);
    expect(
      (await q<{ ok: boolean }>(dan, 'select public.portal_set_reminders($1, false) as ok', [danC]))[0]!.ok,
    ).toBe(false);
    for (const sql of [
      'select public.portal_reminder_prefs()',
      'select public.portal_set_reminders(gen_random_uuid(), true)',
    ]) {
      const err = await asAnon(db, async (run) =>
        run(sql).then(
          () => null,
          (e: Error) => e.message,
        ),
      );
      expect(err, sql).toMatch(/permission denied/);
    }
  });

  it('the migration can be run a second time', async () => {
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261125090000_session_reminders.sql'), 'utf8'),
    );
  });
});
