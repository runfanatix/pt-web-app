/**
 * Import the JSON that the v11 prototype produces (Data tab, "Copy JSON") into the real database.
 *
 * Two layers:
 *  - planPrototypeImport(): pure. Validates the file and turns it into rows shaped like docs/02-data-model.md,
 *    with fresh UUIDs. No database, no network. Unit tested.
 *  - runImport(): writes a plan through an ImportSink (Supabase in scripts/import-prototype.ts, in memory in tests)
 *    and rolls everything back if a step fails.
 *
 * One file = one gym (the prototype exports the gym that is open). To bring in several gyms, open each in the
 * prototype, copy its JSON, and run the importer once per file.
 * Not in the prototype export (so not imported): clients, run history, and exercises that are not linked to a machine.
 */

export const CATEGORIES = ['cardio', 'strength', 'functional', 'studio', 'water', 'amenity', 'outdoor'] as const;
export const EQUIPMENT_TYPES = ['cardio', 'machine', 'free', 'rig', 'space'] as const;
export const MUSCLES = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs', 'glutes', 'cardio', 'full body', 'mobility'] as const;
export const STRUCT_TYPES = ['stairs', 'lift', 'door', 'revolving', 'dglass', 'column', 'toilets', 'wall', 'balustrade', 'glass'] as const;
const VERTICAL_TYPES = ['stairs', 'lift'];
const BOX_TYPES = ['stairs', 'lift', 'toilets'];
const SYMBOL_TYPES = ['door', 'revolving', 'dglass', 'column'];
const LEVELS = ['B', 'I', 'A'];

export interface ImportOptions {
  trainerId: string;
  /** Overrides the gym name found in the file. */
  gymName?: string;
  /** Also import the session that was on screen when the JSON was copied, as a template. */
  includeSession?: boolean;
  /** Import every exercise in the file, not only those linked to a machine or used by a template. */
  allExercises?: boolean;
  /** Id generator; defaults to crypto.randomUUID. Inject a counter in tests. */
  newId?: () => string;
}

export interface GymRow { id: string; trainer_id: string; name: string; branch: string; address: string; phone: string; notes: string }
export interface FloorRow { id: string; gym_id: string; name: string; w: number; h: number; position: number }
export interface ZoneRow { id: string; floor_id: string; name: string; category: string; x: number; y: number; w: number; h: number }
export interface ZonePartRow { id: string; zone_id: string; x: number; y: number; w: number; h: number; position: number }
export interface StructRow {
  id: string; floor_id: string; type: string; x: number; y: number; w: number | null; h: number | null;
  x2: number | null; y2: number | null; rotation: number; label: string; shared: boolean;
}
export interface EquipmentRow { id: string; zone_id: string; name: string; type: string; x: number; y: number; muscles: string[]; notes: string }
export interface ExerciseDef { legacyId: string; name: string; muscles: string[]; level: string; sets: number; reps: string; rest: number; cue: string }
export interface LinkDef { exerciseLegacyId: string; equipmentId: string }
export interface TemplateRow { id: string; trainer_id: string; gym_id: string; name: string; notes: string }
export interface TemplateItemRow {
  id: string; template_id: string; position: number; equipment_id: string; exercise_legacy_id: string | null;
  exercise_name: string; sets: number; reps: string; rest: number; note: string;
}

export interface ImportPlan {
  gym: GymRow;
  floors: FloorRow[];
  zones: ZoneRow[];
  zoneParts: ZonePartRow[];
  structs: StructRow[];
  equipment: EquipmentRow[];
  exercises: ExerciseDef[];
  links: LinkDef[];
  templates: TemplateRow[];
  templateItems: TemplateItemRow[];
}

export class ImportError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super('The file cannot be imported:\n- ' + problems.join('\n- '));
    this.name = 'ImportError';
    this.problems = problems;
  }
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v: unknown, max: number): string { return (v == null ? '' : String(v)).trim().slice(0, max); }
function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function numOr(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function inList(list: readonly string[], v: unknown): boolean { return typeof v === 'string' && list.indexOf(v) >= 0; }

export function planPrototypeImport(input: unknown, opts: ImportOptions): { plan: ImportPlan; warnings: string[] } {
  const warnings: string[] = [];
  const newId = opts.newId || (() => crypto.randomUUID());
  if (!opts.trainerId) throw new ImportError(['A trainer id is required.']);
  if (!isObj(input)) throw new ImportError(['The file is not a JSON object.']);
  if (!Array.isArray(input.equipment)) throw new ImportError(['The file needs an "equipment" list. Use Data, Copy JSON in the prototype.']);
  if (!Array.isArray(input.zones)) throw new ImportError(['The file needs a "zones" list.']);

  /* gym */
  const g = isObj(input.gym) ? input.gym : {};
  const name = str(opts.gymName || g.name || input.venue, 60);
  if (!name) throw new ImportError(['The file has no gym name. Pass one with gymName.']);
  const gym: GymRow = {
    id: newId(), trainer_id: opts.trainerId, name,
    branch: opts.gymName ? '' : str(g.branch, 60), address: str(g.address, 160), phone: str(g.phone, 40), notes: str(g.notes, 1000)
  };

  /* floors */
  const floorIds = new Map<string, string>();
  const floors: FloorRow[] = [];
  (Array.isArray(input.floors) ? input.floors : []).forEach((f) => {
    if (!isObj(f) || !f.id || floorIds.has(String(f.id))) return;
    const row: FloorRow = {
      id: newId(), gym_id: gym.id, name: str(f.name, 60) || 'Floor',
      w: clamp(Math.round(numOr(f.w, 1000)), 600, 2400), h: clamp(Math.round(numOr(f.h, 620)), 400, 1800), position: floors.length
    };
    floorIds.set(String(f.id), row.id);
    floors.push(row);
  });
  if (!floors.length) {
    const row: FloorRow = { id: newId(), gym_id: gym.id, name: 'Ground floor', w: 1000, h: 620, position: 0 };
    floors.push(row);
    warnings.push('The file has no floors, so one "Ground floor" was created.');
  }
  const firstFloor = floors[0].id;
  const floorOf = (legacy: unknown): string => floorIds.get(String(legacy)) || firstFloor;

  /* zones and their extra rectangles */
  const zoneIds = new Map<string, string>();
  const zones: ZoneRow[] = [];
  const zoneParts: ZonePartRow[] = [];
  const problems: string[] = [];
  input.zones.forEach((z, i) => {
    if (!isObj(z) || !z.id || !z.name || !isNum(z.x) || !isNum(z.y) || !isNum(z.w) || !isNum(z.h)) {
      problems.push('Zone ' + (i + 1) + ' needs id, name, x, y, w and h.');
      return;
    }
    const row: ZoneRow = {
      id: newId(), floor_id: floorOf(z.floor), name: str(z.name, 60),
      category: inList(CATEGORIES, z.cat) ? String(z.cat) : 'amenity',
      x: z.x, y: z.y, w: Math.max(60, z.w), h: Math.max(50, z.h)
    };
    if (!inList(CATEGORIES, z.cat)) warnings.push('Zone "' + row.name + '" has an unknown type, set to amenity.');
    if (z.floor && !floorIds.has(String(z.floor))) warnings.push('Zone "' + row.name + '" pointed at a missing floor and was put on the first floor.');
    zoneIds.set(String(z.id), row.id);
    zones.push(row);
    (Array.isArray(z.parts) ? z.parts : []).slice(0, 11).forEach((p) => {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !isNum(p.w) || !isNum(p.h)) return;
      zoneParts.push({ id: newId(), zone_id: row.id, x: p.x, y: p.y, w: Math.max(16, p.w), h: Math.max(16, p.h), position: zoneParts.filter((q) => q.zone_id === row.id).length });
    });
  });

  /* equipment: keep the zone link, or find the zone that contains the marker */
  const equipIds = new Map<string, string>();
  const equipment: EquipmentRow[] = [];
  const zoneRects = (zid: string): { x: number; y: number; w: number; h: number }[] => {
    const zr = zones.find((q) => q.id === zid);
    return zr ? [zr, ...zoneParts.filter((p) => p.zone_id === zid)] : [];
  };
  input.equipment.forEach((e, i) => {
    if (!isObj(e) || !e.id || !e.name || !isNum(e.x) || !isNum(e.y)) {
      problems.push('Equipment item ' + (i + 1) + ' needs id, name, x and y.');
      return;
    }
    const ex = e.x, ey = e.y;
    let zid = e.zone ? zoneIds.get(String(e.zone)) : undefined;
    if (!zid) {
      const fid = floorOf(e.floor);
      const hit = zones.find((zr) => zr.floor_id === fid && zoneRects(zr.id).some((r) => ex >= r.x && ex <= r.x + r.w && ey >= r.y && ey <= r.y + r.h));
      zid = hit ? hit.id : undefined;
    }
    if (!zid) { warnings.push('Equipment "' + str(e.name, 60) + '" is not in any zone and was skipped.'); return; }
    const row: EquipmentRow = {
      id: newId(), zone_id: zid, name: str(e.name, 60), type: inList(EQUIPMENT_TYPES, e.type) ? String(e.type) : 'space',
      x: e.x, y: e.y, muscles: (Array.isArray(e.muscles) ? e.muscles : []).filter((m) => inList(MUSCLES, m)).map(String), notes: str(e.notes, 500)
    };
    equipIds.set(String(e.id), row.id);
    equipment.push(row);
  });
  if (problems.length) throw new ImportError(problems);

  /* structs; shared stairs and lift appear on every floor, so identical shared copies collapse to one */
  const structs: StructRow[] = [];
  const seenShared = new Set<string>();
  (Array.isArray(input.structs) ? input.structs : []).forEach((s) => {
    if (!isObj(s) || !inList(STRUCT_TYPES, s.type)) return;
    const type = String(s.type);
    const x = numOr(s.x, 100), y = numOr(s.y, 100);
    const shared = VERTICAL_TYPES.indexOf(type) >= 0 && s.shared !== false;
    const row: StructRow = {
      id: newId(), floor_id: floorOf(s.floor), type, x, y, w: null, h: null, x2: null, y2: null, rotation: 0, label: str(s.label, 40), shared
    };
    if (BOX_TYPES.indexOf(type) >= 0) { row.w = Math.max(16, numOr(s.w, 60)); row.h = Math.max(16, numOr(s.h, 40)); }
    else if (SYMBOL_TYPES.indexOf(type) >= 0) { row.w = Math.max(8, numOr(s.w, 36)); row.rotation = [0, 90, 180, 270].indexOf(Number(s.rot)) >= 0 ? Number(s.rot) : 0; }
    else { row.x2 = numOr(s.x2, x + 140); row.y2 = numOr(s.y2, y); }
    if (shared) {
      const key = [type, x, y, row.w, row.h].join(',');
      if (seenShared.has(key)) return;
      seenShared.add(key);
    }
    structs.push(row);
  });

  /* exercises and the exercise-to-machine links (either side of the file may carry them) */
  const exDefs = new Map<string, ExerciseDef>();
  (Array.isArray(input.exercises) ? input.exercises : []).forEach((x) => {
    if (!isObj(x) || !x.id || !x.name) return;
    const rest = Number(x.rest);
    exDefs.set(String(x.id), {
      legacyId: String(x.id), name: str(x.name, 80),
      muscles: (Array.isArray(x.muscles) ? x.muscles : []).filter((m) => inList(MUSCLES, m)).map(String),
      level: inList(LEVELS, x.level) ? String(x.level) : 'B',
      sets: Math.max(1, Math.round(numOr(x.sets, 3))), reps: x.reps == null || x.reps === '' ? '10' : String(x.reps),
      rest: Number.isFinite(rest) ? Math.max(0, rest) : 60, cue: str(x.cue, 300)
    });
  });
  const linkKeys = new Set<string>();
  const links: LinkDef[] = [];
  const addLink = (xid: string, legacyEq: string) => {
    const eq = equipIds.get(legacyEq);
    if (!eq || !exDefs.has(xid)) return;
    const k = xid + '|' + eq;
    if (linkKeys.has(k)) return;
    linkKeys.add(k);
    links.push({ exerciseLegacyId: xid, equipmentId: eq });
  };
  (Array.isArray(input.exercises) ? input.exercises : []).forEach((x) => {
    if (isObj(x) && Array.isArray(x.equipmentIds)) x.equipmentIds.forEach((eid) => addLink(String(x.id), String(eid)));
  });
  input.equipment.forEach((e) => {
    if (isObj(e) && Array.isArray(e.exerciseIds)) e.exerciseIds.forEach((xid) => addLink(String(xid), String(e.id)));
  });

  /* templates (the prototype's own templates use eid/xid; the session block uses equipmentId/exerciseId) */
  const templates: TemplateRow[] = [];
  const templateItems: TemplateItemRow[] = [];
  const usedExercises = new Set<string>();
  const addTemplate = (title: string, notes: string, items: unknown[]) => {
    const id = newId();
    let dropped = 0;
    const rows: TemplateItemRow[] = [];
    items.forEach((it) => {
      if (!isObj(it)) return;
      const eid = equipIds.get(String(it.eid ?? it.equipmentId ?? ''));
      if (!eid) { dropped += 1; return; }
      const xidRaw = it.xid ?? it.exerciseId;
      const xid = xidRaw && exDefs.has(String(xidRaw)) ? String(xidRaw) : null;
      if (xid) usedExercises.add(xid);
      rows.push({
        id: newId(), template_id: id, position: rows.length, equipment_id: eid, exercise_legacy_id: xid,
        exercise_name: str(it.exercise, 80), sets: Math.max(1, Math.round(numOr(it.sets, 1))), reps: str(it.reps, 40),
        rest: Math.max(0, numOr(it.rest ?? it.restSeconds, 0)), note: str(it.note, 300)
      });
    });
    if (dropped) warnings.push('Template "' + title + '": ' + dropped + ' exercise(s) used machines that are not in this gym and were left out.');
    if (!rows.length) { warnings.push('Template "' + title + '" has no usable exercises and was skipped.'); return; }
    templates.push({ id, trainer_id: opts.trainerId, gym_id: gym.id, name: title || 'Template', notes });
    rows.forEach((r) => templateItems.push(r));
  };
  (Array.isArray(input.templates) ? input.templates : []).forEach((t) => {
    if (isObj(t) && Array.isArray(t.items)) addTemplate(str(t.name, 80) || 'Template', str(t.notes, 1000), t.items);
  });
  if (opts.includeSession && isObj(input.session) && Array.isArray(input.session.items) && input.session.items.length) {
    addTemplate(str(input.session.title, 80) || 'Imported session', str(input.session.notes, 1000), input.session.items);
  }

  /* only bring in exercises that matter for this gym unless asked for all */
  const wanted = new Set<string>(usedExercises);
  links.forEach((l) => wanted.add(l.exerciseLegacyId));
  const exercises = Array.from(exDefs.values()).filter((x) => opts.allExercises || wanted.has(x.legacyId));

  return { plan: { gym, floors, zones, zoneParts, structs, equipment, exercises, links, templates, templateItems }, warnings };
}

/* ---------- writing a plan ---------- */

export interface ImportSink {
  insert(table: string, rows: object[]): Promise<void>;
  /** Existing exercises visible to this trainer (built-in and their own): lower-cased name to id. */
  findExerciseIdsByName(trainerId: string): Promise<Record<string, string>>;
  /** Creates trainer-owned exercises; returns the new ids in the same order as the definitions. */
  createExercises(trainerId: string, defs: ExerciseDef[]): Promise<string[]>;
  deleteWhere(table: string, column: string, value: string): Promise<void>;
}

export interface ImportSummary {
  gymId: string; floors: number; zones: number; zoneParts: number; structs: number; equipment: number;
  exercisesMatched: number; exercisesCreated: number; links: number; templates: number; templateItems: number;
}

export async function runImport(plan: ImportPlan, sink: ImportSink): Promise<ImportSummary> {
  const created: string[] = [];
  const put = (table: string, rows: object[]): Promise<void> => (rows.length ? sink.insert(table, rows) : Promise.resolve());
  try {
    const existing = await sink.findExerciseIdsByName(plan.gym.trainer_id);
    const dbId = new Map<string, string>();
    const missing: ExerciseDef[] = [];
    plan.exercises.forEach((x) => {
      const hit = existing[x.name.toLowerCase()];
      if (hit) dbId.set(x.legacyId, hit); else missing.push(x);
    });
    if (missing.length) {
      const ids = await sink.createExercises(plan.gym.trainer_id, missing);
      ids.forEach((id, i) => { dbId.set(missing[i].legacyId, id); created.push(id); });
    }
    await put('gyms', [plan.gym]);
    await put('floors', plan.floors);
    await put('zones', plan.zones);
    await put('zone_parts', plan.zoneParts);
    await put('structs', plan.structs);
    await put('equipment', plan.equipment);
    const linkRows = plan.links.filter((l) => dbId.has(l.exerciseLegacyId)).map((l) => ({ exercise_id: dbId.get(l.exerciseLegacyId), equipment_id: l.equipmentId }));
    await put('exercise_equipment', linkRows);
    await put('templates', plan.templates);
    await put('template_items', plan.templateItems.map((t) => {
      const { exercise_legacy_id, ...rest } = t;
      return { ...rest, exercise_id: exercise_legacy_id ? dbId.get(exercise_legacy_id) || null : null };
    }));
    return {
      gymId: plan.gym.id, floors: plan.floors.length, zones: plan.zones.length, zoneParts: plan.zoneParts.length, structs: plan.structs.length,
      equipment: plan.equipment.length, exercisesMatched: plan.exercises.length - missing.length, exercisesCreated: missing.length,
      links: linkRows.length, templates: plan.templates.length, templateItems: plan.templateItems.length
    };
  } catch (err) {
    /* undo: deleting the gym cascades to floors, zones, equipment, templates; then remove exercises we created */
    try {
      await sink.deleteWhere('gyms', 'id', plan.gym.id);
      for (const id of created) await sink.deleteWhere('exercises', 'id', id);
    } catch (undoErr) {
      throw new Error('Import failed and the clean-up also failed. Remove gym ' + plan.gym.id + ' by hand. First error: ' + (err as Error).message);
    }
    throw err;
  }
}
