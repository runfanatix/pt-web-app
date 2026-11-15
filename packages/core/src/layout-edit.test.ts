import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  addEquipment,
  addZone,
  deleteEquipment,
  deleteZone,
  dropEquipment,
  fitEquipment,
  layoutCanonical,
  layoutChanged,
  layoutSavePayload,
  moveEquipment,
  moveZoneBy,
  moveZoneToFloor,
  renameEquipment,
  renameZone,
  resizeRect,
  resizeZonePart,
  setEquipmentFloor,
  setEquipmentNotes,
  setEquipmentZone,
  setZoneCategory,
  setZoneNumber,
  shiftZoneTo,
  snap,
  zoneBox,
  zoneCenter,
  HANDLES,
} from './layout-edit.ts';
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
  zones: [zone('a', 100, 100, 200, 150), zone('b', 400, 100, 200, 150), zone('c', 50, 50, 300, 200, 'f2')],
  structs: [],
  equipment: [
    equip('m1', 'a', 150, 160),
    equip('m2', 'a', 250, 200),
    equip('m3', 'b', 450, 160),
    equip('m4', 'c', 100, 100, 'f2'),
  ],
});

/* ---- the prototype's own helpers, evaluated from its source, as the reference ---- */
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
const sandbox = {
  state: { snap: false, equipment: [] as unknown[] },
  dims: { w: 1000, h: 620 },
  cw() {
    return sandbox.dims.w;
  },
  ch() {
    return sandbox.dims.h;
  },
};
const reference = runInNewContext(
  `${slice('function zoneRects(z)', 'function partIndex')}
   ${slice('function zoneAnchor(z)', '/* where the name sits')}
   ${slice('function zoneCenter(z)', 'function rectsTouch')}
   ${slice('function sn(v)', String.fromCharCode(10))}
   function eqIn(zid) { return state.equipment.filter(function (e) { return e.zone === zid; }); }
   ${slice('function resizeRect(', '/* chips on the plan')}
   ${slice('function fitEquipment(z)', 'function zoneNumField')}
   ({ resizeRect, fitEquipment, shiftZone, zoneCenter })`,
  sandbox,
) as {
  resizeRect: (
    r: object,
    h: string,
    dx: number,
    dy: number,
    minW: number,
    minH: number,
  ) => { x: number; y: number; w: number; h: number };
  fitEquipment: (z: object) => void;
  shiftZone: (z: object, nx: number, ny: number) => void;
  zoneCenter: (z: object) => { x: number; y: number };
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('agrees with the prototype on random cases', () => {
  it('resizeRect: 400 rectangles, grips, drags and snapping', () => {
    const next = rng(11);
    for (let i = 0; i < 400; i++) {
      const r = {
        x: Math.floor(next() * 600),
        y: Math.floor(next() * 400),
        w: 60 + Math.floor(next() * 300),
        h: 50 + Math.floor(next() * 200),
      };
      const handle = HANDLES[Math.floor(next() * HANDLES.length)]!;
      const dx = Math.floor(next() * 500) - 250;
      const dy = Math.floor(next() * 400) - 200;
      const snapOn = next() < 0.5;
      const dims = { w: 600 + Math.floor(next() * 800), h: 400 + Math.floor(next() * 600) };
      sandbox.dims = dims;
      sandbox.state.snap = snapOn;
      const min = next() < 0.5 ? { w: 60, h: 50 } : { w: 16, h: 16 };
      expect(
        resizeRect(r, handle, dx, dy, min, dims, snapOn),
        JSON.stringify({ r, handle, dx, dy, snapOn, dims, min }),
      ).toEqual(reference.resizeRect(clone(r), handle, dx, dy, min.w, min.h));
    }
  });

  it('fitEquipment and shiftZone: random zones, some joined, with machines anywhere', () => {
    const next = rng(77);
    for (let i = 0; i < 200; i++) {
      sandbox.dims = { w: 1000, h: 620 };
      const parts =
        next() < 0.5
          ? [
              {
                x: 150 + Math.floor(next() * 200),
                y: 80 + Math.floor(next() * 200),
                w: 60 + Math.floor(next() * 120),
                h: 50 + Math.floor(next() * 100),
              },
            ]
          : undefined;
      const z = zone(
        'z',
        50 + Math.floor(next() * 300),
        50 + Math.floor(next() * 200),
        80 + Math.floor(next() * 200),
        70 + Math.floor(next() * 150),
        'f1',
        parts,
      );
      const eqs = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, k) =>
        equip(`e${k}`, 'z', Math.floor(next() * 1000), Math.floor(next() * 620), 'f9'),
      );
      const layout: Layout = {
        floors: [{ id: 'f1', name: 'F', w: 1000, h: 620 }],
        zones: [z],
        structs: [],
        equipment: eqs,
      };

      const refZone = clone(z);
      const refEq = clone(eqs);
      sandbox.state.equipment = refEq;
      reference.fitEquipment(refZone);
      const mine = fitEquipment(layout, 'z');
      expect(mine.equipment.map((e) => [e.x, e.y, e.floor])).toEqual(refEq.map((e) => [e.x, e.y, e.floor]));

      const nx = Math.floor(next() * 800) - 100;
      const ny = Math.floor(next() * 500) - 100;
      const refZone2 = clone(z);
      const refEq2 = clone(eqs);
      sandbox.state.equipment = refEq2;
      reference.shiftZone(refZone2, nx, ny);
      const moved = shiftZoneTo(layout, 'z', nx, ny);
      expect(moved.zones[0]!.x).toBe(refZone2.x);
      expect(moved.zones[0]!.y).toBe(refZone2.y);
      expect(moved.zones[0]!.parts).toEqual(refZone2.parts);
      expect(moved.equipment.map((e) => [e.x, e.y])).toEqual(refEq2.map((e) => [e.x, e.y]));
    }
  });

  it('zoneCenter', () => {
    const next = rng(5);
    for (let i = 0; i < 100; i++) {
      const parts =
        next() < 0.6
          ? [
              {
                x: Math.floor(next() * 300),
                y: Math.floor(next() * 300),
                w: 60 + Math.floor(next() * 200),
                h: 50 + Math.floor(next() * 200),
              },
            ]
          : undefined;
      const z = zone(
        'z',
        Math.floor(next() * 300),
        Math.floor(next() * 300),
        60 + Math.floor(next() * 200),
        50 + Math.floor(next() * 200),
        'f1',
        parts,
      );
      expect(zoneCenter(z)).toEqual(reference.zoneCenter(clone(z)));
    }
  });
});

describe('snapping, resizing and moving zones', () => {
  it('snaps to a 10 px grid, or to whole pixels', () => {
    expect(snap(104, true)).toBe(100);
    expect(snap(106, true)).toBe(110);
    expect(snap(104.6, false)).toBe(105);
  });

  it('a grip never makes a zone smaller than 60 x 50, nor pushes it off the floor', () => {
    const l = base();
    const small = resizeZonePart(l, 'a', 0, 'se', -500, -500, false);
    expect(small.zones[0]).toMatchObject({ x: 100, y: 100, w: 60, h: 50 });
    const big = resizeZonePart(l, 'a', 0, 'se', 5000, 5000, false);
    expect(big.zones[0]!.x + big.zones[0]!.w).toBe(1000);
    expect(big.zones[0]!.y + big.zones[0]!.h).toBe(620);
    const west = resizeZonePart(l, 'a', 0, 'nw', -500, -500, false);
    expect(west.zones[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('shrinking a zone pulls its machines back inside, 14 px from the sides and bottom and 22 from the top', () => {
    const l = base();
    const out = resizeZonePart(l, 'a', 0, 'se', -100, -80, false); // a is now 100 x 70 at (100,100)
    const m2 = out.equipment.find((e) => e.id === 'm2')!;
    expect(m2.x).toBeLessThanOrEqual(100 + 100 - 14);
    expect(m2.y).toBeLessThanOrEqual(100 + 70 - 14);
    expect(out.equipment.find((e) => e.id === 'm1')!.y).toBeGreaterThanOrEqual(100 + 22);
    expect(out.equipment.find((e) => e.id === 'm3')).toEqual(l.equipment.find((e) => e.id === 'm3')); // other zones untouched
  });

  it('dragging moves the whole zone and its machines by the same amount, from where the drag began', () => {
    const l = base();
    const a = moveZoneBy(l, 'a', 60, 40, false);
    expect(a.zones[0]).toMatchObject({ x: 160, y: 140 });
    expect(a.equipment.filter((e) => e.zone === 'a').map((e) => [e.x, e.y])).toEqual([
      [210, 200],
      [310, 240],
    ]);
    // the same drag recomputed from the start gives the same answer (no drift)
    expect(moveZoneBy(l, 'a', 60, 40, false)).toEqual(a);
    expect(l.zones[0]).toMatchObject({ x: 100, y: 100 }); // the original is untouched
  });

  it('a dragged zone stays on its floor, even a joined one (by its bounding box)', () => {
    const l = base();
    const far = moveZoneBy(l, 'a', 5000, 5000, false);
    expect(far.zones[0]!.x + far.zones[0]!.w).toBe(1000);
    expect(far.zones[0]!.y + far.zones[0]!.h).toBe(620);
    const joined: Layout = {
      ...l,
      zones: [zone('a', 100, 100, 200, 150, 'f1', [{ x: 300, y: 100, w: 100, h: 60 }]), ...l.zones.slice(1)],
    };
    const moved = moveZoneBy(joined, 'a', 5000, 0, false);
    expect(zoneBox(moved.zones[0]!).x + zoneBox(moved.zones[0]!).w).toBe(1000);
    expect(moved.zones[0]!.parts![0]!.x - moved.zones[0]!.x).toBe(200); // parts keep their place relative to the zone
  });

  it('dragging snaps to the grid when asked', () => {
    expect(moveZoneBy(base(), 'a', 13, 7, true).zones[0]).toMatchObject({ x: 110, y: 110 });
  });
});

describe('typing in the zone fields', () => {
  it('Left and Top move the whole zone (and its machines); Width and Height resize it', () => {
    const l = base();
    const x = setZoneNumber(l, 'a', 0, 'x', 300);
    expect(x.zones[0]!.x).toBe(300);
    expect(x.equipment.find((e) => e.id === 'm1')!.x).toBe(350);
    expect(setZoneNumber(l, 'a', 0, 'x', -50).zones[0]!.x).toBe(0);
    expect(setZoneNumber(l, 'a', 0, 'x', 5000).zones[0]!.x).toBe(800); // 1000 - width
    expect(setZoneNumber(l, 'a', 0, 'w', 10).zones[0]!.w).toBe(60);
    expect(setZoneNumber(l, 'a', 0, 'h', 10).zones[0]!.h).toBe(50);
    expect(setZoneNumber(l, 'a', 0, 'w', 5000).zones[0]!.w).toBe(900); // up to the floor edge
    expect(setZoneNumber(l, 'a', 0, 'w', 'abc').zones[0]!.w).toBe(200); // not a number: unchanged
  });

  it('on a joined zone the number changes only the chosen part', () => {
    const l: Layout = {
      ...base(),
      zones: [
        zone('a', 100, 100, 200, 150, 'f1', [{ x: 300, y: 100, w: 100, h: 60 }]),
        ...base().zones.slice(1),
      ],
    };
    const out = setZoneNumber(l, 'a', 1, 'w', 150);
    expect(out.zones[0]).toMatchObject({ x: 100, w: 200 });
    expect(out.zones[0]!.parts![0]).toMatchObject({ x: 300, w: 150 });
  });

  it('name and type; an empty name is ignored', () => {
    const l = base();
    expect(renameZone(l, 'a', '  Free weights ').zones[0]!.name).toBe('Free weights');
    expect(renameZone(l, 'a', '   ')).toBe(l);
    expect(setZoneCategory(l, 'a', 'water').zones[0]!.cat).toBe('water');
  });

  it('moving a zone to another floor takes its machines, shrinks it to fit, and keeps it on the canvas', () => {
    const l: Layout = {
      ...base(),
      zones: [zone('a', 700, 400, 400, 300), ...base().zones.slice(1)],
      equipment: [equip('m1', 'a', 900, 600)],
    };
    const out = moveZoneToFloor(l, 'a', 'f2'); // f2 is 800 x 500
    const z = out.zones.find((q) => q.id === 'a')!;
    expect(z.floor).toBe('f2');
    expect(z.w).toBeLessThanOrEqual(800);
    expect(z.x + z.w).toBeLessThanOrEqual(800);
    expect(z.y + z.h).toBeLessThanOrEqual(500);
    const m = out.equipment[0]!;
    expect(m.floor).toBe('f2');
    expect(m.x).toBeLessThanOrEqual(800 - 14);
    expect(m.y).toBeLessThanOrEqual(500 - 14);
    expect(moveZoneToFloor(l, 'a', 'f1')).toBe(l); // same floor: nothing to do
    expect(moveZoneToFloor(l, 'a', 'nope')).toBe(l);
  });

  it('a joined zone grows a small floor instead of shrinking', () => {
    const joined: Layout = {
      ...base(),
      zones: [
        zone('a', 100, 100, 400, 300, 'f1', [{ x: 500, y: 100, w: 700, h: 200 }]),
        ...base().zones.slice(1),
      ],
      equipment: [],
    };
    const out = moveZoneToFloor(joined, 'a', 'f2');
    expect(out.floors.find((f) => f.id === 'f2')!.w).toBeGreaterThanOrEqual(1100);
    expect(out.zones.find((z) => z.id === 'a')!.w).toBe(400);
  });
});

describe('adding and deleting zones', () => {
  it('a new zone is 200 x 140 near the middle, and the next one is offset so they do not stack', () => {
    const l = base();
    const one = addZone(l, 'f1', 'new-1', false);
    const z1 = one.zones.at(-1)!;
    expect(z1).toMatchObject({ id: 'new-1', name: 'New zone', cat: 'strength', w: 200, h: 140, floor: 'f1' });
    const two = addZone(one, 'f1', 'new-2', false);
    const z2 = two.zones.at(-1)!;
    expect(z2.x).toBe(z1.x + 20);
    expect(z2.y).toBe(z1.y + 20);
    expect(addZone(l, 'nope', 'x', false)).toBe(l);
  });

  it('deleting a zone deletes its machines too and says how many', () => {
    const { layout, removedMachines } = deleteZone(base(), 'a');
    expect(removedMachines).toBe(2);
    expect(layout.zones.map((z) => z.id)).toEqual(['b', 'c']);
    expect(layout.equipment.map((e) => e.id)).toEqual(['m3', 'm4']);
    expect(deleteZone(base(), 'b').removedMachines).toBe(1);
  });
});

describe('equipment', () => {
  it('a dragged marker follows the pointer but stays on its floor', () => {
    const l = base();
    expect(moveEquipment(l, 'm1', 500, 300).equipment[0]).toMatchObject({ x: 500, y: 300 });
    expect(moveEquipment(l, 'm1', -50, -50).equipment[0]).toMatchObject({ x: 14, y: 14 });
    expect(moveEquipment(l, 'm1', 5000, 5000).equipment[0]).toMatchObject({ x: 986, y: 600 });
    expect(moveEquipment(l, 'zzz', 1, 1)).toBe(l);
  });

  it('dropping a marker inside another zone moves it into that zone; on bare floor it stays put', () => {
    const l = base();
    const dragged = moveEquipment(l, 'm1', 450, 160); // inside zone b
    expect(dropEquipment(dragged, 'm1').equipment[0]!.zone).toBe('b');
    const bare = moveEquipment(l, 'm1', 800, 500);
    expect(dropEquipment(bare, 'm1').equipment[0]!.zone).toBe('a');
  });

  it('a new machine goes in the middle of its zone, with a muscle and an empty note', () => {
    const l = addEquipment(base(), {
      id: 'new-m',
      name: '  Hack squat ',
      zoneId: 'a',
      type: 'machine',
      muscle: 'legs',
    });
    const e = l.equipment.at(-1)!;
    expect(e).toMatchObject({
      id: 'new-m',
      name: 'Hack squat',
      zone: 'a',
      floor: 'f1',
      muscles: ['legs'],
      notes: '',
    });
    expect({ x: e.x, y: e.y }).toEqual(zoneCenter(l.zones[0]!));
    expect(
      addEquipment(base(), { id: 'x', name: '  ', zoneId: 'a', type: 'free', muscle: 'legs' }).equipment,
    ).toHaveLength(4);
    expect(
      addEquipment(base(), { id: 'x', name: 'Y', zoneId: 'nope', type: 'free', muscle: 'legs' }).equipment,
    ).toHaveLength(4);
  });

  it('rename, notes, move to a zone or a floor, and delete', () => {
    const l = base();
    expect(renameEquipment(l, 'm1', ' Leg press ').equipment[0]!.name).toBe('Leg press');
    expect(renameEquipment(l, 'm1', '  ')).toBe(l);
    expect(setEquipmentNotes(l, 'm1', 'bolt loose').equipment[0]!.notes).toBe('bolt loose');
    const toB = setEquipmentZone(l, 'm1', 'b').equipment[0]!;
    expect(toB).toMatchObject({ zone: 'b', floor: 'f1' });
    expect({ x: toB.x, y: toB.y }).toEqual(zoneCenter(l.zones[1]!));
    const upstairs = setEquipmentFloor(l, 'm1', 'f2').equipment[0]!;
    expect(upstairs).toMatchObject({ zone: 'c', floor: 'f2' });
    const noZones: Layout = { ...l, floors: [...l.floors, { id: 'f3', name: 'Roof', w: 600, h: 400 }] };
    expect(setEquipmentFloor(noZones, 'm1', 'f3')).toBe(noZones); // a floor with no zones cannot take it
    expect(deleteEquipment(l, 'm1').equipment.map((e) => e.id)).toEqual(['m2', 'm3', 'm4']);
  });
});

describe('unsaved changes', () => {
  it('a layout equal to the saved one is not a change; a drag that ends where it began is not either', () => {
    const l = base();
    expect(layoutChanged(l, clone(l))).toBe(false);
    expect(layoutChanged(l, moveZoneBy(moveZoneBy(l, 'a', 40, 40, false), 'a', -40, -40, false))).toBe(false);
  });

  it('positions are compared to the whole pixel, and the order of the lists does not matter', () => {
    const l = base();
    const nudged = { ...l, zones: l.zones.map((z) => (z.id === 'a' ? { ...z, x: z.x + 0.4 } : z)) };
    expect(layoutChanged(l, nudged)).toBe(false);
    expect(
      layoutChanged(l, { ...l, zones: l.zones.slice().reverse(), equipment: l.equipment.slice().reverse() }),
    ).toBe(false);
    expect(layoutChanged(l, moveZoneBy(l, 'a', 10, 0, false))).toBe(true);
    expect(layoutChanged(l, renameEquipment(l, 'm1', 'Other'))).toBe(true);
    expect(layoutChanged(l, deleteEquipment(l, 'm1'))).toBe(true);
    expect(layoutChanged(l, setZoneCategory(l, 'a', 'water'))).toBe(true);
    expect(layoutCanonical(l)).toBe(layoutCanonical(clone(l)));
  });
});

describe('what is saved', () => {
  it('lists floors, zones with their parts, structures and equipment in the shape the database function reads', () => {
    const l: Layout = {
      ...base(),
      zones: [
        zone('a', 100, 100, 200, 150, 'f1', [{ x: 300, y: 100, w: 100, h: 60 }]),
        ...base().zones.slice(1),
      ],
      structs: [
        {
          id: 's1',
          type: 'stairs',
          floor: 'f1',
          x: 5,
          y: 5,
          w: 80,
          h: 44,
          rot: 0,
          label: 'STAIRS',
          shared: true,
        },
      ],
    };
    const p = layoutSavePayload(l);
    expect(p.floors).toEqual([
      { id: 'f1', name: 'Ground', w: 1000, h: 620, position: 0 },
      { id: 'f2', name: 'First', w: 800, h: 500, position: 1 },
    ]);
    expect(p.zones[0]).toMatchObject({
      id: 'a',
      floor_id: 'f1',
      category: 'cardio',
      parts: [{ x: 300, y: 100, w: 100, h: 60, position: 0 }],
    });
    expect(p.zones[1]!.parts).toEqual([]);
    expect(p.structs[0]).toMatchObject({ id: 's1', floor_id: 'f1', rotation: 0, shared: true, x2: null });
    expect(p.equipment[0]).toMatchObject({ id: 'm1', zone_id: 'a', muscles: ['legs'] });
    expect(p.equipment).toHaveLength(4);
  });
});
