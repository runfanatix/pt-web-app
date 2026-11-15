import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  cleanSnaps,
  estimateSeconds,
  exercisesFor,
  itemFromExercise,
  itemsPerFloor,
  moveItem,
  remapEid,
  remapItems,
  routeForFloor,
  routePlaces,
  rxText,
  sessionIndices,
  type EquipRef,
  type LibraryExercise,
  type SessionItem,
} from './session.ts';
import type { ItemSnap, Layout } from './schemas.ts';

type Equip = Layout['equipment'][number];

/* ---- the prototype's own functions as reference ---- */
const proto = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'prototype', 'zone-planner-v11.html'),
  'utf8',
);
function slice(from: string, to: string): string {
  const a = proto.indexOf(from);
  const b = proto.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`prototype markers not found: ${from}`);
  return proto.slice(a, b);
}
const reference = runInNewContext(
  `${slice('function S(v)', 'function itemsFromSnap')}
   ${slice('function remapEid(', 'function planSwitch')}
   ${slice('function calcSecs(', 'function routeZones')}
   ({ remapEid, calcSecs, cleanSnap })`,
  { state: { session: { items: [] } } },
) as {
  remapEid: (
    eid: string,
    xid: string | null,
    name: string | undefined,
    type: string | undefined,
    eq: EquipRef[],
    links: Record<string, string[]>,
  ) => string;
  calcSecs: (list: unknown[]) => number;
  cleanSnap: (arr: unknown) => ItemSnap[];
};

const item = (uid: string, eid: string, over: Partial<SessionItem> = {}): SessionItem => ({
  uid,
  eid,
  xid: null,
  exercise: 'Ex',
  sets: 3,
  reps: '10',
  rest: 60,
  note: '',
  ...over,
});
const eq = (id: string, floor: string, x: number, y: number, over: Partial<Equip> = {}): Equip => ({
  id,
  name: id,
  zone: 'z',
  type: 'machine',
  x,
  y,
  muscles: [],
  notes: '',
  floor,
  ...over,
});
const byId = (list: Equip[]) => new Map(list.map((e) => [e.id, e]));

describe('session basics', () => {
  it('numbers markers, and a machine used twice gets both numbers', () => {
    expect(sessionIndices([item('a', 'm1'), item('b', 'm2'), item('c', 'm1')])).toEqual({
      m1: [1, 3],
      m2: [2],
    });
  });

  it('moves items up and down, clamped, without mutating', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(list, 0, -5)).toBe(list);
    expect(moveItem(list, 1, 99)).toEqual(['a', 'c', 'b']);
    expect(moveItem(list, 7, 0)).toBe(list);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('describes a prescription like the prototype', () => {
    expect(rxText({ sets: 3, reps: '10', rest: 60 })).toBe('3 x 10 · 60 s rest');
    expect(rxText({ sets: 1, reps: '8 min', rest: 0 })).toBe('1 x 8 min');
  });

  it("lists a machine's linked exercises by name and builds items from them", () => {
    const lib: LibraryExercise[] = [
      {
        id: 'x2',
        name: 'squat',
        muscles: [],
        level: 'B',
        sets: 3,
        reps: '8',
        rest: 90,
        cue: '',
        equipmentIds: ['m1'],
      },
      {
        id: 'x1',
        name: 'Bench',
        muscles: [],
        level: 'I',
        sets: 4,
        reps: '6',
        rest: 120,
        cue: '',
        equipmentIds: ['m1', 'm2'],
      },
      {
        id: 'x3',
        name: 'Row',
        muscles: [],
        level: 'B',
        sets: 3,
        reps: '10',
        rest: 60,
        cue: '',
        equipmentIds: ['m2'],
      },
    ];
    expect(exercisesFor(lib, 'm1').map((x) => x.name)).toEqual(['Bench', 'squat']);
    expect(itemFromExercise('u1', 'm1', lib[1]!)).toEqual({
      uid: 'u1',
      eid: 'm1',
      xid: 'x1',
      exercise: 'Bench',
      sets: 4,
      reps: '6',
      rest: 120,
      note: '',
    });
  });
});

describe('estimateSeconds', () => {
  it('allows 45 s per set, or the minutes in reps, plus rest between sets', () => {
    expect(estimateSeconds([{ sets: 3, reps: '10', rest: 60 }])).toBe(3 * 45 + 2 * 60);
    expect(estimateSeconds([{ sets: 1, reps: '8 min', rest: 0 }])).toBe(480);
    expect(estimateSeconds([{ sets: 0, reps: '', rest: 30 }])).toBe(45);
  });

  it('agrees with the prototype on a spread of inputs', () => {
    const lists = [
      [
        { sets: 3, reps: '10', rest: 60 },
        { sets: 1, reps: '20 min', rest: 0 },
      ],
      [
        { sets: 5, reps: '8-10', rest: 90 },
        { sets: 2, reps: '45 s', rest: 15 },
        { sets: 4, reps: '1 min', rest: 30 },
      ],
      [{ sets: '3', reps: '12 each side', rest: '45' }],
      [],
    ];
    for (const l of lists) expect(estimateSeconds(l as never)).toBe(reference.calcSecs(l));
  });
});

describe('route', () => {
  const eqs = [eq('a', 'f1', 10, 10), eq('b', 'f1', 100, 10), eq('c', 'f2', 50, 50), eq('d', 'f1', 200, 200)];
  const map = byId(eqs);

  it('joins consecutive machines on a floor into one polyline', () => {
    const r = routeForFloor([item('1', 'a'), item('2', 'b'), item('3', 'd')], map, 'f1');
    expect(r.polylines).toEqual([
      [
        [10, 10],
        [100, 10],
        [200, 200],
      ],
    ]);
    expect(r.cross).toEqual([]);
  });

  it('repeating the same machine adds no leg', () => {
    const r = routeForFloor([item('1', 'a'), item('2', 'a'), item('3', 'b')], map, 'f1');
    expect(r.polylines).toEqual([
      [
        [10, 10],
        [100, 10],
      ],
    ]);
  });

  it('a floor change ends the line and shows a cross-floor leg on both floors', () => {
    const items = [item('1', 'a'), item('2', 'b'), item('3', 'c'), item('4', 'd')];
    const f1 = routeForFloor(items, map, 'f1');
    expect(f1.polylines).toEqual([
      [
        [10, 10],
        [100, 10],
      ],
    ]);
    expect(f1.cross.map((c) => [c.from.id, c.to.id])).toEqual([
      ['b', 'c'],
      ['c', 'd'],
    ]);
    const f2 = routeForFloor(items, map, 'f2');
    expect(f2.polylines).toEqual([]);
    expect(f2.cross).toHaveLength(2);
  });

  it('ignores items whose machine was removed', () => {
    expect(routeForFloor([item('1', 'gone'), item('2', 'a')], map, 'f1').polylines).toEqual([]);
  });

  it('counts exercises per floor and lists the zones visited without repeats', () => {
    const items = [item('1', 'a'), item('2', 'b'), item('3', 'c')];
    expect(itemsPerFloor(items, map)).toEqual({ f1: 2, f2: 1 });
    const place = (e: Equip) => (e.floor === 'f1' ? 'Cardio' : 'Studio');
    expect(routePlaces(items, map, place)).toEqual(['Cardio', 'Studio']);
  });
});

describe('remapping onto another gym', () => {
  const candidates: EquipRef[] = [
    { id: 'n1', name: 'Leg Press', type: 'machine' },
    { id: 'n2', name: 'Leg press', type: 'free' },
    { id: 'n3', name: 'Treadmill', type: 'cardio' },
  ];
  const links = { x9: ['n3'] };

  it('keeps the same id, then matches by name preferring the same type, then by exercise link', () => {
    expect(remapEid('n3', null, undefined, candidates, links)).toBe('n3');
    expect(remapEid('old', null, { name: ' leg PRESS ', type: 'free' }, candidates, links)).toBe('n2');
    expect(remapEid('old', null, { name: 'leg press', type: 'cardio' }, candidates, links)).toBe('n1');
    expect(remapEid('old', 'x9', { name: 'unknown' }, candidates, links)).toBe('n3');
    expect(remapEid('old', 'x1', { name: 'unknown' }, candidates, links)).toBe('');
  });

  it('agrees with the prototype on 200 generated cases', () => {
    const names = ['Leg press', 'leg press ', 'Treadmill', 'Rower', 'Bench', ''];
    const types = ['machine', 'free', 'cardio', 'rig'];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i++) {
      const cands: EquipRef[] = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, k) => ({
        id: `c${k}`,
        name: names[Math.floor(next() * names.length)]!,
        type: types[Math.floor(next() * types.length)]!,
      }));
      const eid = next() < 0.3 ? 'c0' : 'gone';
      const xid = next() < 0.5 ? 'x' : null;
      const lk = { x: [`c${Math.floor(next() * 5)}`] };
      const oldName = next() < 0.8 ? names[Math.floor(next() * names.length)] : undefined;
      const oldType = types[Math.floor(next() * types.length)];
      expect(
        remapEid(eid, xid, { name: oldName ?? '', type: oldType }, cands, lk),
        JSON.stringify({ eid, xid, oldName, oldType, cands }),
      ).toBe(reference.remapEid(eid, xid, oldName, oldType, cands, lk));
    }
  });

  it('reports kept, moved and skipped items', () => {
    const snaps: ItemSnap[] = [
      { eid: 'n1', xid: null, exercise: 'A', sets: 3, reps: '10', rest: 60, note: '' },
      { eid: 'old1', xid: 'x9', exercise: 'B', sets: 3, reps: '10', rest: 60, note: '' },
      { eid: 'old2', xid: null, exercise: 'C', sets: 3, reps: '10', rest: 60, note: '' },
    ];
    const old = new Map([['old2', { name: 'Treadmill', type: 'cardio' }]]);
    const r = remapItems(snaps, candidates, links, old);
    expect(r).toMatchObject({ kept: 1, moved: 2, skipped: 0 });
    expect(r.items.map((i) => i.eid)).toEqual(['n1', 'n3', 'n3']);
    expect(remapItems([{ ...snaps[2]!, eid: 'nowhere' }], candidates, links).skipped).toBe(1);
  });
});

describe('cleanSnaps', () => {
  it('agrees with the prototype and drops entries without a machine', () => {
    const raw = [
      { eid: 'a', xid: 'x', exercise: 'Squat', sets: '0', reps: 10, rest: -5, note: null },
      { eid: '', exercise: 'no machine' },
      null,
      { eid: 'b', sets: 2.6, rest: '45' },
    ];
    expect(cleanSnaps(raw)).toEqual(reference.cleanSnap(raw));
    expect(cleanSnaps('nope')).toEqual([]);
  });
});
