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
let noRateC = '';
let bobC = '';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));
const gen = (u: TestUser, month: string) =>
  q<{ r: Json }>(u, 'select public.generate_invoices($1::date) as r', [month]).then((x) => x[0]!.r);
const session = async (
  trainer: TestUser,
  client: string,
  startsAt: string,
  status = 'scheduled',
  title = 'Training session',
) =>
  db.query(
    "insert into bookings (trainer_id, client_id, starts_at, ends_at, status, title) values ($1,$2,$3::timestamptz,$3::timestamptz + interval '1 hour',$4,$5)",
    [trainer.trainerId, client, startsAt, status, title],
  );

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  const mk = async (t: TestUser, name: string, email: string, rate: number | null) =>
    (
      await db.query<{ id: string }>(
        'insert into clients (trainer_id, name, email, rate_cents) values ($1,$2,$3,$4) returning id',
        [t.trainerId, name, email, rate],
      )
    ).rows[0]!.id;
  danC = await mk(alice, 'Dan Dillon', 'dan@example.com', 45000);
  eveC = await mk(alice, 'Eve Evans', 'eve@example.com', null);
  noRateC = await mk(alice, 'Norah NoRate', 'n@example.com', null);
  bobC = await mk(bob, 'Zed', 'z@example.com', 30000);
  await db.query(
    "update trainers set default_rate_cents = 40000, vat_percent = 15, invoice_prefix = 'AF', bank_details = 'FNB 123456', payment_link = 'https://pay.example/alice', invoice_terms = 'Pay before the 1st' where id = $1",
    [alice.trainerId],
  );
  // December 2026: Dan has 4 sessions (one is a different kind), plus ones that must not count
  for (const d of ['2026-12-01T05:00:00Z', '2026-12-08T05:00:00Z', '2026-12-15T05:00:00Z'])
    await session(alice, danC, d);
  await session(alice, danC, '2026-12-22T05:00:00Z', 'scheduled', 'Boxing');
  await session(alice, danC, '2026-12-10T05:00:00Z', 'cancelled');
  await session(alice, danC, '2026-12-11T05:00:00Z', 'no_show');
  await session(alice, danC, '2026-11-30T21:30:00Z'); // 23:30 SAST on 30 Nov: November
  await session(alice, danC, '2026-12-31T22:30:00Z'); // 00:30 SAST on 1 Jan: January
  await session(alice, eveC, '2026-12-03T05:00:00Z');
  await session(alice, eveC, '2026-12-04T05:00:00Z', 'completed');
  await session(alice, noRateC, '2026-12-05T05:00:00Z');
  await session(bob, bobC, '2026-12-06T05:00:00Z');
  await q(
    alice,
    "insert into client_invites (trainer_id, client_id, email) values ($1,$2,'dan@example.com')",
    [alice.trainerId, danC],
  );
  await q(dan, 'select public.portal_overview()');
});

describe('making a month’s invoices', () => {
  let ids: string[] = [];
  it('makes one per client with sessions, at their rate (or the default), and says who was skipped', async () => {
    const r = await gen(alice, '2026-12-17');
    expect(r.month).toBe('2026-12-01');
    expect(r.generated).toBe(3);
    expect(r.skipped_no_rate).toEqual([]);
    expect(r.skipped_no_sessions).toBe(0);
    ids = r.invoice_ids;
  });

  it('counts only sessions in that month in South African time, and not cancelled or missed ones', async () => {
    const lines = await q(
      alice,
      'select l.description, l.quantity, l.unit_cents, l.amount_cents from invoice_lines l join invoices i on i.id = l.invoice_id where i.client_id = $1 order by l.position',
      [danC],
    );
    expect(lines.map((l) => [l.description, Number(l.quantity), l.unit_cents, l.amount_cents])).toEqual([
      ['Training session, December 2026', 3, 45000, 135000],
      ['Boxing, December 2026', 1, 45000, 45000],
    ]);
  });

  it('adds VAT at the trainer’s rate and totals to whole cents', async () => {
    const inv = (
      await q(
        alice,
        'select number, status, vat_percent, subtotal_cents, vat_cents, total_cents, due_on, issued_on, notes, auto_generated from invoices where client_id = $1',
        [danC],
      )
    )[0]!;
    expect(inv).toMatchObject({
      number: 'AF-202612-001',
      status: 'draft',
      subtotal_cents: 180000,
      vat_cents: 27000,
      total_cents: 207000,
      auto_generated: false,
    });
    expect(Number(inv.vat_percent)).toBe(15);
    expect(inv.notes).toMatch(/^Sessions: 1 Dec 07:00, 8 Dec 07:00, 15 Dec 07:00, 22 Dec 07:00$/);
    expect(String(inv.due_on)).toContain('2026');
    const eve = (
      await q(alice, 'select number, subtotal_cents, total_cents from invoices where client_id = $1', [eveC])
    )[0]!;
    expect(eve).toMatchObject({ number: 'AF-202612-002', subtotal_cents: 80000, total_cents: 92000 });
  });

  it('does nothing twice', async () => {
    const r = await gen(alice, '2026-12-01');
    expect(r.generated).toBe(0);
    expect(r.skipped_existing).toBe(3);
  });

  it('a voided invoice can be made again, with the next number', async () => {
    await q(alice, "update invoices set status = 'void' where client_id = $1", [eveC]);
    const r = await gen(alice, '2026-12-01');
    expect(r.generated).toBe(1);
    const nums = await q(alice, 'select number, status from invoices where client_id = $1 order by number', [
      eveC,
    ]);
    expect(nums.map((n) => [n.number, n.status])).toEqual([
      ['AF-202612-002', 'void'],
      ['AF-202612-004', 'draft'],
    ]);
  });

  it('only covers the signed-in trainer’s own clients', async () => {
    const r = await gen(bob, '2026-12-01');
    expect(r.generated).toBe(1);
    expect(await q(bob, 'select 1 from invoices')).toHaveLength(1);
    expect(await q(alice, 'select 1 from invoices where client_id = $1', [bobC])).toHaveLength(0);
    expect((await q(bob, 'select number from invoices'))[0]!.number).toBe('INV-202612-001');
  });

  it('a client with no rate of their own and no default is skipped, and named', async () => {
    await db.query('update trainers set default_rate_cents = null where id = $1', [alice.trainerId]);
    await session(alice, noRateC, '2027-04-05T05:00:00Z');
    const r = await gen(alice, '2027-04-01');
    expect(r.generated).toBe(0);
    expect(r.skipped_no_rate).toEqual(['Norah NoRate']);
    await db.query('update trainers set default_rate_cents = 40000 where id = $1', [alice.trainerId]);
  });

  it('a client with no sessions in a month gets nothing', async () => {
    const r = await gen(alice, '2027-03-01');
    expect(r.generated).toBe(0);
  });

  it('needs a trainer sign-in', async () => {
    expect(
      await failsAs(db, dan.userId, 'select public.generate_invoices($1::date)', ['2026-12-01']),
    ).toMatch(/Sign in as a trainer/);
    const err = await asAnon(db, async (run) =>
      run("select public.generate_invoices('2026-12-01')").then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
    expect(ids.length).toBe(3);
  });
});

describe('editing and locking', () => {
  it('a draft’s lines can change and the totals follow', async () => {
    const inv = (
      await q(alice, "select id from invoices where client_id = $1 and status = 'draft'", [danC])
    )[0]!.id;
    await q(
      alice,
      "update invoice_lines set unit_cents = 50000 where invoice_id = $1 and description like 'Boxing%'",
      [inv],
    );
    await q(
      alice,
      "insert into invoice_lines (invoice_id, position, description, quantity, unit_cents) values ($1, 9, 'Discount', 1, -10000)",
      [inv],
    );
    const t = (
      await q(alice, 'select subtotal_cents, vat_cents, total_cents from invoices where id = $1', [inv])
    )[0]!;
    expect(t).toMatchObject({
      subtotal_cents: 135000 + 50000 - 10000,
      vat_cents: 26250,
      total_cents: 201250,
    });
    await q(alice, "delete from invoice_lines where invoice_id = $1 and description = 'Discount'", [inv]);
    expect((await q(alice, 'select total_cents from invoices where id = $1', [inv]))[0]!.total_cents).toBe(
      201250 + 10000 + 1500,
    );
  });

  it('once sent, the lines are locked', async () => {
    const inv = (
      await q(alice, "select id from invoices where client_id = $1 and status = 'draft'", [danC])
    )[0]!.id;
    await q(alice, "update invoices set status = 'sent' where id = $1", [inv]);
    expect(
      await failsAs(db, alice.userId, 'update invoice_lines set unit_cents = 1 where invoice_id = $1', [inv]),
    ).toMatch(/Only a draft invoice/);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into invoice_lines (invoice_id, description) values ($1, 'x')",
        [inv],
      ),
    ).toMatch(/Only a draft invoice/);
    expect(await failsAs(db, alice.userId, 'delete from invoice_lines where invoice_id = $1', [inv])).toMatch(
      /Only a draft invoice/,
    );
  });

  it('another trainer cannot see or change them', async () => {
    expect(await q(bob, 'select 1 from invoices where client_id = $1', [danC])).toHaveLength(0);
    await q(bob, "update invoices set status = 'paid'");
    expect(
      (
        await q(alice, "select status from invoices where client_id = $1 and period_start = '2026-12-01'", [
          danC,
        ])
      )[0]!.status,
    ).toBe('sent');
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into invoices (trainer_id, client_id, number, period_start, issued_on, due_on) values ($1,$2,'X-1','2027-01-01','2026-12-20','2027-01-01')",
        [bob.trainerId, danC],
      ),
    ).not.toBeNull();
  });

  it('the first day of the month is required, and a status must be one of the four', async () => {
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into invoices (trainer_id, number, period_start, issued_on, due_on) values ($1,'Y-1','2027-01-15','2026-12-20','2027-01-01')",
        [alice.trainerId],
      ),
    ).not.toBeNull();
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into invoices (trainer_id, number, period_start, issued_on, due_on, status) values ($1,'Y-2','2027-01-01','2026-12-20','2027-01-01','owing')",
        [alice.trainerId],
      ),
    ).not.toBeNull();
  });
});

describe('automatic invoicing', () => {
  const auto = (today: string) =>
    db
      .query<{ r: Json[] }>('select public.run_auto_invoicing($1::date) as r', [today])
      .then((x) => x.rows[0]!.r);

  beforeAll(async () => {
    await session(alice, danC, '2027-01-05T05:00:00Z');
    await session(alice, danC, '2027-01-12T05:00:00Z');
    await session(alice, eveC, '2027-01-06T05:00:00Z');
    await db.query(
      'update trainers set auto_invoice = true, invoice_days_before = 5, auto_send = false where id = $1',
      [alice.trainerId],
    );
  });

  it('does nothing until it is the right number of days before the month ends', async () => {
    expect(await auto('2026-12-25')).toEqual([]);
    expect((await db.query("select 1 from invoices where period_start = '2027-01-01'")).rows).toHaveLength(0);
  });

  it('makes next month’s invoices as drafts on the day, marked as automatic, and leaves a trainer with it off alone', async () => {
    const r = await auto('2026-12-26');
    expect(r).toHaveLength(1);
    expect(r[0]!.generated).toBe(2);
    const rows = await db.query<Json>(
      "select status, auto_generated, email_queued_at, issued_on from invoices where period_start = '2027-01-01' order by number",
    );
    expect(
      rows.rows.every((x) => x.status === 'draft' && x.auto_generated && x.email_queued_at === null),
    ).toBe(true);
    expect(String(rows.rows[0]!.issued_on)).toContain('Dec 26 2026');
    expect(
      (await db.query('select 1 from invoices where trainer_id = $1', [bob.trainerId])).rows.length,
    ).toBe(1);
  });

  it('runs again harmlessly, and catches up later in the month if a day was missed', async () => {
    expect((await auto('2026-12-27'))[0]!.generated).toBe(0);
    await session(alice, danC, '2027-01-19T05:00:00Z', 'scheduled', 'Late booking');
    await db.query(
      "update invoices set status = 'void' where period_start = '2027-01-01' and client_id = $1",
      [eveC],
    );
    expect((await auto('2026-12-31'))[0]!.generated).toBe(1);
  });

  it('with automatic sending on, the new invoices are marked sent and queued for email', async () => {
    await session(alice, danC, '2027-02-02T05:00:00Z');
    await db.query('update trainers set auto_send = true where id = $1', [alice.trainerId]);
    expect((await auto('2027-01-26'))[0]!.generated).toBe(1);
    const r = (
      await db.query<Json>(
        "select status, email_queued_at, total_cents from invoices where period_start = '2027-02-01'",
      )
    ).rows[0]!;
    expect(r.status).toBe('sent');
    expect(r.email_queued_at).not.toBeNull();
    expect(r.total_cents).toBe(51750);
  });

  it('only the scheduler can run it, not a trainer or a client', async () => {
    for (const u of [alice, dan])
      expect(await failsAs(db, u.userId, 'select public.run_auto_invoicing()')).toMatch(/permission denied/);
    for (const sql of ['select public.gen_invoices_for(gen_random_uuid(), now()::date, now()::date, false)'])
      expect(await failsAs(db, alice.userId, sql)).toMatch(/permission denied/);
  });

  it('settings reject nonsense', async () => {
    for (const set of [
      'vat_percent = 150',
      "invoice_prefix = 'bad prefix!'",
      'invoice_days_before = 40',
      'default_rate_cents = -1',
    ])
      expect(
        await failsAs(db, alice.userId, `update trainers set ${set} where id = $1`, [alice.trainerId]),
        set,
      ).not.toBeNull();
  });
});

describe('what a client sees', () => {
  it('only their own sent or paid invoices, with the lines and where to pay, never drafts or voided ones', async () => {
    const r = (await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r;
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.client_id === danC && ['sent', 'paid'].includes(i.status))).toBe(true);
    const dec = r.find((i) => i.number === 'AF-202612-001')!;
    expect(dec.total_cents).toBe(201250 + 10000 + 1500);
    expect(dec.lines.length).toBe(2);
    expect(dec.trainer).toMatchObject({
      bank_details: 'FNB 123456',
      payment_link: 'https://pay.example/alice',
      terms: 'Pay before the 1st',
    });
    expect(r.some((i) => i.status === 'draft')).toBe(false);
  });

  it('a paid one shows as paid', async () => {
    await q(
      alice,
      "update invoices set status = 'paid', paid_at = now(), paid_method = 'eft' where number = 'AF-202612-001'",
    );
    const r = (await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r;
    expect(r.find((i) => i.number === 'AF-202612-001')).toMatchObject({ status: 'paid' });
  });

  it('has no table access, and anonymous visitors cannot call it', async () => {
    expect(await q(dan, 'select 1 from invoices')).toHaveLength(0);
    expect(await q(dan, 'select 1 from invoice_lines')).toHaveLength(0);
    const err = await asAnon(db, async (run) =>
      run('select public.portal_invoices()').then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('is empty once access is switched off', async () => {
    await q(alice, 'update client_accounts set revoked_at = now() where client_id = $1', [danC]);
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r).toEqual([]);
  });
});

describe('records are kept', () => {
  it('erasing a client leaves their invoices (tax records) with the name and email as they were', async () => {
    const before = (
      await db.query<Json>('select count(*)::int as n from invoices where client_id = $1', [danC])
    ).rows[0]!.n;
    expect(before).toBeGreaterThan(0);
    await db.query('delete from clients where id = $1', [danC]);
    const rows = (
      await db.query<Json>(
        "select client_id, client_name, client_email from invoices where number = 'AF-202612-001'",
      )
    ).rows;
    expect(rows[0]).toMatchObject({
      client_id: null,
      client_name: 'Dan Dillon',
      client_email: 'dan@example.com',
    });
  });

  it('the migration can be run a second time without losing anything', async () => {
    const n = (await db.query<Json>('select count(*)::int as n from invoices')).rows[0]!.n;
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261123090000_invoicing.sql'), 'utf8'),
    );
    expect((await db.query<Json>('select count(*)::int as n from invoices')).rows[0]!.n).toBe(n);
  });
});
