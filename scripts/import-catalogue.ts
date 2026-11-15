/**
 * Load manufacturers and equipment models into the catalogue from a JSON file. Safe to re-run: a manufacturer that
 * already exists (same name) is reused, and a model whose item code (or, with no code, model name) already exists
 * for that manufacturer is skipped.
 *
 *   npx tsx scripts/import-catalogue.ts --file exports/catalogue-template.json --trainer <trainer-id> --dry-run
 *   npx tsx scripts/import-catalogue.ts --file my-catalogue.json --trainer <trainer-id>
 *   npx tsx scripts/import-catalogue.ts --file my-catalogue.json --shared      (everyone can read it, nobody can edit it)
 *
 * File shape: { "manufacturers": [ { "name": "...", "items": [ { "model": "...", "code": "...", "kind": "machine",
 * "muscles": ["chest"], "specs": [ { "label": "Weight stack", "value": "100 kg" } ], "notes": "" } ] } ] }
 *
 * A real run needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS: keep it off the browser).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { planCatalogueImport } from '../packages/core/src/catalogue.ts';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    trainer: { type: 'string' },
    shared: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.file || (!values.trainer && !values.shared)) {
  console.error('Usage: import-catalogue.ts --file <json> (--trainer <id> | --shared) [--dry-run]');
  process.exit(2);
}

const plan = planCatalogueImport(JSON.parse(readFileSync(values.file, 'utf8')));
plan.warnings.forEach((w) => console.warn('warning: ' + w));
console.log(`${plan.manufacturers.length} manufacturer(s) and ${plan.items.length} model(s) ready.`);
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
const owner: string | null = values.shared ? null : (values.trainer ?? null);

const scope = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T) =>
  owner ? q.eq('trainer_id', owner) : q.is('trainer_id', null);

const { data: existingMakers, error: e1 } = await scope(sb.from('manufacturers').select('id, name'));
if (e1) throw new Error('manufacturers: ' + e1.message);
const makerId = new Map(
  (existingMakers ?? []).map((m: { id: string; name: string }) => [m.name.toLowerCase(), m.id]),
);
let newMakers = 0;
for (const name of plan.manufacturers) {
  if (makerId.has(name.toLowerCase())) continue;
  const { data, error } = await sb
    .from('manufacturers')
    .insert({ trainer_id: owner, name })
    .select('id')
    .single();
  if (error) throw new Error(`manufacturer ${name}: ${error.message}`);
  makerId.set(name.toLowerCase(), (data as { id: string }).id);
  newMakers += 1;
}

const { data: existingItems, error: e2 } = await scope(
  sb.from('catalogue_items').select('manufacturer_id, model_name, code'),
);
if (e2) throw new Error('catalogue_items: ' + e2.message);
const have = new Set(
  (existingItems ?? []).map(
    (i: { manufacturer_id: string; model_name: string; code: string }) =>
      `${i.manufacturer_id}|${i.code ? 'c:' + i.code.toLowerCase() : 'm:' + i.model_name.toLowerCase()}`,
  ),
);
const fresh = plan.items.flatMap((i) => {
  const mid = makerId.get(i.manufacturer.toLowerCase())!;
  const k = `${mid}|${i.code ? 'c:' + i.code.toLowerCase() : 'm:' + i.model.toLowerCase()}`;
  if (have.has(k)) return [];
  have.add(k);
  return [
    {
      trainer_id: owner,
      manufacturer_id: mid,
      model_name: i.model,
      code: i.code,
      kind: i.kind,
      muscles: i.muscles,
      specs: i.specs,
      notes: i.notes,
    },
  ];
});
for (let n = 0; n < fresh.length; n += 500) {
  const { error } = await sb.from('catalogue_items').insert(fresh.slice(n, n + 500));
  if (error) throw new Error('catalogue_items: ' + error.message);
}
console.log(
  `Added ${newMakers} manufacturer(s) and ${fresh.length} model(s); skipped ${plan.items.length - fresh.length} already present.`,
);
