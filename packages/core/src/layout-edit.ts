/**
 * Editing a gym layout: moving and resizing zones, placing equipment, and the rules that keep both inside the
 * floor. A port of the prototype's editing helpers (resizeRect, fitEquipment, shiftZone, zoneCenter, zoneNumField,
 * zoneTextField, the drag handlers). Every function takes a Layout and returns a new one; nothing is mutated, so
 * a drag can always be recomputed from the layout as it was when the drag started.
 */
import { zoneRects, type Rect } from './geometry.ts';
import type { Layout } from './schemas.ts';

type Zone = Layout['zones'][number];
type Equip = Layout['equipment'][number];

export const ZONE_MIN_W = 60;
export const ZONE_MIN_H = 50;
export const FLOOR_MIN_W = 600;
export const FLOOR_MIN_H = 400;
export const FLOOR_MAX_W = 2400;
export const FLOOR_MAX_H = 1800;
/** A machine keeps this far inside its zone's edges (the top edge is further, to clear the zone's name). */
export const EQ_INSET_SIDE = 14;
export const EQ_INSET_TOP = 22;

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Whole pixels, or the nearest 10 px grid line while snapping is on. */
export const snap = (v: number, on: boolean): number => (on ? Math.round(v / 10) * 10 : Math.round(v));

const floorOf = (l: Layout, id: string) => l.floors.find((f) => f.id === id);
const mapZone = (l: Layout, id: string, fn: (z: Zone) => Zone): Layout => ({
  ...l,
  zones: l.zones.map((z) => (z.id === id ? fn(z) : z)),
});

/** The rectangle around all of a zone's parts. */
export function zoneBox(z: Zone): Rect {
  let x0 = z.x;
  let y0 = z.y;
  let x1 = z.x + z.w;
  let y1 = z.y + z.h;
  for (const p of z.parts ?? []) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The largest part: where a machine is placed when it is added to the zone. */
export function zoneAnchor(z: Zone): Rect {
  let best: Rect = { x: z.x, y: z.y, w: z.w, h: z.h };
  for (const p of z.parts ?? []) if (p.w * p.h > best.w * best.h) best = p;
  return best;
}

/** Where a newly placed machine goes: the middle of the zone, a little low so it clears the name. */
export function zoneCenter(z: Zone): { x: number; y: number } {
  const r = zoneAnchor(z);
  return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2 + 10) };
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
export const zoneHas = (z: Zone, x: number, y: number): boolean =>
  zoneRects(z).some((r) => pointInRect(r, x, y));

/** Rectangles of a zone by part number (0 is the main rectangle). */
export function partRect(z: Zone, index: number): Rect {
  if (index > 0 && z.parts && z.parts[index - 1]) return z.parts[index - 1]!;
  return { x: z.x, y: z.y, w: z.w, h: z.h };
}

function withPartRect(z: Zone, index: number, r: Rect): Zone {
  if (index > 0 && z.parts && z.parts[index - 1]) {
    return { ...z, parts: z.parts.map((p, i) => (i === index - 1 ? { ...r } : p)) };
  }
  return { ...z, x: r.x, y: r.y, w: r.w, h: r.h };
}

/* ---------------------------------------------------------------- resizing */

/** Drag one of the eight grips of a rectangle. The result stays on the floor and never gets smaller than the minimum. */
export function resizeRect(
  r: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  min: { w: number; h: number },
  floor: { w: number; h: number },
  snapOn: boolean,
): Rect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (handle.includes('w')) x0 = Math.min(snap(r.x + dx, snapOn), x1 - min.w);
  if (handle.includes('e')) x1 = Math.max(snap(r.x + r.w + dx, snapOn), x0 + min.w);
  if (handle.includes('n')) y0 = Math.min(snap(r.y + dy, snapOn), y1 - min.h);
  if (handle.includes('s')) y1 = Math.max(snap(r.y + r.h + dy, snapOn), y0 + min.h);
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(floor.w, x1);
  y1 = Math.min(floor.h, y1);
  return { x: x0, y: y0, w: Math.max(min.w, x1 - x0), h: Math.max(min.h, y1 - y0) };
}

/** After a zone changes shape, pull each of its machines back inside (to the nearest of its rectangles). */
export function fitEquipment(l: Layout, zoneId: string): Layout {
  const z = l.zones.find((q) => q.id === zoneId);
  if (!z) return l;
  const rs = zoneRects(z);
  return {
    ...l,
    equipment: l.equipment.map((e) => {
      if (e.zone !== zoneId) return e;
      let best: { x: number; y: number; d: number } | null = null;
      for (const r of rs) {
        const px = Math.round(Math.min(r.x + r.w - EQ_INSET_SIDE, Math.max(r.x + EQ_INSET_SIDE, e.x)));
        const py = Math.round(Math.min(r.y + r.h - EQ_INSET_SIDE, Math.max(r.y + EQ_INSET_TOP, e.y)));
        const d = Math.abs(px - e.x) + Math.abs(py - e.y);
        if (!best || d < best.d) best = { x: px, y: py, d };
      }
      return best ? { ...e, x: best.x, y: best.y, floor: z.floor } : e;
    }),
  };
}

/** Pull a zone's grip: resize the chosen part, then fit its machines back inside. */
export function resizeZonePart(
  start: Layout,
  zoneId: string,
  partIndex: number,
  handle: Handle,
  dx: number,
  dy: number,
  snapOn: boolean,
): Layout {
  const z = start.zones.find((q) => q.id === zoneId);
  const f = z && floorOf(start, z.floor);
  if (!z || !f) return start;
  const r = resizeRect(partRect(z, partIndex), handle, dx, dy, { w: ZONE_MIN_W, h: ZONE_MIN_H }, f, snapOn);
  return fitEquipment(
    mapZone(start, zoneId, (q) => withPartRect(q, partIndex, r)),
    zoneId,
  );
}

/* ---------------------------------------------------------------- moving */

/**
 * Drag a whole zone by (dx, dy) from where it was when the drag began. The zone's bounding box stays on the floor;
 * every part and every machine moves by the same amount.
 */
export function moveZoneBy(start: Layout, zoneId: string, dx: number, dy: number, snapOn: boolean): Layout {
  const z = start.zones.find((q) => q.id === zoneId);
  const f = z && floorOf(start, z.floor);
  if (!z || !f) return start;
  const bb = zoneBox(z);
  const nx = clamp(snap(bb.x + dx, snapOn), 0, f.w - bb.w);
  const ny = clamp(snap(bb.y + dy, snapOn), 0, f.h - bb.h);
  const ax = nx - bb.x;
  const ay = ny - bb.y;
  return {
    ...start,
    zones: start.zones.map((q) =>
      q.id !== zoneId
        ? q
        : {
            ...q,
            x: q.x + ax,
            y: q.y + ay,
            ...(q.parts ? { parts: q.parts.map((p) => ({ ...p, x: p.x + ax, y: p.y + ay })) } : {}),
          },
    ),
    equipment: start.equipment.map((e) =>
      e.zone === zoneId
        ? {
            ...e,
            x: Math.round(clamp(e.x + ax, EQ_INSET_SIDE, f.w - EQ_INSET_SIDE)),
            y: Math.round(clamp(e.y + ay, EQ_INSET_SIDE, f.h - EQ_INSET_SIDE)),
          }
        : e,
    ),
  };
}

/* ---------------------------------------------------------------- the zone's own fields */

export type ZoneNumber = 'x' | 'y' | 'w' | 'h';

/** Typing a number in Left, Top, Width or Height. A joined zone changes only the chosen part. */
export function setZoneNumber(
  l: Layout,
  zoneId: string,
  partIndex: number,
  key: ZoneNumber,
  value: unknown,
): Layout {
  const z = l.zones.find((q) => q.id === zoneId);
  const f = z && floorOf(l, z.floor);
  if (!z || !f) return l;
  const r = partRect(z, partIndex);
  const multi = !!(z.parts && z.parts.length);
  const n = Math.round(num(value, r[key]));
  if (key === 'w')
    return fitEquipment(
      mapZone(l, zoneId, (q) => withPartRect(q, partIndex, { ...r, w: clamp(n, ZONE_MIN_W, f.w - r.x) })),
      zoneId,
    );
  if (key === 'h')
    return fitEquipment(
      mapZone(l, zoneId, (q) => withPartRect(q, partIndex, { ...r, h: clamp(n, ZONE_MIN_H, f.h - r.y) })),
      zoneId,
    );
  if (key === 'x') {
    if (multi)
      return fitEquipment(
        mapZone(l, zoneId, (q) => withPartRect(q, partIndex, { ...r, x: clamp(n, 0, f.w - r.w) })),
        zoneId,
      );
    return shiftZoneTo(l, zoneId, clamp(n, 0, f.w - z.w), z.y);
  }
  if (multi)
    return fitEquipment(
      mapZone(l, zoneId, (q) => withPartRect(q, partIndex, { ...r, y: clamp(n, 0, f.h - r.h) })),
      zoneId,
    );
  return shiftZoneTo(l, zoneId, z.x, clamp(n, 0, f.h - z.h));
}

/** Move a zone so its top-left is at (nx, ny); its parts and machines move with it. */
export function shiftZoneTo(l: Layout, zoneId: string, nx: number, ny: number): Layout {
  const z = l.zones.find((q) => q.id === zoneId);
  const f = z && floorOf(l, z.floor);
  if (!z || !f) return l;
  const dx = nx - z.x;
  const dy = ny - z.y;
  return {
    ...l,
    zones: l.zones.map((q) =>
      q.id !== zoneId
        ? q
        : {
            ...q,
            x: nx,
            y: ny,
            ...(q.parts ? { parts: q.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } : {}),
          },
    ),
    equipment: l.equipment.map((e) =>
      e.zone === zoneId
        ? {
            ...e,
            x: Math.round(Math.min(f.w - EQ_INSET_SIDE, Math.max(EQ_INSET_SIDE, e.x + dx))),
            y: Math.round(Math.min(f.h - EQ_INSET_SIDE, Math.max(EQ_INSET_SIDE, e.y + dy))),
          }
        : e,
    ),
  };
}

export function renameZone(l: Layout, zoneId: string, name: string): Layout {
  const n = name.trim().slice(0, 60);
  return n ? mapZone(l, zoneId, (z) => ({ ...z, name: n })) : l;
}

export function setZoneCategory(l: Layout, zoneId: string, cat: Zone['cat']): Layout {
  return mapZone(l, zoneId, (z) => ({ ...z, cat }));
}

/**
 * Move a zone, with all its machines, to another floor. The zone is shrunk to fit a small floor (a joined zone
 * grows the floor instead), and kept on the floor's canvas.
 */
export function moveZoneToFloor(l: Layout, zoneId: string, floorId: string): Layout {
  const z = l.zones.find((q) => q.id === zoneId);
  const target = floorOf(l, floorId);
  if (!z || !target || z.floor === floorId) return l;
  let floors = l.floors;
  let w = z.w;
  let h = z.h;
  let tw = target.w;
  let th = target.h;
  if (z.parts && z.parts.length) {
    const bb = zoneBox(z);
    tw = clamp(Math.max(tw, Math.ceil(bb.w)), FLOOR_MIN_W, FLOOR_MAX_W);
    th = clamp(Math.max(th, Math.ceil(bb.h)), FLOOR_MIN_H, FLOOR_MAX_H);
    floors = floors.map((f) => (f.id === floorId ? { ...f, w: tw, h: th } : f));
  } else {
    w = Math.min(z.w, tw);
    h = Math.min(z.h, th);
  }
  const shrunk: Zone = { ...z, w, h };
  const bb = zoneBox(shrunk);
  const dx = clamp(bb.x, 0, Math.max(0, tw - bb.w)) - bb.x;
  const dy = clamp(bb.y, 0, Math.max(0, th - bb.h)) - bb.y;
  return {
    ...l,
    floors,
    zones: l.zones.map((q) =>
      q.id !== zoneId
        ? q
        : {
            ...shrunk,
            x: shrunk.x + dx,
            y: shrunk.y + dy,
            floor: floorId,
            ...(shrunk.parts ? { parts: shrunk.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } : {}),
          },
    ),
    equipment: l.equipment.map((e) =>
      e.zone === zoneId
        ? {
            ...e,
            x: Math.round(clamp(e.x + dx, EQ_INSET_SIDE, tw - EQ_INSET_SIDE)),
            y: Math.round(clamp(e.y + dy, EQ_INSET_SIDE, th - EQ_INSET_SIDE)),
            floor: floorId,
          }
        : e,
    ),
  };
}

/** A new 200 x 140 zone near the middle of the floor, each one a little further along so they do not stack. */
export function addZone(l: Layout, floorId: string, id: string, snapOn: boolean): Layout {
  const f = floorOf(l, floorId);
  if (!f) return l;
  const n = l.zones.filter((z) => z.floor === floorId).length;
  const off = (n % 8) * 20;
  const z: Zone = {
    id,
    name: 'New zone',
    cat: 'strength',
    x: snap(Math.round(f.w / 2) - 120 + off, snapOn),
    y: snap(Math.round(f.h / 2) - 80 + off, snapOn),
    w: 200,
    h: 140,
    floor: floorId,
  };
  return { ...l, zones: [...l.zones, z] };
}

/**
 * Delete a zone. The database keeps every machine inside a zone, so the zone's machines are deleted with it
 * (the screen says how many, and asks twice). Returns the new layout and how many machines went.
 */
export function deleteZone(l: Layout, zoneId: string): { layout: Layout; removedMachines: number } {
  const gone = l.equipment.filter((e) => e.zone === zoneId).length;
  return {
    layout: {
      ...l,
      zones: l.zones.filter((z) => z.id !== zoneId),
      equipment: l.equipment.filter((e) => e.zone !== zoneId),
    },
    removedMachines: gone,
  };
}

/* ---------------------------------------------------------------- equipment */

/** Drag a marker: it follows the pointer but stays on the floor. */
export function moveEquipment(l: Layout, eid: string, x: number, y: number): Layout {
  const e = l.equipment.find((q) => q.id === eid);
  const f = e && floorOf(l, e.floor);
  if (!e || !f) return l;
  const nx = Math.round(Math.min(f.w - EQ_INSET_SIDE, Math.max(EQ_INSET_SIDE, x)));
  const ny = Math.round(Math.min(f.h - 20, Math.max(EQ_INSET_SIDE, y)));
  return { ...l, equipment: l.equipment.map((q) => (q.id === eid ? { ...q, x: nx, y: ny } : q)) };
}

/**
 * Let go of a marker: if it now sits inside a zone on its floor (the first one that contains it) it belongs to that
 * zone. Dropped on bare floor it keeps its zone.
 */
export function dropEquipment(l: Layout, eid: string): Layout {
  const e = l.equipment.find((q) => q.id === eid);
  if (!e) return l;
  const home = l.zones.filter((z) => z.floor === e.floor).find((z) => zoneHas(z, e.x, e.y));
  return home
    ? {
        ...l,
        equipment: l.equipment.map((q) => (q.id === eid ? { ...q, zone: home.id, floor: home.floor } : q)),
      }
    : l;
}

export function addEquipment(
  l: Layout,
  input: { id: string; name: string; zoneId: string; type: Equip['type']; muscle: Equip['muscles'][number] },
): Layout {
  const z = l.zones.find((q) => q.id === input.zoneId);
  const name = input.name.trim().slice(0, 60);
  if (!z || !name) return l;
  const c = zoneCenter(z);
  const e: Equip = {
    id: input.id,
    name,
    zone: z.id,
    type: input.type,
    x: c.x,
    y: c.y,
    muscles: [input.muscle],
    notes: '',
    floor: z.floor,
  };
  return { ...l, equipment: [...l.equipment, e] };
}

export function renameEquipment(l: Layout, eid: string, name: string): Layout {
  const n = name.trim().slice(0, 60);
  return n ? { ...l, equipment: l.equipment.map((e) => (e.id === eid ? { ...e, name: n } : e)) } : l;
}

export function setEquipmentNotes(l: Layout, eid: string, notes: string): Layout {
  return {
    ...l,
    equipment: l.equipment.map((e) => (e.id === eid ? { ...e, notes: notes.slice(0, 1000) } : e)),
  };
}

/** Choose a zone for a machine from the list: it moves to the middle of that zone, on that zone's floor. */
export function setEquipmentZone(l: Layout, eid: string, zoneId: string): Layout {
  const z = l.zones.find((q) => q.id === zoneId);
  if (!z) return l;
  const c = zoneCenter(z);
  return {
    ...l,
    equipment: l.equipment.map((e) =>
      e.id === eid ? { ...e, zone: z.id, floor: z.floor, x: c.x, y: c.y } : e,
    ),
  };
}

/** Choose a floor for a machine: it moves into the first zone of that floor. A floor with no zones cannot take it. */
export function setEquipmentFloor(l: Layout, eid: string, floorId: string): Layout {
  const z = l.zones.find((q) => q.floor === floorId);
  return z ? setEquipmentZone(l, eid, z.id) : l;
}

export function deleteEquipment(l: Layout, eid: string): Layout {
  return { ...l, equipment: l.equipment.filter((e) => e.id !== eid) };
}

/* ---------------------------------------------------------------- unsaved changes and saving */

/**
 * A comparable form of a layout: ids, names, positions rounded to whole pixels, lists sorted. Two layouts with the
 * same canonical form look and behave the same, so a drag that ends where it began does not count as a change.
 */
export function layoutCanonical(l: Layout): string {
  const r = Math.round;
  return JSON.stringify([
    l.floors.map((f) => [f.id, f.name, f.w, f.h]),
    l.zones
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((z) => [
        z.id,
        z.floor,
        z.name,
        z.cat,
        r(z.x),
        r(z.y),
        r(z.w),
        r(z.h),
        (z.parts ?? []).map((p) => [r(p.x), r(p.y), r(p.w), r(p.h)]),
      ]),
    l.structs
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => [
        s.id,
        s.type,
        s.floor,
        r(s.x),
        r(s.y),
        r(s.w ?? 0),
        r(s.h ?? 0),
        r(s.x2 ?? 0),
        r(s.y2 ?? 0),
        s.rot,
        s.label,
        s.shared,
      ]),
    l.equipment
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => [
        e.id,
        e.name,
        e.zone,
        e.type,
        r(e.x),
        r(e.y),
        e.muscles.slice().sort(),
        e.notes,
        e.catalogueId ?? null,
      ]),
  ]);
}

export const layoutChanged = (saved: Layout, working: Layout): boolean =>
  layoutCanonical(saved) !== layoutCanonical(working);

/** What the database function `save_gym_layout` receives. Ids are the layout's own (uuids). */
export function layoutSavePayload(l: Layout) {
  return {
    floors: l.floors.map((f, position) => ({ id: f.id, name: f.name, w: f.w, h: f.h, position })),
    zones: l.zones.map((z) => ({
      id: z.id,
      floor_id: z.floor,
      name: z.name,
      category: z.cat,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h,
      parts: (z.parts ?? []).map((p, position) => ({ x: p.x, y: p.y, w: p.w, h: p.h, position })),
    })),
    structs: l.structs.map((s) => ({
      id: s.id,
      floor_id: s.floor,
      type: s.type,
      x: s.x,
      y: s.y,
      w: s.w ?? null,
      h: s.h ?? null,
      x2: s.x2 ?? null,
      y2: s.y2 ?? null,
      rotation: s.rot ?? 0,
      label: s.label,
      shared: s.shared,
    })),
    equipment: l.equipment.map((e) => ({
      id: e.id,
      zone_id: e.zone,
      name: e.name,
      type: e.type,
      x: e.x,
      y: e.y,
      muscles: e.muscles,
      notes: e.notes,
      catalogue_item_id: e.catalogueId ?? null,
    })),
  };
}
