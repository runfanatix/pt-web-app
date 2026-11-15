import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
const ids = {} as Record<string, string>;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  await asUser(db, alice.userId, async (q) => {
    ids.client = (
      await q<{ id: string }>(
        "insert into clients (trainer_id, name, date_of_birth, guardian_name, private_notes) values ($1,'Carla','2012-05-01','Mum','asthma') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
  });
});

describe('trainer business details (for the privacy notice)', () => {
  it('a trainer can fill in and change their own details', async () => {
    await asUser(db, alice.userId, (q) =>
      q(
        "update trainers set business_name = 'Alice Fitness', address = '1 Main Rd', contact_email = 'a@example.com', information_officer_name = 'Alice' where user_id = $1",
        [alice.userId],
      ),
    );
    const row = await asUser(db, alice.userId, (q) =>
      q<{ business_name: string; information_officer_name: string }>(
        'select business_name, information_officer_name from trainers',
      ),
    );
    expect(row).toEqual([{ business_name: 'Alice Fitness', information_officer_name: 'Alice' }]);
  });

  it('another trainer cannot read or change them', async () => {
    expect(
      await asUser(db, bob.userId, (q) =>
        q("select business_name from trainers where business_name = 'Alice Fitness'"),
      ),
    ).toHaveLength(0);
    await asUser(db, bob.userId, (q) => q("update trainers set business_name = 'hacked'"));
    const after = await db.query<{ business_name: string }>(
      'select business_name from trainers where user_id = $1',
      [alice.userId],
    );
    expect(after.rows[0]!.business_name).toBe('Alice Fitness');
  });
});

describe('client consent history is append-only evidence', () => {
  const insert = (granted: boolean, purpose = 'health-information', detail = '') =>
    asUser(db, alice.userId, (q) =>
      q(
        "insert into consents (trainer_id, client_id, subject, purpose, detail, granted, notice_version, wording) values ($1,$2,'client',$3,$4,$5,'1.0-draft','I consent…')",
        [alice.trainerId, ids.client, purpose, detail, granted],
      ),
    );

  it('keeps every change, with the exact wording and version shown, newest last', async () => {
    await insert(true);
    await insert(false);
    await insert(true, 'sharing', 'Dr Smith');
    const rows = await asUser(db, alice.userId, (q) =>
      q<{ purpose: string; detail: string; granted: boolean; wording: string; notice_version: string }>(
        'select purpose, detail, granted, wording, notice_version from consents where client_id = $1 order by granted_at, purpose',
        [ids.client],
      ),
    );
    expect(
      rows
        .filter((r) => r.purpose === 'health-information')
        .map((r) => r.granted)
        .sort(),
    ).toEqual([false, true]);
    expect(rows.find((r) => r.purpose === 'sharing')).toMatchObject({
      detail: 'Dr Smith',
      wording: 'I consent…',
      notice_version: '1.0-draft',
    });
  });

  it("another trainer cannot record consent for someone else's client", async () => {
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into consents (trainer_id, client_id, subject, purpose, notice_version) values ($1,$2,'client','health-information','1.0')",
        [bob.trainerId, ids.client],
      ),
    ).toMatch(/row-level security/);
  });

  it('anonymous visitors cannot read consent or data requests', async () => {
    for (const t of ['consents', 'data_requests']) {
      await expect(asAnon(db, (q) => q(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('data-subject requests', () => {
  it('are logged per trainer and kept (with the client name) after the client is erased', async () => {
    let reqId = '';
    await asUser(db, alice.userId, async (q) => {
      reqId = (
        await q<{ id: string }>(
          "insert into data_requests (trainer_id, client_id, client_name, kind) values ($1,$2,'Carla','access') returning id",
          [alice.trainerId, ids.client],
        )
      )[0]!.id;
      await q("update data_requests set completed_at = now(), outcome = 'Copy sent' where id = $1", [reqId]);
    });
    expect(await asUser(db, bob.userId, (q) => q('select * from data_requests'))).toHaveLength(0);
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into data_requests (trainer_id, client_id, kind) values ($1,$2,'access')",
        [bob.trainerId, ids.client],
      ),
    ).toMatch(/row-level security/);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into data_requests (trainer_id, kind) values ($1,'sell-my-data')",
        [alice.trainerId],
      ),
    ).toMatch(/check constraint/);

    // erasing the client removes their consents, programmes and notes, but the request log survives
    await asUser(db, alice.userId, async (q) => {
      await q("insert into programmes (client_id, title) values ($1,'Starter')", [ids.client]);
      await q('delete from clients where id = $1', [ids.client]);
    });
    expect((await db.query('select * from consents where client_id = $1', [ids.client])).rows).toHaveLength(
      0,
    );
    expect((await db.query('select * from programmes where client_id = $1', [ids.client])).rows).toHaveLength(
      0,
    );
    const log = await asUser(db, alice.userId, (q) =>
      q<{ client_id: string | null; client_name: string; outcome: string }>(
        'select client_id, client_name, outcome from data_requests where id = $1',
        [reqId],
      ),
    );
    expect(log).toEqual([{ client_id: null, client_name: 'Carla', outcome: 'Copy sent' }]);
  });
});

describe('programmes assigned to clients', () => {
  it('a trainer assigns a programme with items to their own client; another trainer cannot see it', async () => {
    let clientId = '';
    await asUser(db, alice.userId, async (q) => {
      clientId = (
        await q<{ id: string }>("insert into clients (trainer_id, name) values ($1,'Dan') returning id", [
          alice.trainerId,
        ])
      )[0]!.id;
      const p = (
        await q<{ id: string }>(
          "insert into programmes (client_id, title, notes) values ($1,'Starter','Easy') returning id",
          [clientId],
        )
      )[0]!.id;
      await q(
        "insert into programme_items (programme_id, position, exercise_name, sets, reps, rest) values ($1,0,'Squat',3,'10',60)",
        [p],
      );
    });
    expect(await asUser(db, alice.userId, (q) => q('select * from programme_items'))).toHaveLength(1);
    expect(await asUser(db, bob.userId, (q) => q('select * from programmes'))).toHaveLength(0);
    expect(
      await failsAs(db, bob.userId, "insert into programmes (client_id, title) values ($1,'x')", [clientId]),
    ).toMatch(/row-level security/);
  });
});
