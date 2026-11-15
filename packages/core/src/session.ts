/**
 * Session (routine) logic, ported from prototype/zone-planner-v11.html: marker numbers, route lines per floor,
 * time estimate, reordering, and remapping items onto another gym's equipment. Pure and unit-tested.
 */
import type { ItemSnap, Layout } from './schemas.ts';

type Equip = Layout['equipment'][number];

export interface SessionItem {
  /** Unique within the session; used as the React key and to track edits. */
  uid: string;
  /** Equipment (machine) id. */
  eid: string;
  /** Library exercise id, or null for a free-typed exercise. */
  xid: string | null;
  exercise: string;
  sets: number;
  /** Text, e.g. "8-10" or "8 min". */
  reps: string;
  /** Seconds. */
  rest: number;
  note: string;
}

export interface SessionMeta {
  title: string;
  /** The client's name as shown on the PDF and the log: a saved client's name, or a free-typed guest name. */
  client: string;
  /** Id of the saved client this routine is for, or '' for a guest. */
  clientId: string;
  coach: string;
  /** YYYY-MM-DD. */
  date: string;
  notes: string;
}

export interface LibraryExercise {
  id: string;
  name: string;
  muscles: string[];
  level: string;
  sets: number;
  reps: string;
  rest: number;
  cue: string;
  equipmentIds: string[];
}

export const LEVEL_NAMES: Record<string, string> = { B: 'Beginner', I: 'Intermediate', A: 'Advanced' };

/** "3 x 10 · 60 s rest" */
export function rxText(x: { sets: number; reps: string; rest: number }): string {
  return `${x.sets} x ${x.reps}${x.rest ? ` · ${x.rest} s rest` : ''}`;
}

/** Exercises linked to a machine, sorted by name. */
export function exercisesFor(library: LibraryExercise[], eid: string): LibraryExercise[] {
  return library
    .filter((x) => x.equipmentIds.includes(eid))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function itemFromExercise(uid: string, eid: string, x: LibraryExercise): SessionItem {
  return { uid, eid, xid: x.id, exercise: x.name, sets: x.sets, reps: x.reps, rest: x.rest, note: '' };
}

/** Marker numbers per machine: a machine used twice shows "1+" and so on. */
export function sessionIndices(items: SessionItem[]): Record<string, number[]> {
  const m: Record<string, number[]> = {};
  items.forEach((it, i) => (m[it.eid] ??= []).push(i + 1));
  return m;
}

/** Moves the item at `from` to position `to` (both clamped). Returns a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return items;
  const out = items.slice();
  const [it] = out.splice(from, 1);
  out.splice(target, 0, it as T);
  return out;
}

/**
 * Time estimate in seconds: 45 s of work per set unless reps says "N min", plus rest between sets.
 * (The prototype's calcSecs.)
 */
export function estimateSeconds(items: Pick<SessionItem, 'sets' | 'reps' | 'rest'>[]): number {
  let secs = 0;
  for (const it of items) {
    const sets = Math.max(1, Number(it.sets) || 1);
    const m = /(\d+)\s*min/i.exec(String(it.reps));
    const work = m ? Number(m[1]) * 60 : 45;
    secs += sets * work + (sets - 1) * (Number(it.rest) || 0);
  }
  return secs;
}

/** The floor route as place names, collapsing repeats ("Cardio → Free weights → Studio"). */
export function routePlaces(
  items: SessionItem[],
  equipmentById: Map<string, Equip>,
  place: (e: Equip) => string,
): string[] {
  const route: string[] = [];
  for (const it of items) {
    const e = equipmentById.get(it.eid);
    if (!e) continue;
    const name = place(e);
    if (route[route.length - 1] !== name) route.push(name);
  }
  return route;
}

export interface RouteGeometry {
  /** Connected runs of machines on this floor, as [x, y] points. */
  polylines: [number, number][][];
  /** Legs that start or end on this floor and the other end is on another floor. */
  cross: { from: Equip; to: Equip }[];
}

/**
 * Route lines for one floor. Consecutive items on the same machine add no leg. A leg with both ends on the floor
 * extends a polyline; a leg with one end elsewhere becomes a cross-floor chip ("to First floor").
 */
export function routeForFloor(
  items: SessionItem[],
  equipmentById: Map<string, Equip>,
  floorId: string,
): RouteGeometry {
  const polylines: [number, number][][] = [];
  const cross: RouteGeometry['cross'] = [];
  let cur: [number, number][] = [];
  let prev: Equip | null = null;
  for (const it of items) {
    const e = equipmentById.get(it.eid);
    if (!e || (prev && prev.id === e.id)) continue;
    if (prev) {
      const pon = prev.floor === floorId;
      const on = e.floor === floorId;
      if (pon && on) {
        if (!cur.length) cur.push([prev.x, prev.y]);
        cur.push([e.x, e.y]);
      } else {
        if (cur.length > 1) polylines.push(cur);
        cur = [];
        if (pon || on) cross.push({ from: prev, to: e });
      }
    }
    prev = e;
  }
  if (cur.length > 1) polylines.push(cur);
  return { polylines, cross };
}

/** Number of exercises on each floor (shown as a badge on the floor tabs). */
export function itemsPerFloor(
  items: SessionItem[],
  equipmentById: Map<string, Equip>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of items) {
    const e = equipmentById.get(it.eid);
    if (e) counts[e.floor] = (counts[e.floor] ?? 0) + 1;
  }
  return counts;
}

/* ---------------------------------------------------------------- remapping onto another gym */

export interface EquipRef {
  id: string;
  name: string;
  type: string;
}

/**
 * Finds the machine in `candidates` that an item should use: same id, else same name (preferring the same type),
 * else a machine the exercise is linked to. Returns '' when nothing fits. (The prototype's remapEid.)
 */
export function remapEid(
  eid: string,
  xid: string | null,
  old: { name?: string; type?: string } | undefined,
  candidates: EquipRef[],
  links: Record<string, string[]>,
): string {
  const byId = new Map(candidates.map((e) => [e.id, e]));
  if (byId.has(eid)) return eid;
  const nm = (old?.name ?? '').trim().toLowerCase();
  if (nm) {
    const named = candidates.filter((e) => e.name.trim().toLowerCase() === nm);
    if (named.length) return (named.find((e) => e.type === old?.type) ?? named[0]!).id;
  }
  for (const id of (xid && links[xid]) || []) if (byId.has(id)) return id;
  return '';
}

export interface RemapResult {
  items: ItemSnap[];
  kept: number;
  moved: number;
  skipped: number;
}

/** Remaps stored items onto the open gym. `oldEquipment` describes machines of the gym the items came from. */
export function remapItems(
  snaps: ItemSnap[],
  candidates: EquipRef[],
  links: Record<string, string[]>,
  oldEquipment: Map<string, { name: string; type: string }> = new Map(),
): RemapResult {
  const out: ItemSnap[] = [];
  let kept = 0;
  let moved = 0;
  let skipped = 0;
  const ids = new Set(candidates.map((e) => e.id));
  for (const s of snaps) {
    if (ids.has(s.eid)) {
      out.push(s);
      kept += 1;
      continue;
    }
    const eid = remapEid(s.eid, s.xid, oldEquipment.get(s.eid), candidates, links);
    if (!eid) {
      skipped += 1;
      continue;
    }
    out.push({ ...s, eid });
    moved += 1;
  }
  return { items: out, kept, moved, skipped };
}

/** Normalises stored items: sets at least 1, rest at least 0, text trimmed to strings. */
export function cleanSnaps(raw: unknown): ItemSnap[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (q): q is Record<string, unknown> => !!q && typeof q === 'object' && !!(q as { eid?: unknown }).eid,
    )
    .map((q) => ({
      eid: String(q.eid),
      xid: q.xid ? String(q.xid) : null,
      exercise: String(q.exercise ?? ''),
      sets: Math.max(1, Math.round(Number(q.sets)) || 1),
      reps: String(q.reps ?? ''),
      rest: Math.max(0, Number(q.rest) || 0),
      note: String(q.note ?? ''),
    }));
}

export function snapsOf(items: SessionItem[]): ItemSnap[] {
  return cleanSnaps(items);
}
