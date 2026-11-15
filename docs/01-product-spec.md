# 01 Product spec (from the v11 prototype)

Screens and behaviours, in the order a trainer meets them. Numbers (12 px, 60 px, and so on) are the prototype's
values; keep them unless the owner changes them.

## App shell

- Header: eyebrow shows `gym name + branch + address`; title is `<branch or name> Zone Planner`.
- **Gym bar** under the header: gym dropdown, address, layout status ("Layout saved" / "Unsaved layout changes"),
  Save layout, Discard changes (two-tap confirm), Save as new gym (edit mode only). Hidden in the client view.
- Mode switch: **Plan** (use the plan) and **Edit layout** (change the plan).
- Right-hand panel with tabs: **Layout** (zone/equipment/struct cards), **Session**, **Run**, **Clients**, **Gyms**,
  **Library**, **Data**.
- Floor tabs above the plan; muscle-focus chips filter which machines are highlighted.
- The plan is an SVG. Each floor has its own width and height.
- The "illustrative layout" notice shows only for the built-in Virgin Active Bedfordview gym.
- Destructive actions use a two-tap pattern ("Tap again to confirm", resets after 4 seconds). There are no
  browser `confirm()` dialogs.

## Plan mode

- Zones coloured by category: cardio, strength, functional, studio, water, amenity, outdoor (outdoor is dashed).
- Equipment markers show a letter by type: C cardio, M selectorised or cable machine, F free weights,
  R rig or functional kit, S open space. Each zone shows an item count.
- Tapping a machine opens a popup of exercises linked to it; adding one appends to the session.
- Session items show numbered markers and red dashed route lines between machines in order, on every floor involved.
- Muscle-focus chips dim machines that do not train that muscle.

## Session tab

- Title, client, coach, date, notes, plus the gym picker.
- Items: exercise name, machine, sets, reps (text, e.g. "8-10" or "8 min"), rest seconds, note. Move up/down,
  remove, clear all.
- Route is the item order; the plan draws it. Items on different floors are listed per floor.
- Save and assign: save as a template, assign to one or more clients as a programme.
- Share: PDF (cover details, ordered exercise table, one route map per floor), copy as text message, WhatsApp
  (`wa.me` link with the client's number) and email links, client link.
- Loading a template or programme: if its machines are not on the open gym's plan, items are remapped (same id,
  then same machine name and type, then a machine linked to that exercise); unmatched items are skipped and the
  user is told how many were moved and skipped.

## Run tab

- Pick client and programme (or the current session), see the gym picker (disabled during a run).
- Start, Next, step-by-step timing per exercise and rest countdown, finish, reset, copy the run log.
- Keeps the screen awake during a run (Screen Wake Lock) where the browser allows.
- A finished run is saved to history with client, coach, title, date, gym, total time, planned minutes, steps done
  and per-step times. History entries can be re-copied or exported to PDF.
- A "follow" highlight on the plan shows the current exercise's machine.

## Clients tab

- List (search box appears once there are more than 6 clients); profile form: name, WhatsApp, email, emergency contact (name, phone, relationship), plan,
  subscription status (active, trial, paused, expired), sessions per week, sessions left, renewal date, goals,
  private notes, programmes list.
- Client records are private to the trainer. The client link and PDF carry only the programme, never contact
  details or private notes.
- Open a programme into the session, delete it, assign templates to clients.

## Library tab

- **Exercises**: name, muscles (chest, back, shoulders, arms, core, legs, glutes, cardio, full body, mobility),
  level (Beginner, Intermediate, Advanced), default sets / reps / rest, coaching cue, linked machines.
  Create, edit, delete, unlink from a machine.
- **Templates**: list, load (replace) or add (append) to the session, assign, delete.
- **History**: past runs.
- Workouts picker: pre-built example workouts load into the session.

## Layout editor (Edit layout mode)

Every edit applies to the open gym's working copy; **Save layout** commits it to the gym.

**Zones**
- Add zone; drag to move (its equipment moves with it); select to show grips on edges and corners to push and pull
  sides; numeric fields Left, Top, Width, Height; name; type (category); **Floor location** dropdown moves the
  zone and its machines to another floor. Minimum zone size 60 x 50.
- Snap to a 10 px grid (checkbox).
- **Join zones**: a zone card lists zones on the same floor that touch it (edges within 12 px with at least 16 px
  of shared edge). Join merges the other zone into this one; gaps up to 12 px are closed; equipment moves with it.
  The result is one irregular zone made of up to 12 rectangles ("parts"), drawn with a single clean outline.
  Pick a Part chip to resize that part with the grips; dragging any part moves the whole zone.
  **Split part off** turns a part back into its own zone (equipment stays with the part it sits in).
  A warning appears if parts no longer touch.
- **Duplicate zone**: copy to this floor (offset 30 px) or another floor (same position; the floor grows if needed),
  optionally with all machines; copied machines are linked to the same exercises. Names become "X copy", "X copy 2".
- Zone label sits in the top-left part; the item count in the bottom-right part.

**Equipment**: add to a zone, drag a marker (dropping it in another zone moves it there), name, type, muscles,
notes, delete, link and unlink exercises. Markers are kept inside their zone (any part of a joined zone).

**Architectural key** (landscape strip under the plan): staircase, lift, door, revolving door, double glass door,
column, toilets, wall, balustrade, glass facade. Boxes and symbols can be moved and rotated; walls, balustrades and
glass facades are lines with draggable end grips. Each item has a Scale (%) field. Stairs and lift are
**vertical circulation**: placing one on any floor shows it at the same position on every floor (shared flag);
older data is migrated.

**Floors**: add, rename, delete floors; per-floor plan size (wider, taller; 600 x 400 minimum, 2400 x 1800 maximum).
Floor tabs drive the plan, route maps, run view, PDF and client link.

## Gyms tab and multi-gym behaviour

- Each gym stores: name, branch, address, phone, notes, a saved layout (floors, zones, structs, equipment) and its
  exercise-to-machine links.
- Open now / Open / Details / Duplicate this gym / Delete (never the open gym, never the last gym).
- Add a gym: blank plan, a copy of what is on screen, or the Virgin Active Bedfordview starting layout.
- Switching gyms: if there are unsaved layout changes, ask Save and switch / Discard and switch / Cancel. If some
  session items have no matching machine, say how many will be removed and ask. Run in progress blocks switching.
- Templates, programmes and runs remember the gym they were made at.

## Client view (read-only)

- A link (`#p...`) shows one programme: gym name, title, notes, ordered exercises, the floor plan with the route,
  and a PDF button. Private data is not included. Works with no login.
- If the gym's layout is not the built-in one, the link carries a compact copy of the layout (see data model).

## Data tab

- JSON export of the open gym (floors, zones, structs, equipment, exercises, templates, session) and import with
  validation; reset layout to the starting layout.

## Non-functional rules seen in the prototype

- Light and dark theme; layout works from 390 px wide up; plan and key scroll inside their own containers.
- Autosave of working state; explicit Save layout for the gym's saved layout.
- Edit mode on a phone is cramped; the hint text says a tablet or laptop works best.
