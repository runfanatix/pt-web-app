# 02 Data model

The prototype stores JSON documents in a per-artifact database. The real app should use relational tables with
`trainer_id` ownership and row-level security. Field names below are the prototype's; keep them in TypeScript types
and map to snake_case columns.

## Entities

```ts
type Category = 'cardio'|'strength'|'functional'|'studio'|'water'|'amenity'|'outdoor';
type EquipType = 'cardio'|'machine'|'free'|'rig'|'space';
type Muscle = 'chest'|'back'|'shoulders'|'arms'|'core'|'legs'|'glutes'|'cardio'|'full body'|'mobility';
type Level = 'B'|'I'|'A';

interface Gym      { id; name; branch; address; phone; notes; updated /*ms*/;
                     layout: Layout; links: Record<exerciseId, equipmentId[]> }   // saved copy
interface Layout   { floors: Floor[]; zones: Zone[]; structs: Struct[]; equipment: Equipment[] }
interface Floor    { id; name; w; h }                                  // w 600-2400, h 400-1800
interface Zone     { id; name; cat: Category; x; y; w; h; floor; parts?: Rect[] }   // parts: up to 11 extra rects
interface Rect     { x; y; w; h }
interface Struct   { id; type: 'stairs'|'lift'|'door'|'revolving'|'dglass'|'column'|'toilets'|'wall'|'balustrade'|'glass';
                     floor; x; y; w?; h?; x2?; y2?; rot; label; shared? /* stairs, lift appear on all floors */ }
interface Equipment{ id; name; zone; type: EquipType; x; y; muscles: Muscle[]; notes; floor }
interface Exercise { id; name; muscles: Muscle[]; equipmentIds: string[]; level: Level;
                     sets; reps: string; rest /*s*/; cue }
interface SessionItem { uid; eid /*equipment*/; xid /*exercise or null*/; exercise; sets; reps; rest; note }
interface Template { id; name; notes; created; items: ItemSnap[]; gymId }
interface Client   { id; name; whatsapp; email; emName; emPhone; emRel; plan;
                     subStatus: 'active'|'trial'|'paused'|'expired'; perWeek; left; renewal; goals; notes;
                     programmes: Programme[]; created }
interface Programme{ id; title; notes; assignedAt; items: ItemSnap[]; gymId }
interface ItemSnap { eid; xid|null; exercise; sets; reps; rest; note }
interface RunLog   { id; clientId; clientName; coach; title; date; startedAt; totalMs; plannedMin; doneN;
                     steps: Step[]; gymId; gymName }
interface Step     { n; eid; machine; zone; exercise; sets; reps; rest; ms; done; order }
```

## Rules to keep (validation, from the prototype's `norm*` functions)

- Zone minimum size 60 x 50; part minimum 16 x 16; at most 12 rectangles per zone.
- Equipment belongs to a zone; its floor is the zone's floor; its position is clamped inside one of the zone's
  rectangles (inset 14 px sides and bottom, 22 px top).
- Struct `shared` stairs and lift appear at the same x,y on every floor; edit once, all floors follow.
- A gym can have zero zones (blank plan) but needs at least one floor.
- Exercise-to-machine links are stored per gym (equipment ids differ between gyms). Copying a gym keeps ids so
  existing sessions keep working; switching gyms remaps session items by id, then by machine name and type, then by
  exercise link.
- Unsaved-change detection compares a canonical form of layout plus links (ids, names, positions rounded to whole
  pixels, sorted link lists) with the gym's saved canonical form.
- Equipment ids: defaults like `tread`, custom ones `custom-<time36>-<n><rand>`; zone ids `z-...`; gym ids `g-...`.

## Zone geometry (port these algorithms)

- Touching test for two rectangles: shared span on one axis at least 16 px and gap on the other axis at most 12 px
  (overlap allowed).
- Join: grow the other zone's rectangles toward this one to close small gaps, append them as parts, move equipment,
  delete the other zone.
- Outline of a union of rectangles: coordinate-compress all x and y edges, mark covered cells, collect boundary
  edges, chain into closed loops, drop collinear points, draw as one even-odd SVG path. PDF draws each rectangle
  filled, then the boundary segments as lines.
- Moving a zone moves its bounding box (clamped to the floor) and every part and machine by the same offset.

## Persistence in the prototype (for reference only)

Documents: `planner/layout` (working draft), `planner/library`, `planner/session`, `planner/gyms` (index with
`activeId`), `planner/gym-<id>` (saved layout and links), `clients/<id>`, `templates/<id>`, `history/<id>`.

## Client link format (prototype)

`#p<flag><base62(deflate-raw(JSON))>` where the JSON snapshot holds: title, notes, coach, date, items, an optional
layout `L` (floors `f`, zones `z` rows `[id, floor, name, cat, x, y, w, h, parts?]`, structs `s` rows) only when the
layout is not the built-in one, and gym name `G`. This exists only because the prototype has no server.
**In the real app replace it with a share token**: a row in `share_links(token, programme_id, expires_at)` and a
public page `/p/:token` that reads the programme and gym layout server-side, revocable by the trainer.

## Suggested relational schema (Postgres)

```
trainers(id, user_id, display_name, ...)
gyms(id, trainer_id, name, branch, address, phone, notes, updated_at)
floors(id, gym_id, name, w, h, position)
zones(id, floor_id, name, category, x, y, w, h)            -- primary rectangle
zone_parts(id, zone_id, x, y, w, h, position)              -- extra rectangles of a joined zone
structs(id, floor_id, type, x, y, w, h, x2, y2, rotation, label, shared)
equipment(id, zone_id, name, type, x, y, muscles text[], notes, catalogue_item_id null)
manufacturers(id, trainer_id null = shared, name)
catalogue_items(id, trainer_id null = shared, manufacturer_id, model_name, code, kind, muscles text[], specs jsonb [{label, value}], notes)
exercises(id, trainer_id null /* null = built-in */, name, muscles text[], level, sets, reps, rest, cue)
exercise_equipment(exercise_id, equipment_id)               -- links, per gym via equipment
clients(id, trainer_id, name, whatsapp, email, emergency_*, plan, sub_status, per_week, sessions_left, renewal,
        goals, private_notes)
programmes(id, client_id, gym_id, title, notes, assigned_at)
programme_items(id, programme_id, position, equipment_id, exercise_id, exercise_name, sets, reps, rest, note)
templates(id, trainer_id, gym_id, name, notes) + template_items(...)
runs(id, trainer_id, client_id, gym_id, title, date, started_at, total_ms, planned_min, coach)
run_steps(id, run_id, n, equipment_id, exercise_name, sets, reps, rest, ms, done, order)
share_links(token, programme_id, created_at, expires_at, revoked_at)
```

Row-level security: trainer owns everything under `trainer_id`; a client account (later) may read only its own
programmes and the gym layout needed to draw them. Keep denormalised names on runs and programme items so
history stays readable after equipment is deleted.
