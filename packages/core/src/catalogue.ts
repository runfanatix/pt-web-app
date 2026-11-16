/**
 * The equipment catalogue: manufacturers and the models they make, filled in by hand (or imported later). A machine
 * on the floor plan can point at one model so a routine names the real machine. Rows come from the database, so they
 * are validated here; nothing is trusted.
 *
 * Read with: from('manufacturers').select(CATALOGUE_SELECT).order('name')
 */
import { z } from 'zod';
import { EQUIPMENT_TYPES, MUSCLES } from './import-prototype.ts';
import type { Layout } from './schemas.ts';

export const CATALOGUE_SELECT =
  'id, trainer_id, name, catalogue_items(id, trainer_id, model_name, code, kind, muscles, specs, notes)';

const text = (max: number) => z.string().trim().max(max);

export const SpecSchema = z.object({ label: text(40).min(1), value: text(80) });
export type Spec = z.infer<typeof SpecSchema>;

export const ManufacturerInputSchema = z.object({ name: text(60).min(1) });

export const ModelInputSchema = z.object({
  model: text(80).min(1),
  code: text(40).default(''),
  kind: z.enum(EQUIPMENT_TYPES).default('machine'),
  muscles: z.array(z.enum(MUSCLES)).default([]),
  specs: z.array(SpecSchema).max(30).default([]),
  notes: text(1000).default(''),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;

export interface Manufacturer {
  id: string;
  name: string;
  /** A shared manufacturer or model is read-only: it was loaded for everyone. */
  shared: boolean;
}
export interface CatalogueItem extends ModelInput {
  id: string;
  manufacturerId: string;
  shared: boolean;
}
export interface Catalogue {
  manufacturers: Manufacturer[];
  items: CatalogueItem[];
}
export const emptyCatalogue = (): Catalogue => ({ manufacturers: [], items: [] });

const ItemRow = z.object({
  id: z.string(),
  trainer_id: z.string().nullable(),
  model_name: z.string(),
  code: z.string(),
  kind: z.string(),
  muscles: z.array(z.string()),
  specs: z.unknown(),
  notes: z.string(),
});
const ManufacturerRow = z.object({
  id: z.string(),
  trainer_id: z.string().nullable(),
  name: z.string(),
  catalogue_items: z.array(ItemRow).default([]),
});

const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

/** Turns the nested rows into a Catalogue, sorted by name. A row that fails validation is dropped, not shown wrongly. */
export function catalogueFromRows(input: unknown): Catalogue {
  const rows = z.array(ManufacturerRow).parse(input);
  const manufacturers: Manufacturer[] = [];
  const items: CatalogueItem[] = [];
  for (const m of rows) {
    manufacturers.push({ id: m.id, name: m.name, shared: m.trainer_id === null });
    for (const r of m.catalogue_items) {
      const parsed = ModelInputSchema.safeParse({
        model: r.model_name,
        code: r.code,
        kind: r.kind,
        muscles: r.muscles,
        specs: r.specs,
        notes: r.notes,
      });
      if (parsed.success)
        items.push({ ...parsed.data, id: r.id, manufacturerId: m.id, shared: r.trainer_id === null });
    }
  }
  manufacturers.sort((a, b) => byName(a.name, b.name));
  items.sort((a, b) => byName(a.model, b.model));
  return { manufacturers, items };
}

export interface ModelEntry {
  item: CatalogueItem;
  manufacturer: Manufacturer;
}
export function catalogueIndex(c: Catalogue): Map<string, ModelEntry> {
  const mf = new Map(c.manufacturers.map((m) => [m.id, m]));
  const out = new Map<string, ModelEntry>();
  for (const item of c.items) {
    const manufacturer = mf.get(item.manufacturerId);
    if (manufacturer) out.set(item.id, { item, manufacturer });
  }
  return out;
}

/** "Technogym Selection Chest Press": what the machine really is. */
export const modelName = (e: ModelEntry): string => `${e.manufacturer.name} ${e.item.model}`;
/** The same with the item code, when it has one: "Technogym Selection Chest Press (MPY01)". */
export const modelWithCode = (e: ModelEntry): string =>
  e.item.code ? `${modelName(e)} (${e.item.code})` : modelName(e);

/** What a machine is called when the real model is known: its own name, then the model after a dot. */
export function machineTitle(name: string, entry: ModelEntry | undefined): string {
  if (!entry) return name;
  const n = name.trim().toLowerCase();
  if (n.includes(modelName(entry).toLowerCase())) return name;
  // The name is already the model: only the maker is new.
  if (n.includes(entry.item.model.toLowerCase())) return `${name} · ${entry.manufacturer.name}`;
  return `${name} · ${modelName(entry)}`;
}

/** Models matching a search of the model name, code or manufacturer, optionally within one manufacturer. */
export function searchModels(c: Catalogue, query: string, manufacturerId?: string): CatalogueItem[] {
  const q = query.trim().toLowerCase();
  const mf = new Map(c.manufacturers.map((m) => [m.id, m.name.toLowerCase()]));
  return c.items.filter(
    (i) =>
      (!manufacturerId || i.manufacturerId === manufacturerId) &&
      (!q ||
        i.model.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        (mf.get(i.manufacturerId) ?? '').includes(q)),
  );
}

type Equip = Layout['equipment'][number];

/**
 * Point a machine at a catalogue model (or clear it with null). Optionally take the model's name, kind and muscles
 * for the machine too, so the plan, the filters and the routine agree with the real machine.
 */
export function assignModel(
  l: Layout,
  equipmentId: string,
  entry: ModelEntry | null,
  opts: { rename?: boolean; copyDetails?: boolean } = {},
): Layout {
  return {
    ...l,
    equipment: l.equipment.map((e): Equip => {
      if (e.id !== equipmentId) return e;
      if (!entry) return { ...e, catalogueId: null };
      const next: Equip = { ...e, catalogueId: entry.item.id };
      if (opts.rename) next.name = entry.item.model.slice(0, 60);
      if (opts.copyDetails) {
        next.type = entry.item.kind;
        if (entry.item.muscles.length) next.muscles = [...entry.item.muscles];
      }
      return next;
    }),
  };
}

/* ---------------------------------------------------------------- bulk import */

const ImportItem = z.object({
  model: text(80).min(1),
  code: text(40).optional(),
  kind: z.string().optional(),
  muscles: z.array(z.string()).optional(),
  specs: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).optional(),
  notes: z.string().optional(),
});
export const CatalogueImportSchema = z.object({
  manufacturers: z.array(z.object({ name: text(60).min(1), items: z.array(ImportItem).default([]) })),
});

export interface CatalogueImportPlan {
  manufacturers: string[];
  items: (ModelInput & { manufacturer: string })[];
  warnings: string[];
}

/**
 * Plan a bulk import from JSON: { manufacturers: [{ name, items: [{ model, code?, kind?, muscles?, specs?, notes? }] }] }.
 * Bad kinds and muscles are fixed with a warning rather than rejecting the whole file; repeated codes are skipped.
 */
export function planCatalogueImport(json: unknown): CatalogueImportPlan {
  const parsed = CatalogueImportSchema.parse(json);
  const warnings: string[] = [];
  const manufacturers: string[] = [];
  const items: CatalogueImportPlan['items'] = [];
  const seenMf = new Set<string>();
  for (const m of parsed.manufacturers) {
    const key = m.name.toLowerCase();
    if (!seenMf.has(key)) {
      seenMf.add(key);
      manufacturers.push(m.name);
    }
    const codes = new Set<string>();
    const models = new Set<string>();
    for (const r of m.items) {
      const code = (r.code ?? '').trim();
      if (code && codes.has(code.toLowerCase())) {
        warnings.push(`${m.name}: code ${code} appears twice; "${r.model}" was skipped.`);
        continue;
      }
      if (!code && models.has(r.model.toLowerCase())) {
        warnings.push(`${m.name}: "${r.model}" appears twice; the second was skipped.`);
        continue;
      }
      if (code) codes.add(code.toLowerCase());
      models.add(r.model.toLowerCase());
      let kind = (r.kind ?? 'machine') as ModelInput['kind'];
      if (!(EQUIPMENT_TYPES as readonly string[]).includes(kind)) {
        warnings.push(`${m.name} ${r.model}: unknown kind "${r.kind}", used "machine".`);
        kind = 'machine';
      }
      const muscles = (r.muscles ?? []).filter((x): x is ModelInput['muscles'][number] => {
        const ok = (MUSCLES as readonly string[]).includes(x);
        if (!ok) warnings.push(`${m.name} ${r.model}: unknown muscle "${x}" left out.`);
        return ok;
      });
      const specs = (r.specs ?? [])
        .map((s) => ({ label: s.label.trim().slice(0, 40), value: String(s.value).trim().slice(0, 80) }))
        .filter((s) => s.label)
        .slice(0, 30);
      items.push({
        manufacturer: m.name,
        model: r.model,
        code: code.slice(0, 40),
        kind,
        muscles,
        specs,
        notes: (r.notes ?? '').trim().slice(0, 1000),
      });
    }
  }
  return { manufacturers, items, warnings };
}
