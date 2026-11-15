import { describe, expect, it } from 'vitest';
import {
  buildHistoryEntry,
  fmtDate,
  historyFromRows,
  isoOf,
  rowsFromEntry,
  runLogText,
  type HistoryEntry,
} from './history.ts';
import { next, start, tick } from './run.ts';
import type { SessionItem } from './session.ts';
import type { Layout } from './schemas.ts';

type Equip = Layout['equipment'][number];

const item = (uid: string, eid: string, over: Partial<SessionItem> = {}): SessionItem => ({
  uid,
  eid,
  xid: null,
  exercise: `Ex ${uid}`,
  sets: 3,
  reps: '10',
  rest: 60,
  note: '',
  ...over,
});
const equip = (id: string, name: string): Equip => ({
  id,
  name,
  zone: 'z',
  type: 'machine',
  x: 0,
  y: 0,
  muscles: [],
  notes: '',
  floor: 'f',
});
const equipment = new Map([
  ['m1', equip('m1', 'Treadmill')],
  ['m2', equip('m2', 'Leg press')],
]);
const meta = { title: 'Leg day', client: 'Sam', coach: 'Dee', date: '2026-11-15', notes: '' };
const gym = { id: 'g1', name: 'Virgin Active Bedfordview' };
const place = (e: Equip) => `Zone of ${e.name}`;

function finishedRun() {
  const items = [item('a', 'm1', { sets: 1, reps: '8 min', rest: 0 }), item('b', 'm2'), item('c', 'gone')];
  const started = new Date(2026, 10, 15, 9, 30).getTime();
  let r = start(items, started);
  r = next(r, items, started + 65_000); // a: 65 s
  r = next(r, items, started + 125_000); // b: 60 s
  r = tick(r, started + 140_000); // c: 15 s, not completed
  return { items, r, started };
}

describe('buildHistoryEntry', () => {
  it('records each step with its time, completion and the names at the time', () => {
    const { items, r, started } = finishedRun();
    const e = buildHistoryEntry({ id: 'r1', run: r, items, meta, equipment, place, gym })!;
    expect(e).toMatchObject({
      id: 'r1',
      title: 'Leg day',
      clientName: 'Sam',
      coach: 'Dee',
      gymId: 'g1',
      gymName: gym.name,
      startedAt: started,
      date: '2026-11-15',
      totalMs: 140_000,
      doneN: 2,
    });
    expect(e.steps.map((s) => [s.n, s.machine, s.ms, s.done, s.order])).toEqual([
      [1, 'Treadmill', 65_000, true, 1],
      [2, 'Leg press', 60_000, true, 2],
      [3, 'Machine', 15_000, false, 0],
    ]);
    expect(e.steps[0]!.zone).toBe('Zone of Treadmill');
    expect(e.steps[2]!.eid).toBe(''); // the machine is gone from the plan
    expect(e.plannedMin).toBe(Math.round((8 * 60 + (3 * 45 + 2 * 60) + (3 * 45 + 2 * 60)) / 60));
  });

  it('falls back to "Workout" for an untitled session and skips a run with no time', () => {
    const { items, r } = finishedRun();
    expect(
      buildHistoryEntry({ id: 'r', run: r, items, meta: { ...meta, title: '' }, equipment, place, gym })!
        .title,
    ).toBe('Workout');
    expect(
      buildHistoryEntry({ id: 'r', run: start(items, 0), items, meta, equipment, place, gym }),
    ).toBeNull();
    expect(
      buildHistoryEntry({
        id: 'r',
        run: start(items, 0),
        items,
        meta,
        equipment,
        place,
        gym,
        allowEmpty: true,
      }),
    ).not.toBeNull();
  });
});

describe('runLogText', () => {
  it('writes the WhatsApp-style log with times and what was not completed', () => {
    const { items, r } = finishedRun();
    const e = buildHistoryEntry({ id: 'r1', run: r, items, meta, equipment, place, gym })!;
    const lines = runLogText(e).split('\n');
    expect(lines[0]).toBe('*Leg day* - workout log');
    expect(lines).toContain('Client: Sam');
    expect(lines).toContain(`Gym: ${gym.name}`);
    expect(lines).toContain(`Date: ${fmtDate('2026-11-15')}`);
    expect(lines).toContain(
      'Total time: 02:20 (planned about 8 min)'.replace('8 min', `${e.plannedMin} min`),
    );
    expect(lines).toContain('1. Treadmill - Ex a: 01:05');
    expect(lines).toContain('3. Machine - Ex c: 00:15 (not completed)');
  });

  it('omits client and gym lines when empty', () => {
    const { items, r } = finishedRun();
    const e = buildHistoryEntry({
      id: 'r1',
      run: r,
      items,
      meta: { ...meta, client: '' },
      equipment,
      place,
      gym: { id: 'g1', name: '' },
    })!;
    const text = runLogText(e);
    expect(text).not.toContain('Client:');
    expect(text).not.toContain('Gym:');
  });
});

describe('database rows', () => {
  const entry = (): HistoryEntry => {
    const { items, r } = finishedRun();
    return buildHistoryEntry({ id: 'r1', run: r, items, meta, equipment, place, gym })!;
  };

  it('round-trips an entry through the row shapes', () => {
    const e = entry();
    const { run, steps } = rowsFromEntry('trainer-1', e);
    expect(run).toMatchObject({
      id: 'r1',
      trainer_id: 'trainer-1',
      gym_id: 'g1',
      total_ms: 140_000,
      run_date: '2026-11-15',
    });
    expect(steps[2]).toMatchObject({ equipment_id: null, done: false, step_order: 0 });
    const back = historyFromRows([{ ...run, run_steps: steps }]);
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(e);
  });

  it('sorts newest first, orders steps, and accepts bigint columns delivered as strings', () => {
    const e = entry();
    const older = rowsFromEntry('t', { ...e, id: 'old', startedAt: e.startedAt - 86_400_000 });
    const newer = rowsFromEntry('t', e);
    const rows = [
      {
        ...older.run,
        total_ms: '5000',
        run_steps: older.steps
          .slice()
          .reverse()
          .map((s) => ({ ...s, ms: String(s.ms) })),
      },
      { ...newer.run, run_steps: newer.steps },
    ];
    const out = historyFromRows(rows);
    expect(out.map((x) => x.id)).toEqual(['r1', 'old']);
    expect(out[1]!.totalMs).toBe(5000);
    expect(out[1]!.steps.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('rejects malformed rows', () => {
    expect(() => historyFromRows([{ id: 'x' }])).toThrow();
  });

  it('formats dates', () => {
    expect(isoOf(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });
});
