import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  STRUCT_DEFS,
  structOnFloor,
  structsOn,
  wrapName,
  zoneCountRect,
  zoneLabelRect,
  zoneLoops,
  zonePathD,
  zoneRects,
  type Rect,
  type ZoneShape,
} from './geometry.ts';

/* ---- the prototype's own functions, evaluated from its source, as the reference implementation ---- */
const proto = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'prototype', 'zone-planner-v11.html'),
  'utf8',
);
function slice(from: string, to: string): string {
  const a = proto.indexOf(from);
  const b = proto.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`prototype markers not found: ${from} .. ${to}`);
  return proto.slice(a, b);
}
const reference = runInNewContext(
  `${slice('function zoneRects(z)', 'function uniqueZoneName')}\n${slice('function wrapName(n)', '/* ---------- capabilities')}
   ({ zoneRects, zoneLoops, zonePathD, zoneLabelRect, zoneCountRect, wrapName })`,
  {},
) as {
  zoneLoops: (z: ZoneShape) => number[][][];
  zonePathD: (z: ZoneShape) => string;
  zoneLabelRect: (z: ZoneShape) => Rect;
  zoneCountRect: (z: ZoneShape) => Rect;
  wrapName: (n: string) => string[];
};

/** The prototype returns the zone object itself for the primary rectangle; compare coordinates only. */
const box = (q: Rect): Rect => ({ x: q.x, y: q.y, w: q.w, h: q.h });
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const zone = (x: number, y: number, w: number, h: number, parts: Rect[] = []): ZoneShape =>
  parts.length ? { x, y, w, h, parts } : { x, y, w, h };

/** Deterministic pseudo-random numbers so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('zoneLoops', () => {
  it('a single rectangle is one four-point loop', () => {
    const loops = zoneLoops(zone(10, 20, 100, 50));
    expect(loops).toEqual([
      [
        [10, 20],
        [110, 20],
        [110, 70],
        [10, 70],
      ],
    ]);
  });

  it('two rectangles that share an edge become one L-shaped loop with six corners', () => {
    const loops = zoneLoops(zone(0, 0, 100, 100, [r(100, 0, 100, 50)]));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it('overlapping rectangles merge and drop collinear points', () => {
    const loops = zoneLoops(zone(0, 0, 100, 100, [r(50, 0, 100, 100)]));
    expect(loops).toEqual([
      [
        [0, 0],
        [150, 0],
        [150, 100],
        [0, 100],
      ],
    ]);
  });

  it('separate rectangles give separate loops', () => {
    expect(zoneLoops(zone(0, 0, 50, 50, [r(200, 200, 50, 50)]))).toHaveLength(2);
  });

  it('a ring of four rectangles gives an outer loop and an inner hole', () => {
    const ring = zone(0, 0, 300, 100, [r(0, 200, 300, 100), r(0, 100, 100, 100), r(200, 100, 100, 100)]);
    const loops = zoneLoops(ring);
    expect(loops).toHaveLength(2);
    expect(zonePathD(ring).match(/M/g)).toHaveLength(2);
  });

  it('path data is M..L..Z per loop', () => {
    expect(zonePathD(zone(0, 0, 60, 50))).toBe('M0 0L60 0L60 50L0 50Z');
  });

  it('agrees with the prototype on 300 random joined zones', () => {
    const next = rng(2026);
    for (let n = 0; n < 300; n++) {
      const count = 1 + Math.floor(next() * 5);
      const rects: Rect[] = [];
      for (let i = 0; i < count; i++) {
        rects.push(
          r(
            Math.floor(next() * 12) * 20,
            Math.floor(next() * 8) * 20,
            40 + Math.floor(next() * 6) * 20,
            40 + Math.floor(next() * 5) * 20,
          ),
        );
      }
      const [first, ...rest] = rects as [Rect, ...Rect[]];
      const z = zone(first.x, first.y, first.w, first.h, rest);
      expect(zoneLoops(z), JSON.stringify(z)).toEqual(reference.zoneLoops(z));
      expect(zonePathD(z)).toBe(reference.zonePathD(z));
      expect(zoneLabelRect(z)).toEqual(box(reference.zoneLabelRect(z)));
      expect(zoneCountRect(z)).toEqual(box(reference.zoneCountRect(z)));
    }
  });
});

describe('zone label and count rectangles', () => {
  it('put the name top-left and the count bottom-right of a joined zone', () => {
    const z = zone(100, 0, 100, 100, [r(0, 100, 200, 100)]);
    expect(zoneLabelRect(z)).toEqual(r(100, 0, 100, 100));
    expect(zoneCountRect(z)).toEqual(r(0, 100, 200, 100));
  });

  it('prefers parts at least 60 wide', () => {
    const z = zone(0, 0, 100, 100, [r(0, 0, 20, 20)]);
    expect(zoneLabelRect(z)).toEqual(r(0, 0, 100, 100));
  });

  it('zoneRects lists the primary rectangle first', () => {
    expect(zoneRects(zone(1, 2, 3, 4, [r(5, 6, 7, 8)]))).toEqual([r(1, 2, 3, 4), r(5, 6, 7, 8)]);
  });
});

describe('wrapName', () => {
  it('keeps short or spaceless names whole and splits long ones near the middle', () => {
    expect(wrapName('Treadmills')).toEqual(['Treadmills']);
    expect(wrapName('Supercalifragilistic')).toEqual(['Supercalifragilistic']);
    expect(wrapName('Seated leg press')).toEqual(['Seated', 'leg press']);
  });

  it('agrees with the prototype', () => {
    for (const n of [
      'Chest press',
      'Lat pulldown station',
      'Smith machine',
      'Cable crossover rig',
      'A B',
      'Leg extension',
    ]) {
      expect(wrapName(n)).toEqual(reference.wrapName(n));
    }
  });
});

describe('shared stairs and lifts', () => {
  const stairs = { type: 'stairs', floor: 'f1', shared: true };
  const lift = { type: 'lift', floor: 'f1', shared: false };
  const wall = { type: 'wall', floor: 'f2', shared: true };

  it('shared stairs and lifts appear on every floor; other structures only on their own', () => {
    expect(structOnFloor(stairs, 'f2')).toBe(true);
    expect(structOnFloor(lift, 'f2')).toBe(false);
    expect(structOnFloor(wall, 'f1')).toBe(false);
    expect(structOnFloor(wall, 'f2')).toBe(true);
  });

  it('draws lines first, then boxes, then symbols', () => {
    const list = [
      { type: 'door', floor: 'f1', shared: false },
      { type: 'stairs', floor: 'f1', shared: false },
      { type: 'wall', floor: 'f1', shared: false },
    ];
    expect(structsOn(list, 'f1').map((s) => s.type)).toEqual(['wall', 'stairs', 'door']);
  });

  it('knows every structure type in the data model', () => {
    expect(Object.keys(STRUCT_DEFS).sort()).toEqual(
      [
        'balustrade',
        'column',
        'dglass',
        'door',
        'glass',
        'lift',
        'revolving',
        'stairs',
        'toilets',
        'wall',
      ].sort(),
    );
  });
});
