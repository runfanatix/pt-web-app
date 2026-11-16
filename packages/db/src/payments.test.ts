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
let sentInv = '';
let draftInv = '';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = <T = Json>(u: TestUser, sql: string, params: unknown[] = []) =>
  asUser(db, u.userId, (run) => run<T>(sql, params));
const asService = <T = Json>(sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (await tx.query<T>(sql, params)).rows;
  });
const pay = (inv: string, ref: string, cents: number) =>
  asService<{ r: string }>("select public.record_online_payment($1, 'payfast', $2, $3) as r", [
    inv,
    ref,
    cents,
  ]).then((x) => x[0]!.r);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  dan = await createUser(db, 'dan@example.com', { role: 'client' });
  danC = (
    await db.query<{ id: string }>(
      "insert into clients (trainer_id, name, email) values ($1,'Dan','dan@example.com') returning id",
      [alice.trainerId],
    )
  ).rows[0]!.id;
  const mk = async (n: string, status: string, total: number) =>
    (
      await db.query<{ id: string }>(
        "insert into invoices (trainer_id, client_id, client_name, number, period_start, issued_on, due_on, status, total_cents) values ($1,$2,'Dan',$3,'2026-12-01','2026-11-26','2026-12-01',$4,$5) returning id",
        [alice.trainerId, danC, n, status, total],
      )
    ).rows[0]!.id;
  sentInv = await mk('N-1', 'sent', 180000);
  draftInv = (
    await db.query<{ id: string }>(
      "insert into invoices (trainer_id, client_id, client_name, number, period_start, issued_on, due_on, status, total_cents) values ($1,$2,'Dan','N-2','2027-01-01','2026-11-26','2027-01-01','draft',50000) returning id",
      [alice.trainerId, danC],
    )
  ).rows[0]!.id;
  await q(
    alice,
    "insert into client_invites (trainer_id, client_id, email) values ($1,$2,'dan@example.com')",
    [alice.trainerId, danC],
  );
  await q(dan, 'select public.portal_overview()');
});

describe('the trainer’s payment keys', () => {
  it('a trainer saves and reads their own, and nobody else can see or change them', async () => {
    await q(
      alice,
      "insert into payment_settings (trainer_id, enabled, sandbox, merchant_id, merchant_key, passphrase) values ($1, true, true, '10000100', '46f0cd694581a', 'secret phrase')",
      [alice.trainerId],
    );
    expect((await q(alice, 'select merchant_id, passphrase from payment_settings'))[0]).toMatchObject({
      merchant_id: '10000100',
      passphrase: 'secret phrase',
    });
    expect(await q(bob, 'select 1 from payment_settings')).toHaveLength(0);
    await q(bob, 'update payment_settings set enabled = false');
    expect((await q(alice, 'select enabled from payment_settings'))[0]!.enabled).toBe(true);
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into payment_settings (trainer_id, merchant_id) values ($1, 'x')",
        [alice.trainerId],
      ),
    ).not.toBeNull();
  });

  it('a client and a visitor cannot read them', async () => {
    expect(await q(dan, 'select 1 from payment_settings')).toHaveLength(0);
    const err = await asAnon(db, async (run) =>
      run('select * from payment_settings').then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('only PayFast is a valid provider', async () => {
    expect(await failsAs(db, alice.userId, "update payment_settings set provider = 'other'")).not.toBeNull();
  });
});

describe('what the client is told', () => {
  it('whether they can pay online, and never the keys', async () => {
    const r = (await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r;
    expect(r).toHaveLength(1);
    expect(r[0]!.pay_online).toBe(true);
    const text = JSON.stringify(r);
    for (const secret of ['46f0cd694581a', 'secret phrase', '10000100']) expect(text).not.toContain(secret);
  });

  it('online payment is off when switched off or when keys are missing', async () => {
    await q(alice, 'update payment_settings set enabled = false');
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r[0]!.pay_online).toBe(
      false,
    );
    await q(alice, "update payment_settings set enabled = true, merchant_key = ''");
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r[0]!.pay_online).toBe(
      false,
    );
    await q(alice, "update payment_settings set merchant_key = '46f0cd694581a'");
    expect((await q<{ r: Json[] }>(dan, 'select public.portal_invoices() as r'))[0]!.r[0]!.pay_online).toBe(
      true,
    );
  });
});

describe('recording a payment', () => {
  it('only the payment server can record one', async () => {
    for (const u of [alice, dan])
      expect(
        await failsAs(db, u.userId, "select public.record_online_payment($1, 'payfast', 'x', 1)", [sentInv]),
      ).toMatch(/permission denied/);
    const err = await asAnon(db, async (run) =>
      run("select public.record_online_payment(gen_random_uuid(), 'payfast', 'x', 1)").then(
        () => null,
        (e: Error) => e.message,
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('a payment of the wrong amount is kept as a record but does not mark the invoice paid', async () => {
    expect(await pay(sentInv, 'PF-1', 170000)).toBe('amount_mismatch');
    expect((await q(alice, 'select status from invoices where id = $1', [sentInv]))[0]!.status).toBe('sent');
    expect(
      (await q(alice, 'select outcome from invoice_payments where provider_ref = $1', ['PF-1']))[0]!.outcome,
    ).toBe('amount_mismatch');
  });

  it('the exact amount marks it paid by card, once', async () => {
    expect(await pay(sentInv, 'PF-2', 180000)).toBe('paid');
    const inv = (
      await q(alice, 'select status, paid_method, paid_at from invoices where id = $1', [sentInv])
    )[0]!;
    expect(inv).toMatchObject({ status: 'paid', paid_method: 'card' });
    expect(inv.paid_at).not.toBeNull();
  });

  it('the same payment reported again does nothing', async () => {
    expect(await pay(sentInv, 'PF-2', 180000)).toBe('already_recorded');
    expect(await q(alice, "select 1 from invoice_payments where provider_ref = 'PF-2'")).toHaveLength(1);
  });

  it('a second payment for an invoice that is already paid is recorded as not payable, never paying twice', async () => {
    expect(await pay(sentInv, 'PF-3', 180000)).toBe('not_payable');
    expect((await q(alice, 'select status from invoices where id = $1', [sentInv]))[0]!.status).toBe('paid');
  });

  it('a draft cannot be paid, and an unknown invoice is refused', async () => {
    expect(await pay(draftInv, 'PF-4', 50000)).toBe('not_payable');
    expect(await pay('00000000-0000-4000-8000-000000000000', 'PF-5', 1)).toBe('not_payable');
    expect((await q(alice, 'select status from invoices where id = $1', [draftInv]))[0]!.status).toBe(
      'draft',
    );
  });

  it('only the trainer sees the payment records; another trainer and the client see none', async () => {
    expect((await q(alice, 'select 1 from invoice_payments')).length).toBeGreaterThan(2);
    expect(await q(bob, 'select 1 from invoice_payments')).toHaveLength(0);
    expect(await q(dan, 'select 1 from invoice_payments')).toHaveLength(0);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into invoice_payments (invoice_id, trainer_id, provider, provider_ref, amount_cents, outcome) values ($1,$2,'payfast','Z',1,'paid')",
        [sentInv, alice.trainerId],
      ),
    ).not.toBeNull();
  });

  it('the migration can be run a second time', async () => {
    await db.exec(
      readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '20261124090000_online_payments.sql'), 'utf8'),
    );
  });
});
