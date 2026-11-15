/**
 * Starting a new gym: a blank floor plan, or a copy of an existing layout where every floor, zone, structure and
 * machine gets a new id (so the copy shares nothing with the original). The prototype's createGym / duplicateGym.
 */
import type { Layout } from './schemas.ts';

/** One empty floor and nothing else: draw the gym from scratch. */
export function blankLayout(floorId: string): Layout {
  return {
    floors: [{ id: floorId, name: 'Ground floor', w: 1000, h: 620 }],
    zones: [],
    structs: [],
    equipment: [],
  };
}

export interface LayoutCopy {
  layout: Layout;
  /** Each machine and the machine it was copied from, to copy its exercise links. */
  machines: { from: string; to: string }[];
}

/** A deep copy with fresh ids everywhere. `newId` is called once per floor, zone, structure and machine. */
export function cloneLayout(l: Layout, newId: () => string): LayoutCopy {
  const floors = new Map(l.floors.map((f) => [f.id, newId()]));
  const zones = new Map(l.zones.map((z) => [z.id, newId()]));
  const machines = l.equipment.map((e) => ({ from: e.id, to: newId() }));
  const eq = new Map(machines.map((m) => [m.from, m.to]));
  const fid = (id: string) => floors.get(id) ?? id;
  return {
    layout: {
      floors: l.floors.map((f) => ({ ...f, id: fid(f.id) })),
      zones: l.zones.map((z) => ({
        ...z,
        id: zones.get(z.id)!,
        floor: fid(z.floor),
        ...(z.parts ? { parts: z.parts.map((p) => ({ ...p })) } : {}),
      })),
      structs: l.structs.map((s) => ({ ...s, id: newId(), floor: fid(s.floor) })),
      equipment: l.equipment.map((e) => ({
        ...e,
        id: eq.get(e.id)!,
        zone: zones.get(e.zone) ?? e.zone,
        floor: fid(e.floor),
        muscles: [...e.muscles],
      })),
    },
    machines,
  };
}

/** "Name Branch" as the gym picker shows it. */
export const gymTitle = (g: { name: string; branch?: string }): string =>
  [g.name, g.branch].filter(Boolean).join(' ');

/** A gym name that no other gym has: "Base", then "Base 2", "Base 3"... compared on the full title. */
export function uniqueGymName(
  existing: { name: string; branch?: string }[],
  name: string,
  branch: string,
): string {
  const taken = new Set(existing.map((g) => gymTitle(g).toLowerCase()));
  if (!taken.has(gymTitle({ name, branch }).toLowerCase())) return name;
  let i = 2;
  while (taken.has(gymTitle({ name: `${name} ${i}`, branch }).toLowerCase())) i += 1;
  return `${name} ${i}`;
}
