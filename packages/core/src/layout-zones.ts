/**
 * Joined zones: a zone is its own rectangle plus up to 11 extra rectangles (parts) that touch it. Join two touching
 * zones, split a part off as its own zone, or duplicate a zone with its machines. A port of the prototype's
 * rectsTouch, zonesTouch, zoneConnected, closeGap, joinZones, splitPart and duplicateZone. Every function returns a
 * new Layout and never mutates its input.
 */
import { zoneRects, type Rect } from './geometry.ts';
import {
  FLOOR_MAX_H,
  FLOOR_MAX_W,
  FLOOR_MIN_H,
  FLOOR_MIN_W,
  clamp,
  fitEquipment,
  pointInRect,
  zoneBox,
} from './layout-edit.ts';
import type { Layout } from './schemas.ts';

type Zone = Layout['zones'][number];
type Equip = Layout['equipment'][number];

/** Rectangles closer than this (in plan pixels) count as touching. */
export const TOUCH = 12;
/** Two rectangles must share at least this much edge to touch. */
export const MIN_SPAN = 16;
/** A zone can have 11 extra parts, so 12 rectangles in all. */
export const MAX_PARTS = 11;

export function rectsTouch(a: Rect, b: Rect): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (ox >= MIN_SPAN && oy >= -TOUCH) || (oy >= MIN_SPAN && ox >= -TOUCH);
}

export const zonesTouch = (a: Zone, b: Zone): boolean =>
  zoneRects(a).some((p) => zoneRects(b).some((q) => rectsTouch(p, q)));

/** Whether all of a zone's rectangles are joined to each other (directly or through others). */
export function zoneConnected(z: Zone): boolean {
  const rs = zoneRects(z);
  const seen = [0];
  for (let i = 0; i < seen.length; i++) {
    for (let j = 0; j < rs.length; j++) {
      if (!seen.includes(j) && rectsTouch(rs[seen[i]!]!, rs[j]!)) seen.push(j);
    }
  }
  return seen.length === rs.length;
}

/** Zones on the same floor that touch this one: the ones it can be joined to. */
export const joinCandidates = (l: Layout, zoneId: string): Zone[] => {
  const z = l.zones.find((q) => q.id === zoneId);
  return z ? l.zones.filter((o) => o.id !== z.id && o.floor === z.floor && zonesTouch(z, o)) : [];
};

/** A zone name that no other zone has: "Base", then "Base 2", "Base 3"... */
export function uniqueZoneName(l: Layout, base: string): string {
  const names = new Set(l.zones.map((q) => q.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 2;
  while (names.has(`${base} ${i}`.toLowerCase())) i += 1;
  return `${base} ${i}`;
}

/** Grow rectangle b towards rectangle a so a small gap between them closes. */
function closeGap(a: Rect, b: Rect): Rect {
  const r = { ...b };
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox >= MIN_SPAN && oy < 0) {
    if (b.y >= a.y + a.h) {
      const g = b.y - (a.y + a.h);
      r.y -= g;
      r.h += g;
    } else {
      r.h += a.y - (b.y + b.h);
    }
  } else if (oy >= MIN_SPAN && ox < 0) {
    if (b.x >= a.x + a.w) {
      const g = b.x - (a.x + a.w);
      r.x -= g;
      r.w += g;
    } else {
      r.w += a.x - (b.x + b.w);
    }
  }
  return r;
}

export type JoinResult =
  | {
      ok: true;
      layout: Layout;
      /** Index of the first rectangle that came from the other zone. */ firstPart: number;
    }
  | { ok: false; reason: string };

/** Merge zone b into zone a: b's rectangles become parts of a, and b's machines move into a. */
export function joinZones(l: Layout, aId: string, bId: string): JoinResult {
  const a = l.zones.find((z) => z.id === aId);
  const b = l.zones.find((z) => z.id === bId);
  if (!a || !b || a === b || a.floor !== b.floor || !zonesTouch(a, b))
    return { ok: false, reason: 'Those zones do not touch.' };
  const ra = zoneRects(a);
  let rb = zoneRects(b).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  if (ra.length + rb.length > MAX_PARTS + 1)
    return { ok: false, reason: `A joined zone can have up to ${MAX_PARTS + 1} parts.` };
  rb = rb.map((r) => ra.reduce((acc, q) => (rectsTouch(q, acc) ? closeGap(q, acc) : acc), r));
  const merged: Zone = { ...a, parts: [...(a.parts ?? []), ...rb] };
  return {
    ok: true,
    firstPart: ra.length,
    layout: {
      ...l,
      zones: l.zones.filter((z) => z.id !== bId).map((z) => (z.id === aId ? merged : z)),
      equipment: l.equipment.map((e) => (e.zone === bId ? { ...e, zone: aId } : e)),
    },
  };
}

export interface SplitResult {
  layout: Layout;
  /** The zone that was split off. */
  newZoneId: string;
  name: string;
}

/**
 * Split one rectangle off a joined zone as a zone of its own. The machines standing only inside that rectangle go
 * with it. The first remaining rectangle becomes the old zone's main one.
 */
export function splitPart(l: Layout, zoneId: string, index: number, newId: string): SplitResult | null {
  const z = l.zones.find((q) => q.id === zoneId);
  if (!z || !z.parts || !z.parts.length) return null;
  const rs = zoneRects(z).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  if (index < 0 || index >= rs.length) return null;
  const r = rs.splice(index, 1)[0]!;
  const name = uniqueZoneName(l, `${z.name} (split)`);
  const nz: Zone = { id: newId, name, cat: z.cat, x: r.x, y: r.y, w: r.w, h: r.h, floor: z.floor };
  const main = rs[0]!;
  const rest: Zone = { ...z, x: main.x, y: main.y, w: main.w, h: main.h };
  if (rs.length > 1) rest.parts = rs.slice(1);
  else delete rest.parts;
  const equipment = l.equipment.map((e) =>
    e.zone === zoneId && pointInRect(r, e.x, e.y) && !rs.some((q) => pointInRect(q, e.x, e.y))
      ? { ...e, zone: newId }
      : e,
  );
  let out: Layout = { ...l, zones: [...l.zones.map((q) => (q.id === zoneId ? rest : q)), nz], equipment };
  out = fitEquipment(fitEquipment(out, zoneId), newId);
  return { layout: out, newZoneId: newId, name };
}

export interface DuplicateResult {
  layout: Layout;
  newZoneId: string;
  name: string;
  /** Each copied machine and the machine it was copied from (to copy its exercise links once saved). */
  copies: { from: string; to: string }[];
}

/**
 * Copy a zone, with its shape, to a floor (the same floor offsets it a little). With `withMachines` each machine is
 * copied too. `machineIds` supplies the new machine ids in order.
 */
export function duplicateZone(
  l: Layout,
  zoneId: string,
  newId: string,
  targetFloorId: string,
  withMachines: boolean,
  machineIds: string[],
): DuplicateResult | null {
  const z = l.zones.find((q) => q.id === zoneId);
  const tf = l.floors.find((f) => f.id === targetFloorId);
  if (!z || !tf) return null;
  const same = tf.id === z.floor;
  const bb = zoneBox(z);
  let dx = 0;
  let dy = 0;
  let floors = l.floors;
  let tw = tf.w;
  let th = tf.h;
  if (same) {
    dx = 30;
    dy = 30;
    if (bb.x + bb.w + dx > tf.w) dx = -30;
    if (bb.y + bb.h + dy > tf.h) dy = -30;
  } else {
    tw = clamp(Math.max(tf.w, Math.ceil(bb.x + bb.w)), FLOOR_MIN_W, FLOOR_MAX_W);
    th = clamp(Math.max(tf.h, Math.ceil(bb.y + bb.h)), FLOOR_MIN_H, FLOOR_MAX_H);
    floors = floors.map((f) => (f.id === tf.id ? { ...f, w: tw, h: th } : f));
  }
  dx = clamp(bb.x + dx, 0, Math.max(0, tw - bb.w)) - bb.x;
  dy = clamp(bb.y + dy, 0, Math.max(0, th - bb.h)) - bb.y;
  const name = uniqueZoneName(l, `${z.name.replace(/ copy( \d+)?$/, '')} copy`);
  const nz: Zone = {
    id: newId,
    name,
    cat: z.cat,
    x: z.x + dx,
    y: z.y + dy,
    w: z.w,
    h: z.h,
    floor: tf.id,
  };
  if (z.parts && z.parts.length)
    nz.parts = z.parts.map((p) => ({ x: p.x + dx, y: p.y + dy, w: p.w, h: p.h }));
  const copies: { from: string; to: string }[] = [];
  const machines: Equip[] = [];
  if (withMachines) {
    l.equipment
      .filter((e) => e.zone === zoneId)
      .forEach((e, i) => {
        const id = machineIds[i];
        if (!id) return;
        machines.push({
          ...e,
          id,
          zone: newId,
          floor: tf.id,
          x: Math.round(e.x + dx),
          y: Math.round(e.y + dy),
          muscles: [...e.muscles],
        });
        copies.push({ from: e.id, to: id });
      });
  }
  return {
    layout: { ...l, floors, zones: [...l.zones, nz], equipment: [...l.equipment, ...machines] },
    newZoneId: newId,
    name,
    copies,
  };
}
