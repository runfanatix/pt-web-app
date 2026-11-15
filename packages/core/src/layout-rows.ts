/**
 * Turns the nested rows the app reads from Supabase (floors with their zones, parts, equipment and structures)
 * into the domain `Layout`. Validates everything: rows come from the database, so nothing is trusted.
 *
 * The matching query (one request, row-level security does the filtering):
 *   from('floors').select(FLOORS_SELECT).eq('gym_id', gymId).order('position')
 */
import { z } from 'zod';
import type { ImportPlan } from './import-prototype.ts';
import { LayoutSchema, type Layout } from './schemas.ts';

export const FLOORS_SELECT =
  'id, name, w, h, position,' +
  ' zones(id, name, category, x, y, w, h, zone_parts(x, y, w, h, position), equipment(id, name, type, x, y, muscles, notes)),' +
  ' structs(id, type, x, y, w, h, x2, y2, rotation, label, shared)';

// Postgres `numeric` can arrive as a number or a string depending on the client, so coerce.
const n = z.coerce.number();
const nullableN = z.coerce.number().nullable();

const EquipmentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  x: n,
  y: n,
  muscles: z.array(z.string()),
  notes: z.string(),
});
const PartRowSchema = z.object({ x: n, y: n, w: n, h: n, position: z.number() });
const ZoneRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  x: n,
  y: n,
  w: n,
  h: n,
  zone_parts: z.array(PartRowSchema),
  equipment: z.array(EquipmentRowSchema),
});
const StructRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: n,
  y: n,
  w: nullableN,
  h: nullableN,
  x2: nullableN,
  y2: nullableN,
  rotation: n,
  label: z.string(),
  shared: z.boolean(),
});
export const FloorTreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  w: z.number(),
  h: z.number(),
  position: z.number(),
  zones: z.array(ZoneRowSchema),
  structs: z.array(StructRowSchema),
});
export type FloorTreeRow = z.infer<typeof FloorTreeSchema>;

const opt = (v: number | null): number | undefined => (v === null ? undefined : v);

/** Throws a ZodError if the rows are malformed or break a layout rule (see LayoutSchema). */
export function layoutFromFloorRows(input: unknown): Layout {
  const rows = FloorTreeSchema.array().parse(input);
  const floors = rows.slice().sort((a, b) => a.position - b.position);

  const draft = {
    floors: floors.map((f) => ({ id: f.id, name: f.name, w: f.w, h: f.h })),
    zones: floors.flatMap((f) =>
      f.zones.map((z) => {
        const parts = z.zone_parts
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
        return {
          id: z.id,
          name: z.name,
          cat: z.category,
          x: z.x,
          y: z.y,
          w: z.w,
          h: z.h,
          floor: f.id,
          ...(parts.length ? { parts } : {}),
        };
      }),
    ),
    structs: floors.flatMap((f) =>
      f.structs.map((s) => ({
        id: s.id,
        type: s.type,
        floor: f.id,
        x: s.x,
        y: s.y,
        w: opt(s.w),
        h: opt(s.h),
        x2: opt(s.x2),
        y2: opt(s.y2),
        rot: s.rotation,
        label: s.label,
        shared: s.shared,
      })),
    ),
    // An item's floor is always its zone's floor.
    equipment: floors.flatMap((f) =>
      f.zones.flatMap((z) =>
        z.equipment.map((e) => ({
          id: e.id,
          name: e.name,
          zone: z.id,
          type: e.type,
          x: e.x,
          y: e.y,
          muscles: e.muscles,
          notes: e.notes,
          floor: f.id,
        })),
      ),
    ),
  };
  return LayoutSchema.parse(draft);
}

/**
 * Builds the nested rows (what FLOORS_SELECT returns) from an import plan. Used by tests and previews to draw a
 * plan without a database; the importer's rows have exactly the columns the app reads.
 */
export function floorRowsFromPlan(plan: ImportPlan): FloorTreeRow[] {
  return plan.floors.map((f) => ({
    id: f.id,
    name: f.name,
    w: f.w,
    h: f.h,
    position: f.position,
    zones: plan.zones
      .filter((z) => z.floor_id === f.id)
      .map((z) => ({
        id: z.id,
        name: z.name,
        category: z.category,
        x: z.x,
        y: z.y,
        w: z.w,
        h: z.h,
        zone_parts: plan.zoneParts.filter((p) => p.zone_id === z.id),
        equipment: plan.equipment.filter((e) => e.zone_id === z.id),
      })),
    structs: plan.structs.filter((s) => s.floor_id === f.id),
  }));
}
