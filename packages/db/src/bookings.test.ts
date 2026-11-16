import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { REPO_ROOT, asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
let dan: TestUser;
let danClient = '';
let bobClient = '';
let aliceGym = '';
const SECRET = 'knee injury, go easy';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));
const inDays = (d: number, h = 9) => {
  const t = new Date(Date.now() + d * 86400000);
  t.setUTCHours(h, 0, 0, 0);
  return t.toISOString();
};
const add = (u: TestUser, client: string | null, starts: string, ends: string, extra: Json = {}) =>
  q<{ id: string }>(
    u,
    'insert into bookings (trainer_id, client_id, gym_id, starts_at, ends_at, notes, series_id) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [u.trainerId, client, extra.gym ?? null, starts, ends, extra.notes ?? '', extra.series ?? null],
  ).then((r) => r[0]!.id);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  danClient = (
    await db.query<{ id: string }>(
      "insert into clients (trainer_id, name, email) values ($1,'Dan','dan@example.com') returning id",
      [alice.trainerId],
    )
  ).rows[0]!.id;
  bobClient = (
    await db.query<{ id: string }>(
      "insert into clients (trainer_id, name, email) values ($1,'Zed','z@example.com') returning id",
      [bob.trainerId],
    )
  ).rows[0]!.id;
  aliceGym = (
    await db.query<{ id: string }>(
      "insert into gyms (trainer_id, name, branch, address) values ($1,'Virgin Active','Bedfordview','1 Main Rd') returning id",
      [alice.trainerId],
    )
  ).rows[0]!.id;
  await q(
    alice,
    "insert into client_invites (trainer_id, client_id, email) values ($1,$2,'dan@example.com')",
    [alice.trainerId, danClient],
  );
  await q(dan, 'select public.portal_overview()');
});

describe('a trainer’s bookings', () => {
  it('books a session for their own client at their own gym', async () => {
    const id = await add(alice, danClient, inDays(2), inDays(2, 10), { gym: aliceGym, notes: SECRET });
    const r = await q(alice, 'select status, client_response, title, notes from bookings where id = $1', [
      id,
    ]);
    expect(r[0]).toMatchObject({
      status: 'scheduled',
      client_response: 'pending',
      title: 'Training session',
      notes: SECRET,
    });
  });

  it('a booking with no client (blocked time) is allowed', async () => {
    expect(await add(alice, null, inDays(3), inDays(3, 10))).toBeTruthy();
  });

  it('cannot book another trainer’s client or gym, nor for another trainer', async () => {
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into bookings (trainer_id, client_id, starts_at, ends_at) values ($1,$2,$3,$4)',
        [alice.trainerId, bobClient, inDays(1), inDays(1, 10)],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into bookings (trainer_id, gym_id, starts_at, ends_at) values ($1,$2,$3,$4)',
        [bob.trainerId, aliceGym, inDays(1), inDays(1, 10)],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into bookings (trainer_id, starts_at, ends_at) values ($1,$2,$3)',
        [alice.trainerId, inDays(1), inDays(1, 10)],
      ),
    ).not.toBeNull();
  });

  it('refuses a session that ends before it starts, or lasts over 12 hours, or has a bad status', async () => {
    for (const [s, e] of [
      [inDays(1, 10), inDays(1, 9)],
      [inDays(1, 6), inDays(1, 20)],
    ])
      expect(
        await failsAs(
          db,
          alice.userId,
          'insert into bookings (trainer_id, starts_at, ends_at) values ($1,$2,$3)',
          [alice.trainerId, s, e],
        ),
      ).not.toBeNull();
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into bookings (trainer_id, starts_at, ends_at, status) values ($1,$2,$3,'done')",
        [alice.trainerId, inDays(1), inDays(1, 10)],
      ),
    ).not.toBeNull();
  });

  it('another trainer sees none of it and cannot change or delete it', async () => {
    expect(await q(bob, 'select 1 from bookings')).toHaveLength(0);
    await q(bob, "update bookings set status = 'cancelled'");
    await q(bob, 'delete from bookings');
    expect(
      (await db.query('select 1 from bookings where status = $1', ['scheduled'])).rows.length,
    ).toBeGreaterThan(0);
  });

  it('a repeating series can be read together and cancelled from a date on', async () => {
    const series = crypto.randomUUID();
    for (let w = 0; w < 4; w++)
      await add(alice, danClient, inDays(10 + 7 * w), inDays(10 + 7 * w, 10), { series });
    await q(
      alice,
      "update bookings set status = 'cancelled', cancelled_by = 'trainer' where series_id = $1 and starts_at >= $2",
      [series, inDays(17)],
    );
    const r = await q(alice, 'select status from bookings where series_id = $1 order by starts_at', [series]);
    expect(r.map((x) => x.status)).toEqual(['scheduled', 'cancelled', 'cancelled', 'cancelled']);
  });

  it('deleting a client or a gym is handled: client bookings go, gym is just cleared', async () => {
    const c2 = (
      await db.query<{ id: string }>(
        "insert into clients (trainer_id, name) values ($1,'Temp') returning id",
        [alice.trainerId],
      )
    ).rows[0]!.id;
    const g2 = (
      await db.query<{ id: string }>(
        "insert into gyms (trainer_id, name) values ($1,'Temp gym') returning id",
        [alice.trainerId],
      )
    ).rows[0]!.id;
    const b1 = await add(alice, c2, inDays(5), inDays(5, 10));
    const b2 = await add(alice, null, inDays(5, 12), inDays(5, 13), { gym: g2 });
    await db.query('delete from clients where id = $1', [c2]);
    await db.query('delete from gyms where id = $1', [g2]);
    expect((await db.query('select 1 from bookings where id = $1', [b1])).rows).toHaveLength(0);
    expect(
      (await db.query<Json>('select gym_id from bookings where id = $1', [b2])).rows[0]!.gym_id,
    ).toBeNull();
  });
});

describe('what a client sees', () => {
  it('their own sessions with the gym and trainer, and never the trainer’s notes', async () => {
    const r = await q<{ r: Json[] }>(dan, 'select public.portal_bookings() as r');
    const list = r[0]!.r;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((b) => b.client_id === danClient)).toBe(true);
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(list[0]).toMatchObject({
      gym: 'Virgin Active Bedfordview',
      gym_address: '1 Main Rd',
      client_response: 'pending',
    });
    expect(list.map((b) => b.starts_at)).toEqual([...list.map((b) => b.starts_at)].sort());
  });

  it('does not include blocked time or another trainer’s clients', async () => {
    await add(bob, bobClient, inDays(2), inDays(2, 10));
    const list = (await q<{ r: Json[] }>(dan, 'select public.portal_bookings() as r'))[0]!.r;
    expect(list.every((b) => b.client_id === danClient)).toBe(true);
  });

  it('can confirm or decline an upcoming session, and the trainer sees the answer', async () => {
    const id = (
      await q<{ id: string }>(
        alice,
        "select id from bookings where client_id = $1 and status = 'scheduled' order by starts_at limit 1",
        [danClient],
      )
    )[0]!.id;
    const respond = (r: string, b = id) =>
      q<{ ok: boolean }>(dan, 'select public.portal_respond_booking($1, $2) as ok', [b, r]).then(
        (x) => x[0]!.ok,
      );
    expect(await respond('confirmed')).toBe(true);
    expect(
      (await q(alice, 'select client_response from bookings where id = $1', [id]))[0]!.client_response,
    ).toBe('confirmed');
    expect(await respond('declined')).toBe(true);
    expect(
      (await q(alice, 'select client_response from bookings where id = $1', [id]))[0]!.client_response,
    ).toBe('declined');
    expect(await respond('whatever')).toBe(false);
  });

  it('cannot answer for someone else’s session, a past one, or a cancelled one', async () => {
    const bobs = (await q<{ id: string }>(bob, 'select id from bookings limit 1'))[0]!.id;
    expect(
      (
        await q<{ ok: boolean }>(dan, "select public.portal_respond_booking($1, 'confirmed') as ok", [bobs])
      )[0]!.ok,
    ).toBe(false);
    const past = await add(alice, danClient, inDays(-2), inDays(-2, 10));
    expect(
      (
        await q<{ ok: boolean }>(dan, "select public.portal_respond_booking($1, 'confirmed') as ok", [past])
      )[0]!.ok,
    ).toBe(false);
    const cancelled = (
      await q<{ id: string }>(
        alice,
        "select id from bookings where status = 'cancelled' and client_id = $1 limit 1",
        [danClient],
      )
    )[0]!.id;
    expect(
      (
        await q<{ ok: boolean }>(dan, "select public.portal_respond_booking($1, 'confirmed') as ok", [
          cancelled,
        ])
      )[0]!.ok,
    ).toBe(false);
  });

  it('has no direct table access, and anonymous visitors cannot call the functions', async () => {
    expect(await q(dan, 'select 1 from bookings')).toHaveLength(0);
    expect(await failsAs(db, dan.userId, "update bookings set status = 'cancelled'")).toBeNull();
    expect(
      (
        await db.query('select 1 from bookings where status = $1 and client_id = $2', [
          'cancelled',
          danClient,
        ])
      ).rows.length,
    ).toBe(3);
    for (const sql of [
      'select public.portal_bookings()',
      "select public.portal_respond_booking(gen_random_uuid(), 'confirmed')",
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

  it('loses sight of everything once access is switched off', async () => {
    await q(alice, 'update client_accounts set revoked_at = now() where client_id = $1', [danClient]);
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_bookings() as r'))[0]!.r).toEqual([]);
  });

  it('the migration can be run a second time', async () => {
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261122090000_bookings.sql'), 'utf8'),
    );
  });
});
