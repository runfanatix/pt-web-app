/**
 * Import a prototype export (Data tab, "Copy JSON") into Supabase.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/import-prototype.ts --file ./exports/bedfordview.json --trainer <trainer uuid> --dry-run
 *   npx tsx scripts/import-prototype.ts --file ./exports/bedfordview.json --trainer <trainer uuid>
 *
 * Options:
 *   --file <path>        JSON copied from the prototype (required)
 *   --trainer <uuid>     trainers.id that will own the gym (required)
 *   --gym-name <name>    override the gym name found in the file
 *   --include-session    also import the on-screen session as a template
 *   --all-exercises      import every exercise in the file, not only those linked to machines or templates
 *   --dry-run            validate and print what would be written; touches nothing
 *
 * Environment (real import only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * The service-role key bypasses row-level security. Keep it in .env.local, never commit it, and never ship it to
 * the browser. Requires foreign keys with ON DELETE CASCADE from floors, zones, zone_parts, structs, equipment,
 * exercise_equipment, templates and template_items so a failed import can be undone by deleting the gym.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ImportError, planPrototypeImport, runImport } from '../packages/core/src/import-prototype.ts';
import type { ExerciseDef, ImportSink } from '../packages/core/src/import-prototype.ts';

const CHUNK = 500;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      trainer: { type: 'string' },
      'gym-name': { type: 'string' },
      'include-session': { type: 'boolean', default: false },
      'all-exercises': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false }
    }
  });
  if (!values.file || !values.trainer) {
    console.error('Usage: import-prototype.ts --file <json> --trainer <uuid> [--gym-name X] [--include-session] [--all-exercises] [--dry-run]');
    process.exit(2);
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(values.file, 'utf8'));
  } catch (err) {
    console.error('Cannot read ' + values.file + ': ' + (err as Error).message);
    process.exit(1);
  }

  let result;
  try {
    result = planPrototypeImport(json, {
      trainerId: values.trainer,
      gymName: values['gym-name'],
      includeSession: values['include-session'],
      allExercises: values['all-exercises']
    });
  } catch (err) {
    if (err instanceof ImportError) { console.error(err.message); process.exit(1); }
    throw err;
  }
  const { plan, warnings } = result;

  warnings.forEach((w) => console.warn('warning: ' + w));
  console.log('Gym "' + plan.gym.name + (plan.gym.branch ? ' ' + plan.gym.branch : '') + '": ' +
    plan.floors.length + ' floors, ' + plan.zones.length + ' zones (' + plan.zoneParts.length + ' extra parts), ' +
    plan.structs.length + ' structures, ' + plan.equipment.length + ' machines, ' +
    plan.exercises.length + ' exercises, ' + plan.links.length + ' links, ' +
    plan.templates.length + ' templates (' + plan.templateItems.length + ' items).');
  if (values['dry-run']) { console.log('Dry run: nothing was written.'); return; }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2); }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const sink: ImportSink = {
    async insert(table, rows) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await sb.from(table).insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(table + ': ' + error.message);
      }
    },
    async findExerciseIdsByName(trainerId) {
      const out: Record<string, string> = {};
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('exercises').select('id,name,trainer_id').or('trainer_id.is.null,trainer_id.eq.' + trainerId).range(from, from + 999);
        if (error) throw new Error('exercises: ' + error.message);
        (data || []).forEach((r: { id: string; name: string }) => { out[r.name.toLowerCase()] = out[r.name.toLowerCase()] || r.id; });
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    async createExercises(trainerId, defs: ExerciseDef[]) {
      const rows = defs.map((d) => ({ trainer_id: trainerId, name: d.name, muscles: d.muscles, level: d.level, sets: d.sets, reps: d.reps, rest: d.rest, cue: d.cue }));
      const { data, error } = await sb.from('exercises').insert(rows).select('id');
      if (error || !data) throw new Error('exercises: ' + (error ? error.message : 'no rows returned'));
      return data.map((r: { id: string }) => r.id);
    },
    async deleteWhere(table, column, value) {
      const { error } = await sb.from(table).delete().eq(column, value);
      if (error) throw new Error(table + ': ' + error.message);
    }
  };

  const summary = await runImport(plan, sink);
  console.log('Imported. Gym id: ' + summary.gymId + '. Exercises matched by name: ' + summary.exercisesMatched +
    ', created: ' + summary.exercisesCreated + '. Links: ' + summary.links + '.');
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
