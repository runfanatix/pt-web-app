/**
 * Editing the architecture (stairs, lifts, doors, walls...) and the floors of a gym layout. A port of the
 * prototype's newStruct, structField, rotateStruct, applyDrag (struct branches), addFloorNow, delFloorNow, setCanvas
 * and floorExtent. Like layout-edit.ts every function returns a new Layout and never mutates its input.
 */
import { structOnFloor, STRUCT_DEFS, zoneRects } from './geometry.ts';
import {
  FLOOR_MAX_H,
  FLOOR_MAX_W,
  FLOOR_MIN_H,
  FLOOR_MIN_W,
  clamp,
  resizeRect,
  snap,
  zoneBox,
  type Handle,
} from './layout-edit.ts';
import type { Layout } from './schemas.ts';

type Struct = Layout['structs'][number];

/** The prototype's STRUCTS table: default size, length and label of each kind. */
export const STRUCT_SIZES: Record<string, { w: number; h: number; len: number; label: string }> = {
  stairs: { w: 80, h: 44, len: 0, label: 'STAIRS' },
  lift: { w: 36, h: 36, len: 0, label: 'LIFT' },
  door: { w: 36, h: 0, len: 0, label: '' },
  revolving: { w: 46, h: 0, len: 0, label: '' },
  dglass: { w: 68, h: 0, len: 0, label: '' },
  column: { w: 14, h: 0, len: 0, label: '' },
  toilets: { w: 76, h: 50, len: 0, label: 'TOILETS' },
  wall: { w: 0, h: 0, len: 140, label: '' },
  balustrade: { w: 0, h: 0, len: 110, label: '' },
  glass: { w: 0, h: 0, len: 180, label: '' },
};
/** The order of the key down the side of the plan. */
export const STRUCT_ORDER = [
  'stairs',
  'lift',
  'door',
  'revolving',
  'dglass',
  'column',
  'toilets',
  'wall',
  'balustrade',
  'glass',
] as const;

export const STRUCT_BOX_MIN = 16;
export const STRUCT_BOX_MAX = 600;
export const STRUCT_SYM_MIN = 6;
export const STRUCT_SYM_MAX = 200;

const kindOf = (s: Struct) => STRUCT_DEFS[s.type]?.kind ?? 'sym';
const floorOf = (l: Layout, id: string) => l.floors.find((f) => f.id === id);
const mapStruct = (l: Layout, id: string, fn: (s: Struct) => Struct): Layout => ({
  ...l,
  structs: l.structs.map((s) => (s.id === id ? fn(s) : s)),
});

export const lineLength = (s: Struct): number => Math.hypot((s.x2 ?? 0) - s.x, (s.y2 ?? 0) - s.y);

/** The scale of a structure against its default size, as a whole percentage. */
export function structPercent(s: Struct): number {
  const d = STRUCT_SIZES[s.type];
  if (!d) return 100;
  return Math.round((kindOf(s) === 'line' ? lineLength(s) / d.len : (s.w ?? d.w) / d.w) * 100);
}

/** A new structure near the middle of the floor, each one a little further along so they do not stack. */
export function addStruct(l: Layout, type: string, floorId: string, id: string, snapOn: boolean): Layout {
  const f = floorOf(l, floorId);
  const d = STRUCT_SIZES[type];
  const def = STRUCT_DEFS[type];
  if (!f || !d || !def) return l;
  const n = l.structs.filter((s) => structOnFloor(s, floorId)).length;
  const off = (n % 6) * 16;
  const cx = Math.round(f.w / 2) + off;
  const cy = Math.round(f.h / 2) + off;
  const s: Struct = {
    id,
    type: type as Struct['type'],
    floor: floorId,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    x2: 0,
    y2: 0,
    rot: 0,
    label: d.label,
    shared: def.vertical,
  };
  if (def.kind === 'box') {
    s.w = d.w;
    s.h = d.h;
    s.x = snap(cx - d.w / 2, snapOn);
    s.y = snap(cy - d.h / 2, snapOn);
  } else if (def.kind === 'sym') {
    s.w = d.w;
    s.x = snap(cx, snapOn);
    s.y = snap(cy, snapOn);
  } else {
    s.x = snap(cx - d.len / 2, snapOn);
    s.y = snap(cy, snapOn);
    s.x2 = s.x + d.len;
    s.y2 = s.y;
  }
  return { ...l, structs: [...l.structs, s] };
}

export function deleteStruct(l: Layout, id: string): Layout {
  return { ...l, structs: l.structs.filter((s) => s.id !== id) };
}

/** Drag a whole structure by (dx, dy) from where it was when the drag began. `floorId` is the floor on show. */
export function moveStructBy(
  start: Layout,
  id: string,
  dx: number,
  dy: number,
  floorId: string,
  snapOn: boolean,
): Layout {
  const g = start.structs.find((s) => s.id === id);
  const f = floorOf(start, floorId);
  if (!g || !f) return start;
  const kind = kindOf(g);
  return mapStruct(start, id, (o) => {
    if (kind === 'line') {
      const x2 = g.x2 ?? g.x;
      const y2 = g.y2 ?? g.y;
      const lx = Math.min(g.x, x2);
      const hx = Math.max(g.x, x2);
      const ly = Math.min(g.y, y2);
      const hy = Math.max(g.y, y2);
      const ox = clamp(snap(g.x + dx, snapOn) - g.x, -lx, f.w - hx);
      const oy = clamp(snap(g.y + dy, snapOn) - g.y, -ly, f.h - hy);
      return { ...o, x: g.x + ox, y: g.y + oy, x2: x2 + ox, y2: y2 + oy };
    }
    if (kind === 'box') {
      return {
        ...o,
        x: clamp(snap(g.x + dx, snapOn), 0, f.w - (o.w ?? 0)),
        y: clamp(snap(g.y + dy, snapOn), 0, f.h - (o.h ?? 0)),
      };
    }
    return { ...o, x: clamp(snap(g.x + dx, snapOn), 0, f.w), y: clamp(snap(g.y + dy, snapOn), 0, f.h) };
  });
}

export type StructHandle = Handle | 'p1' | 'p2';

/** Pull a grip: a box resizes from its edges and corners, a line moves one end. */
export function resizeStructBy(
  start: Layout,
  id: string,
  handle: StructHandle,
  dx: number,
  dy: number,
  floorId: string,
  snapOn: boolean,
): Layout {
  const g = start.structs.find((s) => s.id === id);
  const f = floorOf(start, floorId);
  if (!g || !f) return start;
  if (handle === 'p1' || handle === 'p2') {
    const bx = handle === 'p1' ? g.x : (g.x2 ?? g.x);
    const by = handle === 'p1' ? g.y : (g.y2 ?? g.y);
    const px = clamp(snap(bx + dx, snapOn), 0, f.w);
    const py = clamp(snap(by + dy, snapOn), 0, f.h);
    return mapStruct(start, id, (o) => (handle === 'p1' ? { ...o, x: px, y: py } : { ...o, x2: px, y2: py }));
  }
  if (kindOf(g) !== 'box') return start;
  const r = resizeRect(
    { x: g.x, y: g.y, w: g.w ?? 0, h: g.h ?? 0 },
    handle,
    dx,
    dy,
    { w: STRUCT_BOX_MIN, h: STRUCT_BOX_MIN },
    f,
    snapOn,
  );
  return mapStruct(start, id, (o) => ({ ...o, ...r }));
}

export type StructField = 'x' | 'y' | 'w' | 'h' | 'x2' | 'y2';

/** Typing a number in one of the structure's fields. */
export function setStructNumber(
  l: Layout,
  id: string,
  key: StructField,
  value: unknown,
  floorId: string,
): Layout {
  const s = l.structs.find((q) => q.id === id);
  const f = floorOf(l, floorId);
  if (!s || !f) return l;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return l;
  const kind = kindOf(s);
  return mapStruct(l, id, (o) => {
    if (kind === 'line') return { ...o, [key]: clamp(n, 0, key === 'x' || key === 'x2' ? f.w : f.h) };
    if (key === 'w')
      return {
        ...o,
        w:
          kind === 'box'
            ? clamp(n, STRUCT_BOX_MIN, STRUCT_BOX_MAX)
            : clamp(n, STRUCT_SYM_MIN, STRUCT_SYM_MAX),
      };
    if (key === 'h') return { ...o, h: clamp(n, STRUCT_BOX_MIN, STRUCT_BOX_MAX) };
    if (key === 'x' || key === 'y') return { ...o, [key]: clamp(n, 0, key === 'x' ? f.w : f.h) };
    return o;
  });
}

export function setStructLabel(l: Layout, id: string, label: string): Layout {
  return mapStruct(l, id, (s) => ({ ...s, label: label.slice(0, 40) }));
}

export function setStructTurn(l: Layout, id: string, rot: number): Layout {
  return mapStruct(l, id, (s) => ({ ...s, rot: [0, 90, 180, 270].includes(rot) ? rot : 0 }));
}

/** Scale as a percentage of the default size (25 to 600). A box scales about its centre, a line about its start. */
export function scaleStruct(l: Layout, id: string, percent: unknown, floorId: string): Layout {
  const s = l.structs.find((q) => q.id === id);
  const d = s && STRUCT_SIZES[s.type];
  const f = floorOf(l, floorId);
  if (!s || !d || !f) return l;
  const p = Number(percent);
  if (!Number.isFinite(p)) return l;
  const pct = clamp(p, 25, 600) / 100;
  const kind = kindOf(s);
  return mapStruct(l, id, (o) => {
    if (kind === 'sym') return { ...o, w: clamp(Math.round(d.w * pct), STRUCT_SYM_MIN, STRUCT_SYM_MAX) };
    if (kind === 'box') {
      const w0 = o.w || d.w;
      const h0 = o.h || d.h;
      const cx = o.x + w0 / 2;
      const cy = o.y + h0 / 2;
      const f0 = (d.w * pct) / w0;
      const w = clamp(Math.round(w0 * f0), STRUCT_BOX_MIN, STRUCT_BOX_MAX);
      const h = clamp(Math.round(h0 * f0), STRUCT_BOX_MIN, STRUCT_BOX_MAX);
      return {
        ...o,
        w,
        h,
        x: Math.round(clamp(cx - w / 2, 0, f.w - w)),
        y: Math.round(clamp(cy - h / 2, 0, f.h - h)),
      };
    }
    const x2 = o.x2 ?? o.x;
    const y2 = o.y2 ?? o.y;
    const len0 = Math.hypot(x2 - o.x, y2 - o.y) || 1;
    const len1 = d.len * pct;
    let ux = (x2 - o.x) / len0;
    let uy = (y2 - o.y) / len0;
    if (len0 === 1 && x2 === o.x && y2 === o.y) {
      ux = 1;
      uy = 0;
    }
    return {
      ...o,
      x2: Math.round(clamp(o.x + ux * len1, 0, f.w)),
      y2: Math.round(clamp(o.y + uy * len1, 0, f.h)),
    };
  });
}

/** A quarter turn: a symbol turns, a box swaps width and height about its centre, a line swings about its start. */
export function rotateStruct(l: Layout, id: string, floorId: string): Layout {
  const s = l.structs.find((q) => q.id === id);
  const f = floorOf(l, floorId);
  if (!s || !f) return l;
  const kind = kindOf(s);
  return mapStruct(l, id, (o) => {
    if (kind === 'sym') return { ...o, rot: ((o.rot || 0) + 90) % 360 };
    if (kind === 'box') {
      const w0 = o.w ?? 0;
      const h0 = o.h ?? 0;
      const cx = o.x + w0 / 2;
      const cy = o.y + h0 / 2;
      return {
        ...o,
        w: h0,
        h: w0,
        x: Math.round(clamp(cx - h0 / 2, 0, f.w - h0)),
        y: Math.round(clamp(cy - w0 / 2, 0, f.h - w0)),
      };
    }
    const dx = (o.x2 ?? o.x) - o.x;
    const dy = (o.y2 ?? o.y) - o.y;
    return { ...o, x2: Math.round(clamp(o.x - dy, 0, f.w)), y2: Math.round(clamp(o.y + dx, 0, f.h)) };
  });
}

/** Stairs and lifts can show on every floor in the same place. Switching it off pins them to the floor on show. */
export function setStructShared(l: Layout, id: string, shared: boolean, floorId: string): Layout {
  const s = l.structs.find((q) => q.id === id);
  if (!s || !STRUCT_DEFS[s.type]?.vertical) return l;
  return mapStruct(l, id, (o) => ({ ...o, shared, floor: shared ? o.floor : floorId }));
}

/** Move a structure to another floor, nudging it back onto that floor's canvas. */
export function moveStructToFloor(l: Layout, id: string, floorId: string): Layout {
  const s = l.structs.find((q) => q.id === id);
  const f = floorOf(l, floorId);
  if (!s || !f || s.floor === floorId) return l;
  const kind = kindOf(s);
  const bw =
    kind === 'line' ? Math.max(s.x, s.x2 ?? s.x) : kind === 'box' ? s.x + (s.w ?? 0) : s.x + (s.w ?? 0) / 2;
  const bh =
    kind === 'line' ? Math.max(s.y, s.y2 ?? s.y) : kind === 'box' ? s.y + (s.h ?? 0) : s.y + (s.w ?? 0) / 2;
  const sx = Math.min(0, f.w - bw);
  const sy = Math.min(0, f.h - bh);
  return mapStruct(l, id, (o) => ({
    ...o,
    x: o.x + sx,
    y: o.y + sy,
    ...(kind === 'line' ? { x2: (o.x2 ?? o.x) + sx, y2: (o.y2 ?? o.y) + sy } : {}),
    floor: floorId,
  }));
}

/* ---------------------------------------------------------------- floors */

/** The smallest canvas that still holds everything on a floor. */
export function floorExtent(l: Layout, floorId: string): { w: number; h: number } {
  let w = FLOOR_MIN_W;
  let h = FLOOR_MIN_H;
  for (const z of l.zones.filter((q) => q.floor === floorId)) {
    const b = zoneBox(z);
    w = Math.max(w, b.x + b.w);
    h = Math.max(h, b.y + b.h);
  }
  for (const s of l.structs.filter((q) => structOnFloor(q, floorId))) {
    const kind = kindOf(s);
    if (kind === 'line') {
      w = Math.max(w, s.x, s.x2 ?? 0);
      h = Math.max(h, s.y, s.y2 ?? 0);
    } else if (kind === 'box') {
      w = Math.max(w, s.x + (s.w ?? 0));
      h = Math.max(h, s.y + (s.h ?? 0));
    } else {
      w = Math.max(w, s.x + (s.w ?? 0) / 2 + 4);
      h = Math.max(h, s.y + (s.w ?? 0) / 2 + 4);
    }
  }
  for (const e of l.equipment.filter((q) => q.floor === floorId)) {
    w = Math.max(w, e.x + 14);
    h = Math.max(h, e.y + 20);
  }
  return { w: Math.min(FLOOR_MAX_W, Math.ceil(w)), h: Math.min(FLOOR_MAX_H, Math.ceil(h)) };
}

/** Set a floor's canvas size: never smaller than what is on it, never outside 600x400 to 2400x1800. */
export function setFloorSize(l: Layout, floorId: string, w: unknown, h: unknown): Layout {
  const f = floorOf(l, floorId);
  if (!f) return l;
  const min = floorExtent(l, floorId);
  const nw = Number(w);
  const nh = Number(h);
  const fw = clamp(Math.round(Number.isFinite(nw) ? nw : f.w), min.w, FLOOR_MAX_W);
  const fh = clamp(Math.round(Number.isFinite(nh) ? nh : f.h), min.h, FLOOR_MAX_H);
  return { ...l, floors: l.floors.map((q) => (q.id === floorId ? { ...q, w: fw, h: fh } : q)) };
}

export function renameFloor(l: Layout, floorId: string, name: string): Layout {
  const n = name.trim().slice(0, 40);
  return n ? { ...l, floors: l.floors.map((f) => (f.id === floorId ? { ...f, name: n } : f)) } : l;
}

/** A new floor the same size as `like` (or the first floor), named "Floor N". */
export function addFloor(l: Layout, id: string, likeFloorId?: string): Layout {
  const like = floorOf(l, likeFloorId ?? '') ?? l.floors[0];
  return {
    ...l,
    floors: [
      ...l.floors,
      { id, name: `Floor ${l.floors.length + 1}`, w: like?.w ?? 1000, h: like?.h ?? 620 },
    ],
  };
}

export interface FloorDeletion {
  layout: Layout;
  removedZones: number;
  removedMachines: string[];
  removedStructs: number;
}

/**
 * Delete a floor with its zones, machines and architecture. A stairs or lift shared across floors survives, moved
 * to the first remaining floor. The last floor cannot be deleted.
 */
export function deleteFloor(l: Layout, floorId: string): FloorDeletion {
  if (l.floors.length < 2 || !floorOf(l, floorId))
    return { layout: l, removedZones: 0, removedMachines: [], removedStructs: 0 };
  const left = l.floors.find((f) => f.id !== floorId)!.id;
  const gone = l.equipment.filter((e) => e.floor === floorId).map((e) => e.id);
  let removedStructs = 0;
  const structs: Struct[] = [];
  for (const s of l.structs) {
    if (s.floor !== floorId) structs.push(s);
    else if (s.shared && STRUCT_DEFS[s.type]?.vertical) structs.push({ ...s, floor: left });
    else removedStructs += 1;
  }
  return {
    layout: {
      floors: l.floors.filter((f) => f.id !== floorId),
      zones: l.zones.filter((z) => z.floor !== floorId),
      structs,
      equipment: l.equipment.filter((e) => e.floor !== floorId),
    },
    removedZones: l.zones.filter((z) => z.floor === floorId).length,
    removedMachines: gone,
    removedStructs,
  };
}

/** Used by tests and the screen to know whether a zone's rectangles fit a floor. */
export const zoneFitsFloor = (l: Layout, zoneId: string): boolean => {
  const z = l.zones.find((q) => q.id === zoneId);
  const f = z && floorOf(l, z.floor);
  return (
    !!z && !!f && zoneRects(z).every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.w && r.y + r.h <= f.h)
  );
};
