/**
 * The exercise library: checking an exercise before it is saved, searching and filtering the list, and adding many
 * exercises at once from pasted lines. Pure. A port of the prototype's libFiltered, saveDraft and importExercises.
 */
import { MUSCLES } from './import-prototype.ts';
import { LEVEL_NAMES, type LibraryExercise } from './session.ts';

export const LEVELS = ['B', 'I', 'A'] as const;
export type Level = (typeof LEVELS)[number];

export interface ExerciseInput {
  name: string;
  level: Level;
  sets: number;
  reps: string;
  rest: number;
  cue: string;
  /** An optional link to a demo video or page: http or https. */
  link: string;
  muscles: string[];
}

export const blankExercise = (muscles: string[] = []): ExerciseInput => ({
  name: '',
  level: 'B',
  sets: 3,
  reps: '10',
  rest: 60,
  cue: '',
  link: '',
  muscles,
});

/** A typed link made safe: "youtube.com/x" becomes "https://youtube.com/x"; anything but http(s) is refused (null). */
export function normaliseLink(raw: string): string | null {
  let t = raw.trim();
  if (!t) return '';
  // anything that starts with a scheme other than http or https (javascript:, data:, ftp:...) is refused
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t) && !/^https?:\/\//i.test(t)) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 300 ? t : null;
}

/** The problems with an exercise form, in plain words (empty when it is fine). */
export function exerciseProblems(x: ExerciseInput): string[] {
  const out: string[] = [];
  if (!x.name.trim()) out.push('Give the exercise a name.');
  else if (x.name.trim().length > 80) out.push('The name can be at most 80 characters.');
  if (!(Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 99))
    out.push('Sets must be a whole number from 1 to 99.');
  if (!(x.rest >= 0 && x.rest <= 3600)) out.push('Rest must be between 0 and 3600 seconds.');
  if (x.reps.trim().length > 40) out.push('Reps or time can be at most 40 characters.');
  if (x.cue.length > 1000) out.push('The coaching cue can be at most 1000 characters.');
  if (normaliseLink(x.link) === null) out.push('The demo link must start with http:// or https://.');
  return out;
}

/** The input tidied up the way it is saved. */
export function tidyExercise(x: ExerciseInput): ExerciseInput {
  return {
    name: x.name.trim(),
    level: LEVELS.includes(x.level) ? x.level : 'B',
    sets: Math.max(1, Math.round(x.sets) || 1),
    reps: x.reps.trim() || '10',
    rest: Math.max(0, Math.round(x.rest) || 0),
    cue: x.cue.trim(),
    link: normaliseLink(x.link) ?? '',
    muscles: x.muscles.filter((m) => (MUSCLES as readonly string[]).includes(m)),
  };
}

export const exerciseToInput = (x: LibraryExercise): ExerciseInput => ({
  name: x.name,
  level: (LEVELS as readonly string[]).includes(x.level) ? (x.level as Level) : 'B',
  sets: x.sets,
  reps: x.reps,
  rest: x.rest,
  cue: x.cue,
  link: x.link ?? '',
  muscles: [...x.muscles],
});

export interface LibraryFilter {
  query: string;
  /** 'all' or a muscle. */
  muscle: string;
  /** 'all', 'none' (not linked to any machine here) or a machine id. */
  equipment: string;
}
export const noFilter = (): LibraryFilter => ({ query: '', muscle: 'all', equipment: 'all' });

const byName = (a: LibraryExercise, b: LibraryExercise) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** The exercises matching a search (name or muscles), a muscle, and a machine, by name. */
export function filterLibrary(lib: LibraryExercise[], f: LibraryFilter): LibraryExercise[] {
  const q = f.query.trim().toLowerCase();
  return lib
    .filter((x) => {
      if (q && !x.name.toLowerCase().includes(q) && !x.muscles.join(' ').includes(q)) return false;
      if (f.muscle !== 'all' && !x.muscles.includes(f.muscle)) return false;
      if (f.equipment === 'none') return x.equipmentIds.length === 0;
      if (f.equipment !== 'all' && !x.equipmentIds.includes(f.equipment)) return false;
      return true;
    })
    .sort(byName);
}

/** Machines to add or take away so an exercise's links at this gym become `wanted`. */
export function linkChanges(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  return {
    add: wanted.filter((id) => !current.includes(id)),
    remove: current.filter((id) => !wanted.includes(id)),
  };
}

/* ---------------------------------------------------------------- adding many at once */

export interface BulkPlan {
  /** New exercises to create, with the machines to link. */
  adds: { input: ExerciseInput; equipmentIds: string[] }[];
  /** Existing exercises to extend: machines and muscles are added, a cue is set only if there was none. */
  merges: { id: string; addEquipment: string[]; addMuscles: string[]; cue: string }[];
  skipped: number;
  /** Machine names that matched nothing. */
  missing: string[];
  message: string;
}

/**
 * Plans an import of lines: name | muscles | machines | level | sets | reps | rest (s) | cue. A line for an exercise
 * that already exists (same name, any case) adds to it instead of making a copy. Nothing is saved here.
 */
export function planBulkImport(
  text: string,
  library: LibraryExercise[],
  machines: { id: string; name: string }[],
): BulkPlan {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const byLowerName = new Map(library.map((x) => [x.name.toLowerCase(), x]));
  const findMachine = (tok: string) => {
    const t = tok.trim().toLowerCase();
    return machines.find((m) => m.id.toLowerCase() === t || m.name.toLowerCase() === t);
  };
  const plan: BulkPlan = { adds: [], merges: [], skipped: 0, missing: [], message: '' };
  const missing = new Set<string>();
  const seenNew = new Map<string, number>();
  for (const line of lines) {
    const p = line.split('|').map((s) => s.trim());
    if (!p[0]) {
      plan.skipped += 1;
      continue;
    }
    const muscles = (p[1] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((m) => (MUSCLES as readonly string[]).includes(m));
    const eqs: string[] = [];
    for (const tok of (p[2] ?? '').split(',')) {
      if (!tok.trim()) continue;
      const m = findMachine(tok);
      if (m) {
        if (!eqs.includes(m.id)) eqs.push(m.id);
      } else missing.add(tok.trim());
    }
    const lv = ((p[3] ?? 'B').charAt(0).toUpperCase() || 'B') as Level;
    const level: Level = LEVELS.includes(lv) ? lv : 'B';
    const sets = Math.round(Number(p[4]));
    const rest = Number(p[6]);
    const input: ExerciseInput = {
      name: p[0].slice(0, 80),
      level,
      sets: sets >= 1 && sets <= 99 ? sets : 3,
      reps: (p[5] || '10').slice(0, 40),
      rest: p[6] !== undefined && p[6] !== '' && !Number.isNaN(rest) ? Math.min(3600, Math.max(0, rest)) : 60,
      cue: (p[7] ?? '').slice(0, 1000),
      link: '',
      muscles,
    };
    const key = input.name.toLowerCase();
    const existing = byLowerName.get(key);
    if (existing) {
      plan.merges.push({
        id: existing.id,
        addEquipment: eqs.filter((q) => !existing.equipmentIds.includes(q)),
        addMuscles: muscles.filter((m) => !existing.muscles.includes(m)),
        cue: existing.cue ? '' : input.cue,
      });
    } else if (seenNew.has(key)) {
      const a = plan.adds[seenNew.get(key)!]!;
      for (const q of eqs) if (!a.equipmentIds.includes(q)) a.equipmentIds.push(q);
      for (const m of muscles) if (!a.input.muscles.includes(m)) a.input.muscles.push(m);
    } else {
      seenNew.set(key, plan.adds.length);
      plan.adds.push({ input, equipmentIds: eqs });
    }
  }
  plan.missing = [...missing];
  plan.message = `Added ${plan.adds.length}, updated ${plan.merges.length}${plan.skipped ? `, skipped ${plan.skipped}` : ''}.${plan.missing.length ? ` Equipment not found: ${plan.missing.join(', ')}.` : ''}`;
  return plan;
}

/** The text a trainer can paste to see the format. */
export const BULK_EXAMPLE = 'Hack squat | legs, glutes | Leg press | I | 3 | 10 | 90 | Heels down, chest up';

export const levelName = (l: string): string => LEVEL_NAMES[l] ?? l;
