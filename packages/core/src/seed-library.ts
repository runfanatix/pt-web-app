/**
 * Built-in exercise library: turns the `exercises` list of a prototype export into rows for `exercises`
 * with trainer_id null (read-only to every trainer). Pure; no database access.
 */
import { ExerciseSchema } from './schemas.ts';

export interface LibraryRow {
  trainer_id: null;
  name: string;
  muscles: string[];
  level: string;
  sets: number;
  reps: string;
  rest: number;
  cue: string;
}

export function planBuiltInLibrary(input: unknown): { rows: LibraryRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const list = (input as { exercises?: unknown } | null)?.exercises;
  if (!Array.isArray(list)) return { rows: [], warnings: ['The file has no "exercises" list.'] };

  const seen = new Set<string>();
  const rows: LibraryRow[] = [];
  list.forEach((raw, i) => {
    const parsed = ExerciseSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(`Exercise ${i + 1} skipped: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return;
    }
    const x = parsed.data;
    const key = x.name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Duplicate exercise name "${x.name}" skipped.`);
      return;
    }
    seen.add(key);
    rows.push({
      trainer_id: null,
      name: x.name,
      muscles: x.muscles,
      level: x.level,
      sets: x.sets,
      reps: x.reps,
      rest: x.rest,
      cue: x.cue,
    });
  });
  return { rows, warnings };
}
