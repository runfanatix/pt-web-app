# 03 Build plan

## Recommended stack (change only if the owner prefers otherwise)

- **Language**: TypeScript, strict.
- **Front end**: React with Vite (single-page app) or Next.js if public client pages and SEO matter early.
  Use Tailwind or CSS modules; keep the prototype's colour tokens, light and dark themes.
- **Floor plan**: a React SVG component (no canvas library needed). Pointer events with pointer capture for drag,
  as the prototype does. Pure geometry functions in `packages/core` so they are unit-testable.
- **Back end and data**: Supabase (Postgres, Auth, Row Level Security, Storage for equipment images). Alternative:
  any Postgres plus an auth provider. Schema in `docs/02-data-model.md`.
- **Validation**: Zod schemas shared by client and server; the prototype's `norm*` functions are the rules.
- **PDF**: jsPDF or `@react-pdf/renderer`; the prototype layout is: header, gym line, meta row, exercise table,
  one route map per floor.
- **Phone use**: make it a PWA (installable, cached shell). Keep screen awake during a run.
- **Tests**: Vitest for logic, Playwright for screens. CI on every push.
- **Hosting**: Vercel or Netlify for the app; Supabase for data. Environment variables only.

## Repository layout

```
pt-planner/
  CLAUDE.md
  docs/
  prototype/                 # frozen reference, never edited
  apps/web/                  # React app
  packages/core/             # pure TS: geometry, remap, route order, snapshot, schemas
  supabase/migrations/       # SQL
  e2e/                       # Playwright
```

## Phases (build in this order; each ends with tests passing and a short demo)

**Phase 0: scaffold.** Repo, tooling (pnpm, ESLint, Prettier, Vitest, Playwright, CI), theme tokens, empty app
shell with tabs and the gym bar. Copy the prototype and docs in. *Done when*: app runs, CI green, shell matches the
prototype's layout at 390 px and 1280 px.

**Phase 1: domain and data.** Types and Zod schemas in `packages/core`; SQL migrations; Supabase auth (trainer sign
up and login); row-level security; seed script that loads the Virgin Active Bedfordview gym, the exercise library
and example workouts from the prototype (`LIB_SRC`, `DEFAULT_ZONES`, `DEFAULT_EQ`, `DEFAULT_STRUCTS`).
The import script in `docs/05-import-script.md` is already written and tested; wire it into the repo (add the
Supabase client, `ON DELETE CASCADE` foreign keys, an `exports/` folder) and use it to load the Bedfordview gym instead of
hand-writing the gym part of the seed.
*Done when*: a logged-in trainer reads their gym from the database; another trainer cannot see it (RLS test); running the
importer on `exports/bedfordview-v11.json` creates the gym and `--dry-run` reports 14 zones and 41 machines.

**Phase 2: read-only floor plan.** Render floors, zones, joined-zone outlines, equipment markers, structs
(including shared stairs and lift), floor tabs, muscle filter. Port `zoneLoops`. *Done when*: the Bedfordview plan
looks like the prototype on both floors; unit tests for outline geometry.

**Phase 3: session builder.** Tap a machine, add linked exercises, edit sets/reps/rest/note, reorder, route lines
and numbering per floor, save and load templates. *Done when*: the prototype's session scenarios pass.

**Phase 4: run mode and history.** Timers, rest countdown, wake lock, finish and save, history list. *Done when*:
run scenarios pass; history survives reload.

**Phase 5: clients, programmes, sharing.** Client CRUD with private notes, assign programmes, PDF, WhatsApp and
email links, **share tokens** and the public client page (no private data). *Done when*: a link opens logged out,
shows only the programme, and the trainer can revoke it.

**Phase 6: layout editor.** Zones (resize grips, numeric fields, floor move, duplicate), equipment drag and
re-parenting, architectural key with line end grips and scale, floors with canvas size, join and split zones.
This is the largest phase; split it into sub-PRs: (a) zones and equipment, (b) structs, (c) floors, (d) join,
split, duplicate. *Done when*: the prototype's layout scenarios pass.

**Phase 7: multi-gym.** Gyms tab, gym bar, save and discard layout, switching with remap and confirmation, copy
and blank starts, per-gym exercise links. *Done when*: the gym scenarios pass (see `prototype/tests/v11*.js`).

**Phase 8: equipment catalogue.** Technogym and Eleiko catalogue by category, unique item codes, images in Storage,
gym walkthrough mode to place catalogue items on the plan (`equipment.catalogue_item_id`). The owner will supply
the catalogue content; build the structure and import first.

**Phase 9: client portal and platform modules.** Client accounts and their own programme view; then connect to the
wider platform (bookings, diet plans, invoicing, payments) as separate modules.

## Per-phase working method for Claude Code

1. Read `CLAUDE.md`, the relevant spec section, and open the prototype to the matching screen.
2. Write a short plan and wait for the owner's go-ahead on anything marked open.
3. Build, add tests, run lint, type-check and tests.
4. Compare with the prototype side by side at 390 px and 1280 px, light and dark.
5. Commit with a message naming the feature; summarise what changed and what is next.

## Known gaps in the prototype to fix in the real build

- History PDFs for a run done at a different gym draw their route map on the currently open gym.
- Exercise-to-machine links are per gym; a new blank gym starts with no links (needs a friendlier way to link).
- Edit mode is awkward on phones; design a proper touch editor or keep it tablet and laptop only.
- Client link encoding is a workaround; replace it with share tokens.
- No real authentication: the prototype relies on the host's sharing. Real accounts are Phase 1.
