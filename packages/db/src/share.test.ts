import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { layoutFromFloorRows } from '@pt/core';
import { asAnon, asUser, createTestDb, createUser, failsAs, type TestUser } from './harness.ts';

let db: PGlite;
let alice: TestUser;
let bob: TestUser;
const ids = {} as Record<string, string>;
const SECRET = {
  clientName: 'Carla Clientson',
  whatsapp: '082 555 1234',
  email: 'carla.private@example.com',
  goals: 'lose weight after surgery',
  privateNotes: 'torn ACL, anxiety',
  emergency: 'Mum Clientson',
  equipmentNotes: 'trainer-only: bolt is loose',
};

const rpc = (token: string | null) =>
  asAnon(
    db,
    async (q) => (await q<{ r: unknown }>('select public.get_shared_programme($1) as r', [token]))[0]!.r,
  );

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  await asUser(db, alice.userId, async (q) => {
    await q("update trainers set business_name = 'Alice Fitness' where id = $1", [alice.trainerId]);
    ids.gym = (
      await q<{ id: string }>(
        "insert into gyms (trainer_id, name, branch, address) values ($1,'Virgin Active','Bedfordview','1 Rd') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
    const f = (
      await q<{ id: string }>(
        "insert into floors (gym_id, name, position) values ($1,'Ground',0) returning id",
        [ids.gym],
      )
    )[0]!.id;
    await q("insert into floors (gym_id, name, position) values ($1,'First',1)", [ids.gym]);
    const z = (
      await q<{ id: string }>(
        "insert into zones (floor_id, name, category, x, y, w, h) values ($1,'Cardio','cardio',0,0,200,100) returning id",
        [f],
      )
    )[0]!.id;
    await q('insert into zone_parts (zone_id, x, y, w, h, position) values ($1,200,0,50,50,0)', [z]);
    ids.equip = (
      await q<{ id: string }>(
        "insert into equipment (zone_id, name, type, x, y, muscles, notes) values ($1,'Treadmill','cardio',10,10,'{cardio,legs}',$2) returning id",
        [z, SECRET.equipmentNotes],
      )
    )[0]!.id;
    await q(
      "insert into structs (floor_id, type, x, y, w, h, label, shared) values ($1,'stairs',5,5,80,44,'STAIRS',true)",
      [f],
    );
    ids.exercise = (
      await q<{ id: string }>(
        "insert into exercises (trainer_id, name, cue) values ($1,'Incline walk','Stand tall') returning id",
        [alice.trainerId],
      )
    )[0]!.id;
    ids.client = (
      await q<{ id: string }>(
        `insert into clients (trainer_id, name, whatsapp, email, goals, private_notes, emergency_name)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          alice.trainerId,
          SECRET.clientName,
          SECRET.whatsapp,
          SECRET.email,
          SECRET.goals,
          SECRET.privateNotes,
          SECRET.emergency,
        ],
      )
    )[0]!.id;
    await q(
      "insert into consents (trainer_id, client_id, subject, purpose, notice_version, wording) values ($1,$2,'client','health-information','1.0','I consent… (private wording)')",
      [alice.trainerId, ids.client],
    );
    ids.programme = (
      await q<{ id: string }>(
        "insert into programmes (client_id, gym_id, title, notes) values ($1,$2,'Starter','Take it easy') returning id",
        [ids.client, ids.gym],
      )
    )[0]!.id;
    await q(
      "insert into programme_items (programme_id, position, equipment_id, exercise_id, exercise_name, sets, reps, rest, note) values ($1,1,null,null,'Plank',3,'30 s',45,'')",
      [ids.programme],
    );
    await q(
      "insert into programme_items (programme_id, position, equipment_id, exercise_id, exercise_name, sets, reps, rest, note) values ($1,0,$2,$3,'Incline walk',1,'8 min',0,'Easy pace')",
      [ids.programme, ids.equip, ids.exercise],
    );
    ids.token = (
      await q<{ token: string }>('insert into share_links (programme_id) values ($1) returning token', [
        ids.programme,
      ])
    )[0]!.token;
  });
});

interface Shared {
  title: string;
  notes: string;
  trainer: string;
  gym: { name: string; branch: string; address: string };
  items: {
    position: number;
    exercise_name: string;
    cue: string;
    note: string;
    equipment_id: string | null;
  }[];
  floors: unknown[];
}

describe('the public client page function', () => {
  it('serves the programme, the trainer and gym names, the ordered items and the gym layout to a visitor who is not logged in', async () => {
    const r = (await rpc(ids.token)) as Shared;
    expect(r).toMatchObject({
      title: 'Starter',
      notes: 'Take it easy',
      trainer: 'Alice Fitness',
      gym: { name: 'Virgin Active', branch: 'Bedfordview' },
    });
    expect(r.items.map((i) => i.exercise_name)).toEqual(['Incline walk', 'Plank']);
    expect(r.items[0]).toMatchObject({ cue: 'Stand tall', note: 'Easy pace', equipment_id: ids.equip });
    expect(r.floors).toHaveLength(2);
  });

  it('returns a layout the app can draw (same shape as the signed-in plan)', async () => {
    const r = (await rpc(ids.token)) as Shared;
    const layout = layoutFromFloorRows(r.floors);
    expect(layout.floors.map((f) => f.name)).toEqual(['Ground', 'First']);
    expect(layout.zones).toHaveLength(1);
    expect(layout.zones[0]!.parts).toHaveLength(1);
    expect(layout.equipment).toHaveLength(1);
    expect(layout.structs[0]).toMatchObject({ type: 'stairs', shared: true });
  });

  it('never returns anything private about the client, the consent records or the trainer’s notes', async () => {
    const text = JSON.stringify(await rpc(ids.token));
    for (const [k, secret] of Object.entries(SECRET)) expect(text, k).not.toContain(secret);
    for (const word of [
      'client_id',
      'private_notes',
      'whatsapp',
      'consent',
      'wording',
      'emergency',
      'date_of_birth',
      'guardian',
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it('returns nothing for an unknown, malformed or empty token', async () => {
    expect(await rpc('f'.repeat(64))).toBeNull();
    expect(await rpc('short')).toBeNull();
    expect(await rpc(null)).toBeNull();
    expect(await rpc('')).toBeNull();
  });

  it('stops working the moment the trainer revokes the link, and again if it is un-revoked', async () => {
    await asUser(db, alice.userId, (q) =>
      q('update share_links set revoked_at = now() where token = $1', [ids.token]),
    );
    expect(await rpc(ids.token)).toBeNull();
    await asUser(db, alice.userId, (q) =>
      q('update share_links set revoked_at = null where token = $1', [ids.token]),
    );
    expect(await rpc(ids.token)).not.toBeNull();
  });

  it('stops working once it has expired, and works until then', async () => {
    let token = '';
    await asUser(db, alice.userId, async (q) => {
      token = (
        await q<{ token: string }>(
          "insert into share_links (programme_id, expires_at) values ($1, now() + interval '1 day') returning token",
          [ids.programme],
        )
      )[0]!.token;
    });
    expect(await rpc(token)).not.toBeNull();
    await asUser(db, alice.userId, (q) =>
      q("update share_links set expires_at = now() - interval '1 minute' where token = $1", [token]),
    );
    expect(await rpc(token)).toBeNull();
  });

  it('stops working when the programme is deleted', async () => {
    let token = '';
    let programme = '';
    await asUser(db, alice.userId, async (q) => {
      programme = (
        await q<{ id: string }>(
          "insert into programmes (client_id, gym_id, title) values ($1,$2,'Temp') returning id",
          [ids.client, ids.gym],
        )
      )[0]!.id;
      token = (
        await q<{ token: string }>('insert into share_links (programme_id) values ($1) returning token', [
          programme,
        ])
      )[0]!.token;
    });
    expect(await rpc(token)).not.toBeNull();
    await asUser(db, alice.userId, (q) => q('delete from programmes where id = $1', [programme]));
    expect(await rpc(token)).toBeNull();
  });

  it('a programme without a gym returns no floors, and still works', async () => {
    let token = '';
    await asUser(db, alice.userId, async (q) => {
      const p = (
        await q<{ id: string }>(
          "insert into programmes (client_id, title) values ($1,'No gym') returning id",
          [ids.client],
        )
      )[0]!.id;
      token = (
        await q<{ token: string }>('insert into share_links (programme_id) values ($1) returning token', [p])
      )[0]!.token;
    });
    const r = (await rpc(token)) as Shared & { gym: unknown };
    expect(r.floors).toEqual([]);
    expect(r.gym).toBeNull();
  });
});

describe('share links belong to the trainer', () => {
  it('another trainer cannot list, create, revoke or read the links of someone else’s programme', async () => {
    expect(await asUser(db, bob.userId, (q) => q('select * from share_links'))).toHaveLength(0);
    expect(
      await failsAs(db, bob.userId, 'insert into share_links (programme_id) values ($1)', [ids.programme]),
    ).toMatch(/row-level security/);
    await asUser(db, bob.userId, (q) => q('update share_links set revoked_at = now()'));
    expect(await rpc(ids.token)).not.toBeNull(); // bob's update touched nothing
  });

  it('a visitor who is not logged in cannot read the links table, only call the function', async () => {
    await expect(asAnon(db, (q) => q('select * from share_links'))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (q) => q('select * from programmes'))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (q) => q('select * from clients'))).rejects.toThrow(/permission denied/);
  });

  it('new tokens are 64 hex characters (256 random bits) and unique', async () => {
    const tokens = await asUser(db, alice.userId, (q) =>
      q<{ token: string }>('select token from share_links'),
    );
    expect(tokens.length).toBeGreaterThan(1);
    tokens.forEach((t) => expect(t.token).toMatch(/^[0-9a-f]{64}$/));
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);
  });
});
