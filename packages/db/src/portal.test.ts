import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
let dan: TestUser; // signs in as a client
let stranger: TestUser;
let danAtAlice = '';
let danAtBob = '';
let eve = '';
let progAlice = '';
let progBob = '';
let progEve = '';

const SECRET = 'torn ACL and anxiety';
const GOALS = 'rebuild after surgery';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const overview = async (u: TestUser): Promise<Json> =>
  (await asUser(db, u.userId, (q) => q<{ r: Json }>('select public.portal_overview() as r')))[0]!.r;
const q = <T>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));

async function addClient(trainer: TestUser, name: string, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    'insert into clients (trainer_id, name, email, goals, private_notes) values ($1,$2,$3,$4,$5) returning id',
    [trainer.trainerId, name, email, GOALS, SECRET],
  );
  const id = r.rows[0]!.id;
  await db.query(
    "insert into consents (trainer_id, client_id, subject, purpose, notice_version, granted, wording) values ($1,$2,'client','privacy-notice','1.0',true,'w'), ($1,$2,'client','health-data','1.0',true,'w')",
    [trainer.trainerId, id],
  );
  return id;
}
async function addProgramme(clientId: string, title: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    'insert into programmes (client_id, title) values ($1,$2) returning id',
    [clientId, title],
  );
  await db.query(
    "insert into programme_items (programme_id, position, exercise_name) values ($1, 0, 'Squat')",
    [r.rows[0]!.id],
  );
  return r.rows[0]!.id;
}
const invite = (u: TestUser, clientId: string, email: string) =>
  q(u, 'insert into client_invites (trainer_id, client_id, email) values ($1,$2,$3)', [
    u.trainerId,
    clientId,
    email,
  ]);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  await db.query(
    "update trainers set business_name = 'Alice Fitness', contact_email = 'alice@fit.example' where id = $1",
    [alice.trainerId],
  );
  await db.query("update trainers set business_name = 'Bob Strength' where id = $1", [bob.trainerId]);
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  stranger = await createUser(db, 'stranger@example.com', { role: 'client' });
  danAtAlice = await addClient(alice, 'Dan Dillon', 'dan@example.com');
  danAtBob = await addClient(bob, 'Daniel D', 'dan@example.com');
  eve = await addClient(alice, 'Eve Evans', 'eve@example.com');
  progAlice = await addProgramme(danAtAlice, 'Alice plan');
  progBob = await addProgramme(danAtBob, 'Bob plan');
  progEve = await addProgramme(eve, 'Eve plan');
});

describe('who is a client', () => {
  it('a client sign-in does not become a trainer; an ordinary sign-up does', async () => {
    expect(dan.trainerId).toBe('');
    expect(alice.trainerId).not.toBe('');
    expect((await db.query('select 1 from trainers where user_id = $1', [dan.userId])).rows).toHaveLength(0);
  });

  it('with no invite there is nothing to see', async () => {
    const o = await overview(dan);
    expect(o.memberships).toEqual([]);
  });
});

describe('invites and claiming', () => {
  it('a trainer can invite only their own client, and only see their own invites', async () => {
    await invite(alice, danAtAlice, 'dan@example.com');
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into client_invites (trainer_id, client_id, email) values ($1,$2,$3)',
        [alice.trainerId, danAtBob, 'x@example.com'],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(
        db,
        bob.userId,
        'insert into client_invites (trainer_id, client_id, email) values ($1,$2,$3)',
        [bob.trainerId, danAtAlice, 'x@example.com'],
      ),
    ).not.toBeNull();
    expect(await q(bob, 'select 1 from client_invites')).toHaveLength(0);
    expect(await q(alice, 'select 1 from client_invites')).toHaveLength(1);
  });

  it('an invite email must be lower case and tidy', async () => {
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into client_invites (trainer_id, client_id, email) values ($1,$2,$3)',
        [alice.trainerId, eve, 'Eve@Example.com'],
      ),
    ).not.toBeNull();
  });

  it('someone else’s verified email does not claim the invite', async () => {
    expect((await overview(stranger)).memberships).toEqual([]);
  });

  it('an email that was never confirmed does not claim anything', async () => {
    await db.query('update auth.users set email_confirmed_at = null where id = $1', [dan.userId]);
    expect((await overview(dan)).memberships).toEqual([]);
    await db.query('update auth.users set email_confirmed_at = now() where id = $1', [dan.userId]);
  });

  it('the invited, verified person is linked to the client, and the invite is used up', async () => {
    const o = await overview(dan);
    expect(o.memberships).toHaveLength(1);
    expect(o.memberships[0].client_name).toBe('Dan Dillon');
    expect(o.memberships[0].trainer.business_name).toBe('Alice Fitness');
    expect(o.memberships[0].programmes.map((p: Json) => p.title)).toEqual(['Alice plan']);
    expect(o.memberships[0].programmes[0].exercises).toBe(1);
    const inv = await db.query<{ accepted_at: string | null }>('select accepted_at from client_invites');
    expect(inv.rows[0]!.accepted_at).not.toBeNull();
  });

  it('the same person can be a client of a second trainer too', async () => {
    await invite(bob, danAtBob, 'dan@example.com');
    const o = await overview(dan);
    expect(o.memberships.map((m: Json) => m.trainer.business_name).sort()).toEqual([
      'Alice Fitness',
      'Bob Strength',
    ]);
  });

  it('revoked and expired invites are not claimed', async () => {
    await invite(alice, eve, 'eve@example.com');
    await db.query('update client_invites set revoked_at = now() where client_id = $1', [eve]);
    await invite(alice, eve, 'eve@example.com');
    await db.query(
      "update client_invites set expires_at = now() - interval '1 day' where client_id = $1 and revoked_at is null",
      [eve],
    );
    const eveUser = await createUser(db, 'eve@example.com', { role: 'client' });
    expect((await overview(eveUser)).memberships).toEqual([]);
  });
});

describe('what a client can and cannot see', () => {
  it('the overview never contains private notes, goals, contact details of the client, or other clients', async () => {
    const text = JSON.stringify(await overview(dan));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(GOALS);
    expect(text).not.toContain('Eve');
    expect(text).not.toContain('Eve plan');
  });

  it('a client can open their own programme, with the plan, and nobody else’s', async () => {
    const own = await asUser(db, dan.userId, (run) =>
      run<{ r: Json }>('select public.portal_programme($1) as r', [progAlice]),
    );
    expect(own[0]!.r.title).toBe('Alice plan');
    expect(own[0]!.r.items).toHaveLength(1);
    const other = await asUser(db, dan.userId, (run) =>
      run<{ r: Json | null }>('select public.portal_programme($1) as r', [progEve]),
    );
    expect(other[0]!.r).toBeNull();
    const strangerView = await asUser(db, stranger.userId, (run) =>
      run<{ r: Json | null }>('select public.portal_programme($1) as r', [progAlice]),
    );
    expect(strangerView[0]!.r).toBeNull();
  });

  it('a client has no direct access to any table', async () => {
    for (const t of [
      'clients',
      'programmes',
      'programme_items',
      'consents',
      'client_accounts',
      'client_invites',
      'data_requests',
      'gyms',
      'trainers',
    ])
      expect(await q(dan, `select 1 from ${t}`), t).toHaveLength(0);
    expect(
      await failsAs(db, dan.userId, "update clients set name = 'x' where id = $1", [danAtAlice]),
    ).toBeNull();
    expect(
      (await db.query<{ name: string }>('select name from clients where id = $1', [danAtAlice])).rows[0]!
        .name,
    ).toBe('Dan Dillon');
    expect(
      await failsAs(db, dan.userId, 'insert into client_accounts (user_id, client_id) values ($1,$2)', [
        dan.userId,
        eve,
      ]),
    ).not.toBeNull();
  });

  it('a visitor who is not signed in cannot call any portal function', async () => {
    for (const sql of [
      'select public.portal_overview()',
      'select public.portal_claim()',
      "select public.portal_programme('" + progAlice + "')",
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

  it('the internal helpers cannot be called by a client', async () => {
    expect(await failsAs(db, dan.userId, 'select public.programme_json($1)', [progEve])).toMatch(
      /permission denied/,
    );
    expect(await failsAs(db, dan.userId, 'select public.portal_email()')).toMatch(/permission denied/);
  });
});

describe('a client’s privacy choices', () => {
  it('withdrawing a consent adds a record, logs a request for the trainer, and works only once', async () => {
    const run = (id: string) =>
      asUser(db, dan.userId, (r) =>
        r<{ ok: boolean }>("select public.portal_withdraw_consent($1, 'health-data', '') as ok", [id]),
      );
    expect((await run(danAtAlice))[0]!.ok).toBe(true);
    expect((await run(danAtAlice))[0]!.ok).toBe(false);
    const rows = await db.query<{ granted: boolean }>(
      "select granted from consents where client_id = $1 and purpose = 'health-data' order by granted_at, id",
      [danAtAlice],
    );
    expect(rows.rows.map((r) => r.granted)).toContain(false);
    expect(rows.rows).toHaveLength(2);
    const reqs = await q<{ kind: string; client_name: string }>(
      alice,
      "select kind, client_name from data_requests where kind = 'consent-withdrawal'",
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.client_name).toBe('Dan Dillon');
    const o = await overview(dan);
    const mine = o.memberships.find((m: Json) => m.client_name === 'Dan Dillon');
    expect(mine.consents.find((c: Json) => c.purpose === 'health-data').granted).toBe(false);
    expect(mine.consents.find((c: Json) => c.purpose === 'privacy-notice').granted).toBe(true);
  });

  it('a client cannot withdraw for someone else’s record', async () => {
    const r = await asUser(db, dan.userId, (run) =>
      run<{ ok: boolean }>("select public.portal_withdraw_consent($1, 'health-data', '') as ok", [eve]),
    );
    expect(r[0]!.ok).toBe(false);
  });

  it('access, correction, deletion and objection requests reach the trainer; other kinds do not', async () => {
    const ask = (kind: string, id = danAtBob) =>
      asUser(db, dan.userId, (run) =>
        run<{ ok: boolean }>('select public.portal_request($1, $2, $3) as ok', [id, kind, 'please']),
      );
    for (const k of ['access', 'correction', 'deletion', 'objection'])
      expect((await ask(k))[0]!.ok, k).toBe(true);
    expect((await ask('consent-withdrawal'))[0]!.ok).toBe(false);
    expect((await ask('access', eve))[0]!.ok).toBe(false);
    const forBob = await q<{ kind: string }>(bob, 'select kind from data_requests order by kind');
    expect(forBob.map((r) => r.kind)).toEqual(['access', 'correction', 'deletion', 'objection']);
    expect(await q(alice, "select 1 from data_requests where kind = 'objection'")).toHaveLength(0);
  });
});

describe('a trainer switches access off', () => {
  it('revoking the account hides everything at once, and only that trainer’s client', async () => {
    await q(alice, 'update client_accounts set revoked_at = now() where client_id = $1', [danAtAlice]);
    const o = await overview(dan);
    expect(o.memberships.map((m: Json) => m.trainer.business_name)).toEqual(['Bob Strength']);
    const r = await asUser(db, dan.userId, (run) =>
      run<{ r: Json | null }>('select public.portal_programme($1) as r', [progAlice]),
    );
    expect(r[0]!.r).toBeNull();
    const still = await asUser(db, dan.userId, (run) =>
      run<{ r: Json | null }>('select public.portal_programme($1) as r', [progBob]),
    );
    expect(still[0]!.r!.title).toBe('Bob plan');
  });

  it('a trainer sees the accounts of their own clients only', async () => {
    expect(await q(alice, 'select 1 from client_accounts')).toHaveLength(1);
    expect(await q(bob, 'select 1 from client_accounts')).toHaveLength(1);
    await q(bob, 'update client_accounts set revoked_at = now()');
    expect((await overview(dan)).memberships).toEqual([]);
    // a new invite brings it back
    await invite(bob, danAtBob, 'dan@example.com');
    expect((await overview(dan)).memberships).toHaveLength(1);
  });

  it('erasing a client removes the link too', async () => {
    await db.query('delete from clients where id = $1', [danAtBob]);
    expect((await overview(dan)).memberships).toEqual([]);
    expect(
      (await db.query('select 1 from client_accounts where client_id = $1', [danAtBob])).rows,
    ).toHaveLength(0);
  });
});
