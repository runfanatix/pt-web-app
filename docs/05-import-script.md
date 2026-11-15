# 05 Importing prototype data

A small, tested importer that moves a gym out of the prototype and into the real database. It is part of the real
build (Phase 1), so the trainer's Bedfordview layout does not have to be redrawn.

Files:

- `packages/core/src/import-prototype.ts`: the logic. `planPrototypeImport()` is pure (validate, then turn the JSON
  into rows with fresh UUIDs). `runImport()` writes the rows through an `ImportSink` and undoes everything if a step fails.
- `packages/core/src/import-prototype.test.ts`: Vitest tests (14 cases, no database needed).
- `scripts/import-prototype.ts`: the command line wrapper with the Supabase sink.
- `exports/bedfordview-v11.json`: a real export from the v11 prototype, handy for a first dry run.

## Getting the JSON out of the prototype

1. Open the prototype and choose the gym you want (Gyms tab, **Open**).
2. Data tab, **Copy JSON**, paste into a file such as `exports/my-gym.json`.

One file is one gym. For several gyms, repeat per gym and run the importer once per file.

## Running it

```
npx tsx scripts/import-prototype.ts --file exports/bedfordview-v11.json --trainer <trainers.id> --dry-run
npx tsx scripts/import-prototype.ts --file exports/bedfordview-v11.json --trainer <trainers.id>
```

| Option | Meaning |
| --- | --- |
| `--file` | JSON from the prototype (required) |
| `--trainer` | `trainers.id` that will own the gym (required) |
| `--gym-name` | replaces the gym name in the file (and clears the branch) |
| `--include-session` | also imports the routine that was on screen as a template |
| `--all-exercises` | imports every exercise in the file, not only those linked to machines or used by templates |
| `--dry-run` | validates and prints counts; writes nothing, needs no keys |

A real run needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment (put them in `.env.local`, which is
git-ignored, and load with your shell or `dotenv`). The service-role key bypasses row-level security, so use it only
on your own machine or in a trusted job, never in browser code. Always do a `--dry-run` first. Dry run on the v11
export prints: 2 floors, 14 zones, 3 structures, 41 machines, 111 exercises, 139 links, 1 template.

The script uses `.ts` import paths. Node 22.6+ can run it with `--experimental-strip-types`; `tsx` works too. In
`tsconfig.json` set `"allowImportingTsExtensions": true` with `"noEmit": true` (or the bundler resolution your repo uses).

## What it does

- Creates one gym with its floors, zones, extra rectangles of joined zones, structures and machines. Floor sizes and
  minimum zone sizes are clamped to the prototype's limits (600 x 400 to 2400 x 1800; zone 60 x 50; part 16 x 16).
- Machines keep their zone. If the zone id is missing, the zone whose rectangle contains the marker is used; if there
  is none, the machine is skipped and reported.
- Shared stairs and lift (one copy per floor in older data) collapse to one row with `shared = true`.
- Exercises: names are matched, case-insensitively, against the built-in library and the trainer's own exercises. A match
  is reused; anything else is created as a trainer-owned exercise. Links (`exercise_equipment`) come from both
  `exercises[].equipmentIds` and `equipment[].exerciseIds`, de-duplicated.
- Templates come across with their items. Items that point at a machine that is not in the file are dropped and
  reported; a template with nothing left is skipped.
- Every id is new; the prototype ids are only used to join rows inside the file.

## What it does not do

- Clients, programmes and run history are not in the prototype's Data export (they hold personal details), so they
  are not imported. If you want them, add a "Full backup" export to the prototype first, then extend this importer
  with `clients`, `programmes` and `runs`.
- It never updates or merges into an existing gym. Importing the same file twice creates two gyms. Delete the old
  one first if you want to redo it.

## Failure and undo

Rows go in this order: exercises (new ones), gym, floors, zones, zone_parts, structs, equipment, exercise_equipment,
templates, template_items. If any step fails the importer deletes the gym and the exercises it created, then rethrows
the error. This needs foreign keys with `ON DELETE CASCADE` from floors, zones, zone_parts, structs, equipment,
exercise_equipment, templates and template_items. Put that in the Phase 1 migrations. If the clean-up itself fails,
the message names the gym id to remove by hand.

## Tests

```
npx vitest run packages/core/src/import-prototype.test.ts
```

Covers mapping and counts, joined zones, clamping, shared structs, zone lookup by position, link de-duplication,
template filtering, both item key styles, the session option, name override, files without floors, bad rows, name
matching of exercises and the rollback path (with an in-memory sink).
