import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
const ids = {} as Record<string, string>;

/** Alice's gym -> floor -> zone -> equipment, plus a client and programme; one built-in exercise. */
beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');

  await asUser(db, alice.userId, async (q) => {
    ids.gym = (
      await q<{ id: string }>(
        "insert into gyms (trainer_id, name, branch) values ($1, 'Alice Gym', 'North') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
    ids.floor = (
      await q<{ id: string }>('insert into floors (gym_id, name) values ($1, $2) returning id', [
        ids.gym,
        'Ground',
      ])
    )[0]!.id;
    ids.zone = (
      await q<{ id: string }>(
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1, 'Cardio', 'cardio', 0, 0, 200, 100) returning id",
        [ids.floor],
      )
    )[0]!.id;
    ids.equip = (
      await q<{ id: string }>(
        "insert into equipment (zone_id, name, type, x, y, muscles) values ($1, 'Treadmill', 'cardio', 10, 10, '{cardio,legs}') returning id",
        [ids.zone],
      )
    )[0]!.id;
    ids.client = (
      await q<{ id: string }>(
        "insert into clients (trainer_id, name, private_notes) values ($1, 'Carla Client', 'knee injury') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
    ids.programme = (
      await q<{ id: string }>(
        "insert into programmes (client_id, gym_id, title) values ($1, $2, 'Starter') returning id",
        [ids.client, ids.gym],
      )
    )[0]!.id;
    ids.exercise = (
      await q<{ id: string }>(
        "insert into exercises (trainer_id, name) values ($1, 'Alice private exercise') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
  });
  // Built-in library (trainer_id null) is seeded by an admin, i.e. outside RLS.
  ids.builtin = (
    await db.query<{ id: string }>(
      "insert into exercises (trainer_id, name, muscles) values (null, 'Built-in squat', '{legs}') returning id",
    )
  ).rows[0]!.id;
});

describe('sign-up', () => {
  it('creates exactly one trainer per auth user', async () => {
    const r = await db.query('select * from public.trainers');
    expect(r.rows).toHaveLength(2);
  });

  it('records privacy-notice acceptance from the sign-up metadata as a consent row', async () => {
    const carol = await createUser(db, 'carol@example.com', {
      privacy_notice_version: 'v0-draft',
      display_name: 'Carol',
    });
    const rows = await asUser(db, carol.userId, (q) =>
      q('select subject, purpose, notice_version from consents'),
    );
    expect(rows).toEqual([{ subject: 'trainer', purpose: 'privacy-notice', notice_version: 'v0-draft' }]);
    const t = await asUser(db, carol.userId, (q) => q('select display_name from trainers'));
    expect(t).toEqual([{ display_name: 'Carol' }]);
    // users who signed up without the metadata have no consent row
    expect(await asUser(db, alice.userId, (q) => q('select * from consents'))).toHaveLength(0);
  });
});

describe('trainer isolation (the Phase 1 acceptance test)', () => {
  it('a trainer reads their own gym', async () => {
    const rows = await asUser(db, alice.userId, (q) => q('select name from gyms'));
    expect(rows).toEqual([{ name: 'Alice Gym' }]);
  });

  it("another trainer cannot see the first trainer's gym or anything beneath it", async () => {
    for (const table of ['gyms', 'floors', 'zones', 'equipment', 'clients', 'programmes']) {
      const rows = await asUser(db, bob.userId, (q) => q(`select * from ${table}`));
      expect(rows, table).toHaveLength(0);
    }
  });

  it("cannot read another trainer's private exercise but can read the built-in library", async () => {
    const rows = await asUser(db, bob.userId, (q) => q<{ name: string }>('select name from exercises'));
    expect(rows.map((r) => r.name)).toEqual(['Built-in squat']);
  });

  it('cannot update or delete rows they cannot see (silently affects zero rows)', async () => {
    await asUser(db, bob.userId, async (q) => {
      await q("update gyms set name = 'hacked'");
      await q('delete from gyms');
      await q("update clients set private_notes = 'hacked'");
    });
    const after = await db.query<{ name: string }>('select name from gyms');
    expect(after.rows[0]!.name).toBe('Alice Gym');
  });

  it("cannot insert into another trainer's gym, zone, programme or client", async () => {
    expect(await failsAs(db, bob.userId, 'insert into floors (gym_id) values ($1)', [ids.gym])).toMatch(
      /row-level security/,
    );
    expect(
      await failsAs(
        db,
        bob.userId,
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Z','cardio',0,0,100,100)",
        [ids.floor],
      ),
    ).toMatch(/row-level security/);
    expect(
      await failsAs(db, bob.userId, "insert into programmes (client_id, title) values ($1, 'x')", [
        ids.client,
      ]),
    ).toMatch(/row-level security/);
    expect(
      await failsAs(db, bob.userId, "insert into clients (trainer_id, name) values ($1, 'x')", [
        alice.trainerId,
      ]),
    ).toMatch(/row-level security/);
  });

  it("cannot attach a programme to another trainer's gym, or link another trainer's exercise to their equipment", async () => {
    await asUser(db, bob.userId, async (q) => {
      ids.bobClient = (
        await q<{ id: string }>(
          "insert into clients (trainer_id, name) values ($1,'Bob client') returning id",
          [bob.trainerId],
        )
      )[0]!.id;
    });
    expect(
      await failsAs(db, bob.userId, "insert into programmes (client_id, gym_id, title) values ($1,$2,'x')", [
        ids.bobClient,
        ids.gym,
      ]),
    ).toMatch(/row-level security/);
    // Alice cannot link Bob's private exercise (can_use_exercise) to her own equipment.
    let bobEx = '';
    await asUser(db, bob.userId, async (q) => {
      bobEx = (
        await q<{ id: string }>(
          "insert into exercises (trainer_id, name) values ($1,'Bob private') returning id",
          [bob.trainerId],
        )
      )[0]!.id;
    });
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into exercise_equipment (exercise_id, equipment_id) values ($1,$2)',
        [bobEx, ids.equip],
      ),
    ).toMatch(/row-level security/);
    // ...but she can link the built-in one.
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into exercise_equipment (exercise_id, equipment_id) values ($1,$2)',
        [ids.builtin, ids.equip],
      ),
    ).toBeNull();
  });

  it('cannot create a trainer-owned row claiming to be someone else', async () => {
    expect(
      await failsAs(db, bob.userId, "insert into gyms (trainer_id, name) values ($1,'Fake')", [
        alice.trainerId,
      ]),
    ).toMatch(/row-level security/);
    expect(
      await failsAs(db, bob.userId, "insert into exercises (trainer_id, name) values ($1,'Fake')", [
        alice.trainerId,
      ]),
    ).toMatch(/row-level security/);
  });
});

describe('built-in exercises', () => {
  it('are read-only for trainers', async () => {
    await asUser(db, alice.userId, async (q) => {
      await q("update exercises set name = 'hacked' where trainer_id is null");
      await q('delete from exercises where trainer_id is null');
    });
    const r = await db.query('select name from exercises where trainer_id is null');
    expect(r.rows).toEqual([{ name: 'Built-in squat' }]);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into exercises (trainer_id, name) values (null, 'sneaky built-in')",
      ),
    ).toMatch(/row-level security/);
  });
});

describe('anonymous visitors', () => {
  it('cannot read any table', async () => {
    for (const table of ['gyms', 'clients', 'programmes', 'share_links', 'exercises', 'consents']) {
      await expect(
        asAnon(db, (q) => q(`select * from ${table}`)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('trainer-private data', () => {
  it('private client notes are only visible to the owning trainer', async () => {
    const own = await asUser(db, alice.userId, (q) =>
      q<{ private_notes: string }>('select private_notes from clients'),
    );
    expect(own[0]!.private_notes).toBe('knee injury');
    const other = await asUser(db, bob.userId, (q) =>
      q('select private_notes from clients where id = $1', [ids.client]),
    );
    expect(other).toHaveLength(0);
  });
});

describe('consent records (POPIA)', () => {
  it('trainer can record and withdraw consent but not delete the record', async () => {
    let id = '';
    await asUser(db, alice.userId, async (q) => {
      id = (
        await q<{ id: string }>(
          "insert into consents (trainer_id, subject, purpose, notice_version) values ($1,'trainer','privacy-notice','v0-draft') returning id",
          [alice.trainerId],
        )
      )[0]!.id;
      await q(
        "insert into consents (trainer_id, client_id, subject, purpose, notice_version) values ($1,$2,'client','training-data','v0-draft')",
        [alice.trainerId, ids.client],
      );
      await q('update consents set withdrawn_at = now() where id = $1', [id]);
    });
    expect(await failsAs(db, alice.userId, 'delete from consents where id = $1', [id])).toMatch(
      /permission denied/,
    );
    const bobSees = await asUser(db, bob.userId, (q) => q('select * from consents'));
    expect(bobSees).toHaveLength(0);
  });

  it('a client consent must name a client and a trainer consent must not', async () => {
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into consents (trainer_id, subject, purpose, notice_version) values ($1,'client','x','v0')",
        [alice.trainerId],
      ),
    ).toMatch(/check constraint/);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into consents (trainer_id, client_id, subject, purpose, notice_version) values ($1,$2,'trainer','x','v0')",
        [alice.trainerId, ids.client],
      ),
    ).toMatch(/check constraint/);
  });
});

describe('data rules', () => {
  it('enforces floor, zone and part size limits and the 12-rectangle cap', async () => {
    expect(
      await failsAs(db, alice.userId, 'insert into floors (gym_id, w) values ($1, 100)', [ids.gym]),
    ).toMatch(/check constraint/);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Tiny','cardio',0,0,59,50)",
        [ids.floor],
      ),
    ).toMatch(/check constraint/);
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into zone_parts (zone_id, x, y, w, h, position) values ($1,0,0,15,16,0)',
        [ids.zone],
      ),
    ).toMatch(/check constraint/);
    expect(
      await failsAs(
        db,
        alice.userId,
        'insert into zone_parts (zone_id, x, y, w, h, position) values ($1,0,0,20,20,11)',
        [ids.zone],
      ),
    ).toMatch(/check constraint/);
  });

  it('rejects unknown categories, equipment types and muscles', async () => {
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Z','pool',0,0,100,100)",
        [ids.floor],
      ),
    ).toMatch(/check constraint/);
    expect(
      await failsAs(
        db,
        alice.userId,
        "insert into equipment (zone_id, name, type, x, y, muscles) values ($1,'E','cardio',0,0,'{biceps}')",
        [ids.zone],
      ),
    ).toMatch(/check constraint/);
  });

  it('deleting a gym cascades through floors, zones and equipment', async () => {
    let gymId = '';
    await asUser(db, alice.userId, async (q) => {
      gymId = (
        await q<{ id: string }>("insert into gyms (trainer_id, name) values ($1,'Temp') returning id", [
          alice.trainerId,
        ])
      )[0]!.id;
      const f = (await q<{ id: string }>('insert into floors (gym_id) values ($1) returning id', [gymId]))[0]!
        .id;
      await q(
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Z','cardio',0,0,100,100)",
        [f],
      );
      await q('delete from gyms where id = $1', [gymId]);
    });
    const left = await db.query('select count(*)::int as n from floors where gym_id = $1', [gymId]);
    expect(left.rows[0]).toEqual({ n: 0 });
  });

  it('share links get an unguessable token and follow programme ownership', async () => {
    let token = '';
    await asUser(db, alice.userId, async (q) => {
      token = (
        await q<{ token: string }>('insert into share_links (programme_id) values ($1) returning token', [
          ids.programme,
        ])
      )[0]!.token;
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await asUser(db, bob.userId, (q) => q('select * from share_links'))).toHaveLength(0);
    expect(
      await failsAs(db, bob.userId, 'insert into share_links (programme_id) values ($1)', [ids.programme]),
    ).toMatch(/row-level security/);
  });
});
