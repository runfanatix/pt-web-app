import { describe, expect, it } from 'vitest';
import {
  buildClientExport,
  clientRecordsFromRows,
  clientToRow,
  consentToRow,
  programmeToRows,
} from './clients.ts';
import { ClientSchema } from './schemas.ts';
import type { HistoryEntry } from './history.ts';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Carla',
  whatsapp: '082 111 2222',
  email: 'carla@example.com',
  emergency_name: 'Mum',
  emergency_phone: '082 333 4444',
  emergency_relation: 'Mother',
  plan: '3 x week',
  sub_status: 'active',
  per_week: 3,
  sessions_left: 8,
  renewal: '2026-12-01',
  goals: 'Run 10k',
  private_notes: 'bad knee',
  date_of_birth: '1990-04-02',
  guardian_name: '',
  retention_until: null,
  created_at: '2026-11-01T08:00:00Z',
  consents: [
    {
      purpose: 'health-information',
      detail: '',
      granted: true,
      granted_at: '2026-11-01T08:05:00Z',
      notice_version: '1.0-draft',
    },
  ],
  programmes: [
    {
      id: 'p-old',
      title: 'Older',
      notes: '',
      assigned_at: '2026-11-02T08:00:00Z',
      gym_id: 'g1',
      programme_items: [],
    },
    {
      id: 'p-new',
      title: 'Newer',
      notes: 'Easy',
      assigned_at: '2026-11-09T08:00:00Z',
      gym_id: null,
      programme_items: [
        {
          position: 1,
          equipment_id: null,
          exercise_id: 'x2',
          exercise_name: 'Row',
          sets: 3,
          reps: '12',
          rest: 60,
          note: '',
        },
        {
          position: 0,
          equipment_id: 'm1',
          exercise_id: 'x1',
          exercise_name: 'Squat',
          sets: 4,
          reps: '8',
          rest: 90,
          note: 'slow',
        },
      ],
    },
  ],
  ...over,
});

describe('clientRecordsFromRows', () => {
  it('maps a client with consents and programmes, newest programme first, items in order', () => {
    const [rec] = clientRecordsFromRows([row()]);
    expect(rec!.client).toMatchObject({
      id: 'c1',
      name: 'Carla',
      subStatus: 'active',
      privateNotes: 'bad knee',
      dateOfBirth: '1990-04-02',
    });
    expect(rec!.consents).toEqual([
      {
        purpose: 'health-information',
        detail: '',
        granted: true,
        grantedAt: '2026-11-01T08:05:00Z',
        noticeVersion: '1.0-draft',
        wording: '',
      },
    ]);
    expect(rec!.programmes.map((p) => p.title)).toEqual(['Newer', 'Older']);
    expect(rec!.programmes[0]!.items.map((i) => i.exercise)).toEqual(['Squat', 'Row']);
    expect(rec!.programmes[0]!.items[1]!.eid).toBe(''); // the machine was deleted
  });

  it('lists clients by name, ignoring case', () => {
    const out = clientRecordsFromRows([
      row({ id: 'b', name: 'bob' }),
      row({ id: 'a', name: 'Alice' }),
      row({ id: 'c', name: 'Carla' }),
    ]);
    expect(out.map((r) => r.client.name)).toEqual(['Alice', 'bob', 'Carla']);
  });

  it('shows a stored email as is, and rejects structurally bad rows', () => {
    expect(clientRecordsFromRows([row({ email: 'not-an-email' })])[0]!.client.email).toBe('not-an-email');
    expect(() => clientRecordsFromRows([{ id: 'x' }])).toThrow();
    expect(() => clientRecordsFromRows([row({ sub_status: 'vip' })])).toThrow();
  });
});

describe('writing', () => {
  const client = ClientSchema.parse({
    id: 'c1',
    name: '  Carla  ',
    whatsapp: ' 082 ',
    renewal: '',
    dateOfBirth: null,
    goals: 'Run 10k',
  });

  it('trims text and turns blank dates into null', () => {
    const r = clientToRow('t1', client);
    expect(r).toMatchObject({
      trainer_id: 't1',
      name: 'Carla',
      whatsapp: '082',
      renewal: null,
      date_of_birth: null,
      retention_until: null,
    });
  });

  it('a consent record carries the wording and version shown, and withdrawal is granted = false', () => {
    expect(consentToRow('t1', 'c1', { purpose: 'marketing', granted: true, wording: 'Yes, …' })).toEqual({
      trainer_id: 't1',
      client_id: 'c1',
      subject: 'client',
      purpose: 'marketing',
      detail: '',
      granted: true,
      notice_version: '1.0-draft',
      wording: 'Yes, …',
    });
    expect(
      consentToRow('t1', 'c1', { purpose: 'sharing', detail: 'Dr Smith', granted: false, wording: 'w' })
        .granted,
    ).toBe(false);
  });

  it('assigns a routine as a programme with ordered items; a deleted machine becomes null', () => {
    const rows = programmeToRows('c1', 'g1', { title: '  ', notes: 'n' }, [
      { eid: 'm1', xid: 'x1', exercise: 'Squat', sets: 3, reps: '10', rest: 60, note: '' },
      { eid: '', xid: null, exercise: 'Free', sets: 1, reps: '5 min', rest: 0, note: 'warm up' },
    ]);
    expect(rows.programme).toEqual({ client_id: 'c1', gym_id: 'g1', title: 'Programme', notes: 'n' });
    expect(rows.items('p1')).toEqual([
      {
        programme_id: 'p1',
        position: 0,
        equipment_id: 'm1',
        exercise_id: 'x1',
        exercise_name: 'Squat',
        sets: 3,
        reps: '10',
        rest: 60,
        note: '',
      },
      {
        programme_id: 'p1',
        position: 1,
        equipment_id: null,
        exercise_id: null,
        exercise_name: 'Free',
        sets: 1,
        reps: '5 min',
        rest: 0,
        note: 'warm up',
      },
    ]);
  });
});

describe('access request export', () => {
  const [rec] = clientRecordsFromRows([row()]);
  const run: HistoryEntry = {
    id: 'r1',
    clientId: 'c1',
    clientName: 'Carla',
    coach: '',
    title: 'Leg day',
    date: '2026-11-10',
    startedAt: 0,
    totalMs: 125_000,
    plannedMin: 30,
    doneN: 1,
    steps: [
      {
        n: 1,
        eid: '',
        machine: 'Rig',
        zone: '',
        exercise: 'Squat',
        sets: 3,
        reps: '10',
        rest: 60,
        ms: 1,
        done: true,
        order: 1,
      },
    ],
    gymId: null,
    gymName: 'Gym',
  };
  const out = buildClientExport(rec!, {
    runs: [run],
    consents: [
      {
        purpose: 'health-information',
        detail: '',
        granted: true,
        grantedAt: '2026-11-01T08:05:00Z',
        noticeVersion: '1.0-draft',
        wording: '',
      },
    ],
    trainerName: 'Alice Fitness',
    generatedOn: '2026-11-15',
  });

  it('is readable, and includes the notes held about the client', () => {
    expect(out.text).toContain('Information held about Carla by Alice Fitness');
    expect(out.text).toContain('Notes held about you: bad knee');
    expect(out.text).toContain('Goals: Run 10k');
    expect(out.text).toContain('Programmes (2)');
    expect(out.text).toContain('1. Squat: 4 x 8, rest 90 s (slow)');
    expect(out.text).toContain('2026-11-10 Leg day: 02:05, 1 of 1 steps done');
    expect(out.text).toContain('health-information: agreed (wording version 1.0-draft)');
  });

  it('also comes as JSON with the same data', () => {
    const parsed = JSON.parse(out.json);
    expect(parsed.client.name).toBe('Carla');
    expect(parsed.programmes).toHaveLength(2);
    expect(parsed.workouts).toHaveLength(1);
    expect(parsed.consents).toHaveLength(1);
  });
});
