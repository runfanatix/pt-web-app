/**
 * Load the built-in exercise library (trainer_id null) from a prototype export. Safe to re-run: names that
 * already exist in the built-in library are skipped.
 *
 *   npx tsx scripts/seed-library.ts --file exports/bedfordview-v11.json --dry-run
 *   npx tsx scripts/seed-library.ts --file exports/bedfordview-v11.json
 *
 * A real run needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS: keep it off the browser).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { planBuiltInLibrary } from '../packages/core/src/seed-library.ts';

const { values } = parseArgs({
  options: { file: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
if (!values.file) {
  console.error('Usage: seed-library.ts --file <json> [--dry-run]');
  process.exit(2);
}

const { rows, warnings } = planBuiltInLibrary(JSON.parse(readFileSync(values.file, 'utf8')));
warnings.forEach((w) => console.warn('warning: ' + w));
console.log(`${rows.length} built-in exercises ready.`);
if (values['dry-run']) {
  console.log('Dry run: nothing was written.');
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: existing, error: readError } = await sb.from('exercises').select('name').is('trainer_id', null);
if (readError) throw new Error('exercises: ' + readError.message);
const have = new Set((existing ?? []).map((r: { name: string }) => r.name.toLowerCase()));
const fresh = rows.filter((r) => !have.has(r.name.toLowerCase()));
for (let i = 0; i < fresh.length; i += 500) {
  const { error } = await sb.from('exercises').insert(fresh.slice(i, i + 500));
  if (error) throw new Error('exercises: ' + error.message);
}
console.log(`Inserted ${fresh.length}, skipped ${rows.length - fresh.length} already present.`);
