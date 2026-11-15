/**
 * Domain schemas (Zod). Field names follow docs/02-data-model.md; the rules are the prototype's `norm*` rules.
 * Use these to validate anything that comes from the database, a share link or a JSON import.
 */
import { z } from 'zod';
import { CATEGORIES, EQUIPMENT_TYPES, MUSCLES, STRUCT_TYPES } from './import-prototype.ts';

export const CategorySchema = z.enum(CATEGORIES);
export const EquipTypeSchema = z.enum(EQUIPMENT_TYPES);
export const MuscleSchema = z.enum(MUSCLES);
export const StructTypeSchema = z.enum(STRUCT_TYPES);
export const LevelSchema = z.enum(['B', 'I', 'A']);
export const SubStatusSchema = z.enum(['active', 'trial', 'paused', 'expired']);

const num = z.number().finite();
const text = (max: number) => z.string().trim().max(max);

export const RectSchema = z.object({ x: num, y: num, w: num.min(16), h: num.min(16) });

export const FloorSchema = z.object({
  id: z.string().min(1),
  name: text(60).min(1),
  w: z.number().int().min(600).max(2400),
  h: z.number().int().min(400).max(1800),
});

/** `parts` are the extra rectangles of a joined zone: up to 11, so at most 12 rectangles in total. */
export const ZoneSchema = z.object({
  id: z.string().min(1),
  name: text(60).min(1),
  cat: CategorySchema,
  x: num,
  y: num,
  w: num.min(60),
  h: num.min(50),
  floor: z.string().min(1),
  parts: z.array(RectSchema).max(11).optional(),
});

export const StructSchema = z.object({
  id: z.string().min(1),
  type: StructTypeSchema,
  floor: z.string().min(1),
  x: num,
  y: num,
  w: num.optional(),
  h: num.optional(),
  x2: num.optional(),
  y2: num.optional(),
  rot: num.default(0),
  label: text(60).default(''),
  shared: z.boolean().default(false),
});

export const EquipmentSchema = z.object({
  id: z.string().min(1),
  name: text(60).min(1),
  zone: z.string().min(1),
  type: EquipTypeSchema,
  x: num,
  y: num,
  muscles: z.array(MuscleSchema).default([]),
  notes: text(1000).default(''),
  floor: z.string().min(1),
});

export const ExerciseSchema = z.object({
  id: z.string().min(1),
  name: text(80).min(1),
  muscles: z.array(MuscleSchema).default([]),
  equipmentIds: z.array(z.string()).default([]),
  level: LevelSchema.default('B'),
  sets: z.number().int().min(1).max(99).default(3),
  reps: text(40).default('10'),
  rest: z.number().int().min(0).max(3600).default(60),
  cue: text(1000).default(''),
});

/** A saved gym layout. A gym may have no zones (blank plan) but needs at least one floor. */
export const LayoutSchema = z
  .object({
    floors: z.array(FloorSchema).min(1),
    zones: z.array(ZoneSchema),
    structs: z.array(StructSchema),
    equipment: z.array(EquipmentSchema),
  })
  .superRefine((layout, ctx) => {
    const floorIds = new Set(layout.floors.map((f) => f.id));
    const zoneById = new Map(layout.zones.map((z) => [z.id, z]));
    layout.zones.forEach((z, i) => {
      if (!floorIds.has(z.floor))
        ctx.addIssue({ code: 'custom', path: ['zones', i, 'floor'], message: `Unknown floor "${z.floor}"` });
    });
    layout.structs.forEach((s, i) => {
      if (!floorIds.has(s.floor))
        ctx.addIssue({
          code: 'custom',
          path: ['structs', i, 'floor'],
          message: `Unknown floor "${s.floor}"`,
        });
    });
    layout.equipment.forEach((e, i) => {
      const zone = zoneById.get(e.zone);
      if (!zone)
        ctx.addIssue({ code: 'custom', path: ['equipment', i, 'zone'], message: `Unknown zone "${e.zone}"` });
      else if (zone.floor !== e.floor)
        ctx.addIssue({
          code: 'custom',
          path: ['equipment', i, 'floor'],
          message: "Equipment floor must be its zone's floor",
        });
    });
  });

export const GymSchema = z.object({
  id: z.string().min(1),
  name: text(60).min(1),
  branch: text(60).default(''),
  address: text(160).default(''),
  phone: text(40).default(''),
  notes: text(1000).default(''),
});

/** What the app needs to draw the header and gym bar (a row from the `gyms` table). */
export const GymSummarySchema = GymSchema.extend({ updated_at: z.string().optional() });
export type GymSummary = z.infer<typeof GymSummarySchema>;

export const ItemSnapSchema = z.object({
  eid: z.string().min(1),
  xid: z.string().nullable(),
  exercise: text(80).min(1),
  sets: z.number().int().min(1).max(99),
  reps: text(40),
  rest: z.number().int().min(0).max(3600),
  note: text(500).default(''),
});

export const TemplateSchema = z.object({
  id: z.string().min(1),
  name: text(80).min(1),
  notes: text(2000).default(''),
  gymId: z.string().min(1),
  items: z.array(ItemSnapSchema),
});

export const ProgrammeSchema = z.object({
  id: z.string().min(1),
  title: text(120).min(1),
  notes: text(2000).default(''),
  gymId: z.string().nullable(),
  items: z.array(ItemSnapSchema),
});

/** `privateNotes` is trainer-only: it must never be part of a client link or PDF (see `publicClientView`). */
export const ClientSchema = z.object({
  id: z.string().min(1),
  name: text(120).min(1),
  whatsapp: text(40).default(''),
  email: z.union([z.literal(''), z.string().trim().email()]).default(''),
  emergencyName: text(120).default(''),
  emergencyPhone: text(40).default(''),
  emergencyRelation: text(60).default(''),
  plan: text(80).default(''),
  subStatus: SubStatusSchema.default('active'),
  perWeek: z.number().int().min(0).max(14).default(0),
  sessionsLeft: z.number().int().default(0),
  renewal: z.string().nullable().default(null),
  goals: text(2000).default(''),
  privateNotes: text(4000).default(''),
});
export type Client = z.infer<typeof ClientSchema>;

/** Fields a client may ever see on a shared programme page. Anything else is dropped. */
export const PublicClientViewSchema = ClientSchema.pick({ name: true, goals: true });
export function publicClientView(client: Client): z.infer<typeof PublicClientViewSchema> {
  return PublicClientViewSchema.parse(client);
}

export const ConsentSchema = z
  .object({
    subject: z.enum(['trainer', 'client']),
    clientId: z.string().nullable(),
    purpose: text(80).min(1),
    noticeVersion: text(40).min(1),
  })
  .refine((c) => (c.subject === 'client') === (c.clientId !== null), {
    message: 'A client consent needs a client id; a trainer consent must not have one',
  });

export type Layout = z.infer<typeof LayoutSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type Equipment = z.infer<typeof EquipmentSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type ItemSnap = z.infer<typeof ItemSnapSchema>;
