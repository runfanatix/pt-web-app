import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  addFloor,
  addStruct,
  deleteFloor,
  deleteStruct,
  duplicateZone,
  floorExtent,
  joinCandidates,
  joinZones,
  layoutChanged,
  lineLength,
  moveStructBy,
  moveStructToFloor,
  renameFloor,
  resizeStructBy,
  rotateStruct,
  scaleStruct,
  setFloorSize,
  setStructNumber,
  setStructShared,
  splitPart,
  structPercent,
  uniqueZoneName,
  zoneConnected,
  zonesTouch,
  zoneRects,
} from './index.ts';
import type { Layout } from './schemas.ts';

type Zone = Layout['zones'][number];
type Equip = Layout['equipment'][number];

const zone = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floor = 'f1',
  parts?: Zone['parts'],
): Zone => ({
  id,
  name: id.toUpperCase(),
  cat: 'cardio',
  x,
  y,
  w,
  h,
  floor,
  ...(parts ? { parts } : {}),
});
const equip = (id: string, zoneId: string, x: number, y: number, floor = 'f1'): Equip => ({
  id,
  name: id,
  zone: zoneId,
  type: 'machine',
  x,
  y,
  muscles: ['legs'],
  notes: '',
  floor,
});
const base = (): Layout => ({
  floors: [
    { id: 'f1', name: 'Ground', w: 1000, h: 620 },
    { id: 'f2', name: 'First', w: 800, h: 500 },
  ],
  zones: [zone('a', 100, 100, 200, 150), zone('b', 300, 100, 200, 150), zone('c', 50, 50, 300, 200, 'f2')],
  structs: [],
  equipment: [
    equip('m1', 'a', 150, 160),
    equip('m2', 'a', 250, 200),
    equip('m3', 'b', 350, 160),
    equip('m4', 'c', 100, 100, 'f2'),
  ],
});

/* ---- the prototype's own join / split / duplicate, evaluated from its source ---- */
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
interface ProtoState {
  zones: Zone[];
  equipment: Equip[];
  floors: Layout['floors'];
  library: { equipmentIds: string[] }[];
  floor: string;
  [k: string]: unknown;
}
const sandbox: Record<string, unknown> = { state: {} as ProtoState, ids: 0 };
Object.assign(sandbox, {
  toast() {},
  commit() {},
  clone: (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown,
  newId: (p: string) => `${p}-new`,
});
const reference = runInNewContext(
  `var TOUCH = 12, MINSPAN = 16, MAXPARTS = 11, CMIN_W = 600, CMIN_H = 400, CMAX_W = 2400, CMAX_H = 1800;
   function clampN(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
   function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
   function getZone(id) { for (var i = 0; i < state.zones.length; i++) { if (state.zones[i].id === id) return state.zones[i]; } return null; }
   function getFloor(id) { for (var i = 0; i < state.floors.length; i++) { if (state.floors[i].id === id) return state.floors[i]; } return null; }
   function eqIn(zid) { return state.equipment.filter(function (e) { return e.zone === zid; }); }
   function cw() { return getFloor(state.floor).w; }
   function ch() { return getFloor(state.floor).h; }
   function sn(v) { return Math.round(v); }
   ${slice('function zoneRects(z)', 'function partIndex')}
   ${slice('function zoneBox(z)', 'function inRect')}
   ${slice('function zoneAnchor(z)', '/* where the name sits')}
   ${slice('function zoneCenter(z)', 'function rectsTouch')}
   ${slice('function rectsTouch(a, b)', '/* outline of the union')}
   ${slice('function uniqueZoneName', 'function joinCandidates')}
   ${slice('function fitEquipment(z)', 'function zoneNumField')}
   ${slice('function closeGap', 'function shapeSnap')}
   ({ joinZones, splitPart, duplicateZone, zonesTouch, zoneConnected })`,
  sandbox,
) as {
  joinZones: (a: string, b: string) => void;
  splitPart: (z: string, i: number) => void;
  duplicateZone: (z: string, f: string, withEq: boolean) => void;
  zonesTouch: (a: Zone, b: Zone) => boolean;
  zoneConnected: (z: Zone) => boolean;
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rects = (z: Zone) => zoneRects(z).map((r) => [r.x, r.y, r.w, r.h]);
const byId = <T extends { id: string }>(l: T[]) => l.slice().sort((a, b) => a.id.localeCompare(b.id));

describe('join, split and duplicate follow the prototype', () => {
  const r = rng(7);
  const rnd = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const randomLayout = (): Layout => {
    const l = base();
    l.zones = [
      zone('a', rnd(50, 300), rnd(50, 200), rnd(60, 250), rnd(50, 200)),
      zone('b', rnd(50, 500), rnd(50, 300), rnd(60, 250), rnd(50, 200)),
      zone('c', 50, 50, 300, 200, 'f2'),
    ];
    l.equipment = [
      equip('m1', 'a', l.zones[0]!.x + 20, l.zones[0]!.y + 20),
      equip('m2', 'b', l.zones[1]!.x + 20, l.zones[1]!.y + 20),
      equip('m4', 'c', 100, 100, 'f2'),
    ];
    return l;
  };
  function protoRun(l: Layout, fn: () => void): Layout {
    const st = clone(l) as unknown as ProtoState;
    st.library = [];
    st.floor = 'f1';
    sandbox.state = st;
    fn();
    return { floors: st.floors, zones: st.zones, structs: [], equipment: st.equipment };
  }

  it('touch tests agree on 300 random pairs', () => {
    let touching = 0;
    for (let i = 0; i < 300; i++) {
      const l = randomLayout();
      const [a, b] = l.zones as [Zone, Zone];
      protoRun(l, () => {});
      const expected = reference.zonesTouch(a, b);
      if (expected) touching += 1;
      expect(zonesTouch(a, b)).toBe(expected);
      expect(zoneConnected(a)).toBe(reference.zoneConnected(a));
    }
    expect(touching).toBeGreaterThan(10);
  });

  it('join gives the same zone, parts and machines on 200 random touching pairs', () => {
    let n = 0;
    for (let i = 0; i < 600 && n < 200; i++) {
      const l = randomLayout();
      if (!zonesTouch(l.zones[0]!, l.zones[1]!)) continue;
      n += 1;
      const want = protoRun(l, () => reference.joinZones('a', 'b'));
      const got = joinZones(l, 'a', 'b');
      expect(got.ok).toBe(true);
      if (!got.ok) continue;
      expect(got.layout.zones.map((z) => [z.id, z.x, z.y, z.w, z.h, rects(z)])).toEqual(
        want.zones.map((z) => [z.id, z.x, z.y, z.w, z.h, rects(z)]),
      );
      expect(byId(got.layout.equipment).map((e) => [e.id, e.zone])).toEqual(
        byId(want.equipment).map((e) => [e.id, e.zone]),
      );
    }
    expect(n).toBe(200);
  });

  it('split gives the same two zones and machine ownership', () => {
    let n = 0;
    for (let i = 0; i < 600 && n < 150; i++) {
      const l = randomLayout();
      if (!zonesTouch(l.zones[0]!, l.zones[1]!)) continue;
      const j = joinZones(l, 'a', 'b');
      if (!j.ok) continue;
      for (const idx of [0, 1]) {
        n += 1;
        const want = protoRun(j.layout, () => reference.splitPart('a', idx));
        const got = splitPart(j.layout, 'a', idx, 'z-new');
        expect(got).not.toBeNull();
        expect(got!.layout.zones.map((z) => [z.id, z.name, rects(z)])).toEqual(
          want.zones.map((z) => [z.id, z.name, rects(z)]),
        );
        expect(byId(got!.layout.equipment).map((e) => [e.id, e.zone, e.x, e.y])).toEqual(
          byId(want.equipment).map((e) => [e.id, e.zone, e.x, e.y]),
        );
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('duplicate matches on the same floor and on another, with and without machines', () => {
    for (let i = 0; i < 100; i++) {
      const l = randomLayout();
      for (const [target, withEq] of [
        ['f1', true],
        ['f2', true],
        ['f1', false],
      ] as const) {
        const want = protoRun(l, () => reference.duplicateZone('a', target, withEq));
        const got = duplicateZone(l, 'a', 'z-new', target, withEq, ['n1', 'n2', 'n3']);
        expect(got).not.toBeNull();
        const wz = want.zones[want.zones.length - 1]!;
        const gz = got!.layout.zones[got!.layout.zones.length - 1]!;
        expect([gz.name, gz.floor, ...rects(gz).flat()]).toEqual([wz.name, wz.floor, ...rects(wz).flat()]);
        expect(got!.layout.floors).toEqual(want.floors);
        const pos = (list: Equip[]) =>
          list.map((e) => [e.floor, e.zone === wz.id || e.zone === 'z-new', e.x, e.y]);
        expect(pos(got!.layout.equipment.slice(l.equipment.length))).toEqual(
          pos(want.equipment.slice(l.equipment.length)),
        );
      }
    }
  });
});

describe('joining and splitting: rules', () => {
  it('only touching zones on the same floor can be joined, and the machines come along', () => {
    const l = base();
    expect(joinCandidates(l, 'a').map((z) => z.id)).toEqual(['b']);
    expect(joinZones(l, 'a', 'c').ok).toBe(false);
    const j = joinZones(l, 'a', 'b');
    expect(j.ok && j.layout.zones.map((z) => z.id)).toEqual(['a', 'c']);
    expect(j.ok && j.layout.equipment.find((e) => e.id === 'm3')!.zone).toBe('a');
    expect(j.ok && j.firstPart).toBe(1);
  });

  it('refuses a join that would make more than 12 parts', () => {
    const l = base();
    l.zones[0] = zone(
      'a',
      100,
      100,
      200,
      150,
      'f1',
      Array.from({ length: 11 }, (_, i) => ({ x: 100, y: 250 + i, w: 200, h: 20 })),
    );
    const j = joinZones(l, 'a', 'b');
    expect(j.ok).toBe(false);
  });

  it('a zone with a loose part is not connected, and split lets it go', () => {
    const z = zone('a', 100, 100, 100, 100, 'f1', [{ x: 600, y: 400, w: 100, h: 100 }]);
    expect(zoneConnected(z)).toBe(false);
    const l = base();
    l.zones[0] = z;
    const s = splitPart(l, 'a', 1, 'z9');
    expect(s?.name).toBe('A (split)');
    expect(s?.layout.zones.find((q) => q.id === 'a')?.parts).toBeUndefined();
    expect(splitPart(base(), 'a', 0, 'z9')).toBeNull();
  });

  it('unique names count up', () => {
    const l = base();
    expect(uniqueZoneName(l, 'A')).toBe('A 2');
    expect(uniqueZoneName(l, 'Fresh')).toBe('Fresh');
  });

  it('a duplicate lists each copied machine so its links can be copied after saving', () => {
    const d = duplicateZone(base(), 'a', 'za', 'f1', true, ['n1', 'n2'])!;
    expect(d.copies).toEqual([
      { from: 'm1', to: 'n1' },
      { from: 'm2', to: 'n2' },
    ]);
    expect(d.name).toBe('A copy');
    expect(d.layout.equipment.filter((e) => e.zone === 'za')).toHaveLength(2);
  });
});

describe('architecture', () => {
  const withStairs = () => addStruct(base(), 'stairs', 'f1', 's1', true);

  it('new structures start near the middle, with the prototype defaults', () => {
    const l = withStairs();
    const s = l.structs[0]!;
    expect([s.w, s.h, s.label, s.shared]).toEqual([80, 44, 'STAIRS', true]);
    expect([s.x, s.y]).toEqual([460, 290]);
    const w = addStruct(base(), 'wall', 'f1', 'w1', false).structs[0]!;
    expect([w.x, w.y, w.x2, w.y2]).toEqual([430, 310, 570, 310]);
    expect(addStruct(base(), 'door', 'f1', 'd', false).structs[0]!.shared).toBe(false);
    expect(addStruct(base(), 'nope', 'f1', 'x', false)).toEqual(base());
  });

  it('stairs and lifts are shared by default and show on every floor; other kinds are not', () => {
    const l = withStairs();
    expect(l.structs[0]!.shared).toBe(true);
    const off = setStructShared(l, 's1', false, 'f2');
    expect(off.structs[0]!.shared).toBe(false);
    expect(off.structs[0]!.floor).toBe('f2');
    const door = addStruct(base(), 'door', 'f1', 'd1', false);
    expect(setStructShared(door, 'd1', true, 'f1')).toBe(door);
  });

  it('dragging keeps a box on the floor, a line whole, and snaps', () => {
    const l = withStairs();
    const moved = moveStructBy(l, 's1', 5000, 5000, 'f1', true).structs[0]!;
    expect([moved.x, moved.y]).toEqual([1000 - 80, 620 - 44]);
    const wall = addStruct(base(), 'wall', 'f1', 'w1', false);
    const w = moveStructBy(wall, 'w1', -9999, 0, 'f1', false).structs[0]!;
    expect([w.x, w.x2]).toEqual([0, 140]);
    const snapped = moveStructBy(l, 's1', 13, 7, 'f1', true).structs[0]!;
    expect(snapped.x % 10).toBe(0);
  });

  it('pulling a grip resizes a box (min 16) or moves one end of a line', () => {
    const l = withStairs();
    const r = resizeStructBy(l, 's1', 'se', 40, 10, 'f1', false).structs[0]!;
    expect([r.w, r.h]).toEqual([120, 54]);
    const tiny = resizeStructBy(l, 's1', 'e', -999, 0, 'f1', false).structs[0]!;
    expect(tiny.w).toBe(16);
    const wall = addStruct(base(), 'wall', 'f1', 'w1', false);
    const p2 = resizeStructBy(wall, 'w1', 'p2', 60, 0, 'f1', false).structs[0]!;
    expect([p2.x, p2.x2]).toEqual([430, 630]);
    expect(lineLength(p2)).toBe(200);
  });

  it('scale is a percentage of the default and a box grows about its centre', () => {
    const l = withStairs();
    expect(structPercent(l.structs[0]!)).toBe(100);
    const big = scaleStruct(l, 's1', 200, 'f1').structs[0]!;
    expect([big.w, big.h]).toEqual([160, 88]);
    expect(structPercent(big)).toBe(200);
    expect(scaleStruct(l, 's1', 5000, 'f1').structs[0]!.w).toBe(480);
    const wall = addStruct(base(), 'wall', 'f1', 'w1', false);
    expect(lineLength(scaleStruct(wall, 'w1', 50, 'f1').structs[0]!)).toBe(70);
  });

  it('a quarter turn swaps a box, turns a symbol, swings a line', () => {
    const box = rotateStruct(withStairs(), 's1', 'f1').structs[0]!;
    expect([box.w, box.h]).toEqual([44, 80]);
    const door = addStruct(base(), 'door', 'f1', 'd', false);
    const d4 = [1, 2, 3, 4].reduce((acc) => rotateStruct(acc, 'd', 'f1'), door);
    expect(d4.structs[0]!.rot).toBe(0);
    expect(rotateStruct(door, 'd', 'f1').structs[0]!.rot).toBe(90);
    const wall = rotateStruct(addStruct(base(), 'wall', 'f1', 'w', false), 'w', 'f1').structs[0]!;
    expect([wall.x2, wall.y2]).toEqual([430, 450]);
  });

  it('typed numbers are clamped; moving to a smaller floor pulls it back on', () => {
    const l = withStairs();
    expect(setStructNumber(l, 's1', 'w', 9999, 'f1').structs[0]!.w).toBe(600);
    expect(setStructNumber(l, 's1', 'x', 'abc', 'f1')).toBe(l);
    const off = setStructShared(l, 's1', false, 'f1');
    const moved = moveStructToFloor(off, 's1', 'f2').structs[0]!;
    expect(moved.floor).toBe('f2');
    expect(moved.x + 80).toBeLessThanOrEqual(800);
    expect(deleteStruct(l, 's1').structs).toHaveLength(0);
  });
});

describe('floors', () => {
  it('adds a floor like the first, and names and resizes it', () => {
    const l = addFloor(base(), 'f3');
    expect(l.floors[2]).toEqual({ id: 'f3', name: 'Floor 3', w: 1000, h: 620 });
    expect(renameFloor(l, 'f3', '  Roof ').floors[2]!.name).toBe('Roof');
    expect(renameFloor(l, 'f3', '   ')).toBe(l);
    expect(setFloorSize(l, 'f3', 5000, 100).floors[2]).toMatchObject({ w: 2400, h: 400 });
  });

  it('a floor cannot shrink below what is on it', () => {
    const l = base();
    const min = floorExtent(l, 'f1');
    expect(min.w).toBeGreaterThanOrEqual(600);
    const small = setFloorSize(l, 'f1', 600, 400).floors[0]!;
    expect(small.w).toBeGreaterThanOrEqual(500);
    expect(small.h).toBeGreaterThanOrEqual(400);
  });

  it('deleting a floor removes its zones and machines, keeps shared stairs, and never the last floor', () => {
    let l = base();
    l = addStruct(l, 'stairs', 'f2', 's1', false);
    l = addStruct(l, 'wall', 'f2', 'w1', false);
    const r = deleteFloor(l, 'f2');
    expect(r.layout.floors.map((f) => f.id)).toEqual(['f1']);
    expect(r.layout.zones.map((z) => z.id)).toEqual(['a', 'b']);
    expect(r.removedMachines).toEqual(['m4']);
    expect(r.removedZones).toBe(1);
    expect(r.removedStructs).toBe(1);
    expect(r.layout.structs.map((s) => [s.id, s.floor])).toEqual([['s1', 'f1']]);
    const one = deleteFloor(r.layout, 'f1');
    expect(one.layout).toBe(r.layout);
  });

  it('floor and structure changes count as unsaved', () => {
    const l = base();
    expect(layoutChanged(l, addFloor(l, 'f3'))).toBe(true);
    expect(layoutChanged(l, addStruct(l, 'wall', 'f1', 'w', false))).toBe(true);
    expect(layoutChanged(l, renameFloor(l, 'f1', 'Ground'))).toBe(false);
  });
});
