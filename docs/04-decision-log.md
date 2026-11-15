# 04 Decision log: how the prototype got here

## The owner's requests, in order

1. Digital exercise and programme planner to replace handwritten notes: trainer builds a programme from an
   exercise database, with routines built around machines that sit close together; works on phone and website.
2. A floor-plan view of Virgin Active Bedfordview (zones such as cardio, strength, functional, studios, padel,
   co-working) with machines placed on it, session order drawn as a route, run mode with timers, clients,
   templates, history, PDF export, WhatsApp and email sharing, and a read-only client link.
3. Editable layout: push and pull zone sides and corners with visible grips; an architectural key down the side
   (staircase, lift, door, revolving door, column, glass facade, toilets, wall, balustrade, double glass door) where
   lines extend by their ends; several floors with floor selection in the session builder, run, PDF and client link.
4. Zone **Floor location** dropdown that moves a zone and its machines to another floor; smaller key moved below the
   plan as a landscape strip; per-item **Scale (%)**; larger plan (wider and taller, per floor).
5. Stairs and lift show in the same position on every floor.
6. **Join** touching zones into one irregular zone, and **Duplicate** a zone with its machines.
7. **Multiple gyms**: save layouts for different locations with name, branch, address; a Gyms tab; Save layout in
   edit mode; gym dropdown when running a routine.
8. Move the whole thing into Claude Code and build a real version (this handoff).

## Design decisions and reasons

- **Plan stays illustrative**: the Bedfordview layout is approximate (from the club's class timetable areas), so
  editing is a first-class feature, not an afterthought.
- **Explicit Save layout** (not silent autosave of the gym): the owner asked for a save button; a trainer can try
  changes and discard them. Autosave keeps a working draft so a refresh does not lose work.
- **Links per gym**: machines differ between gyms, so exercise links live with the gym.
- **Copies keep ids**: duplicating or forking a gym keeps equipment ids so existing sessions need no remapping.
- **Remap on switch** by id, then machine name and type, then exercise link; always tell the user what moved or was
  dropped and ask before dropping.
- **Joined zones are rectangles plus parts** (not free-form polygons): keeps editing simple (grips on rectangles)
  and equipment placement predictable.
- **Two-tap confirm** for destructive actions, because the prototype runs where browser dialogs are blocked.
- **Client privacy**: links and PDFs never include contact details or private notes.
- **Mobile first** for the run and plan screens; layout editing is expected on a tablet or laptop.

## Open questions for the owner (ask before building)

1. **Answered (2026-11-15):** Supabase and Vercel. The owner (developer) pays, using free tiers for the working prototype and upgrading when the app goes live with paying customers. See `docs/06-supabase-setup.md`.
2. Do clients log in (their own accounts) from day one, or is the share link enough for the first release?
3. Should layout editing be restricted to the gym owner or any trainer? Are layouts shared between trainers at the
   same gym?
4. Equipment catalogue: who supplies the Technogym and Eleiko item list, codes and images, and under what licence?
5. Should exercise-to-machine links be copied from one gym to another by name when a gym is created?
6. Branding: product name, colours and logo for the real app (the prototype is named after Bedfordview only).
7. **Answered (2026-11-15):** a privacy notice and consent flow are required at launch. Hosting region: Supabase has no African region, so use the nearest EU region (London or Frankfurt) and document the POPIA section 72 basis. Built and outstanding items: `docs/07-privacy-popia.md`. The notice wording must come from the owner.
8. Which payments and calendar providers for the later platform modules?

## What the prototype does not have (candidate backlog)

Real accounts, offline mode, exercise images or videos, progression tracking over time, body metrics, client
notifications, calendar and bookings, invoicing and payments, trainer analytics, multi-trainer roles.

## Phase 3 decisions (session builder)

- **Pop-up**: tapping a machine opens a floating card by the marker, or a bottom sheet at 640 px and below. Escape or the close button closes it; tapping the same machine again also closes it. The Zones tab offers the same "add an exercise" action as a list, for keyboard, screen-reader and small-screen use.
- **Reordering** uses the up and down buttons and the grip's arrow keys. Dragging the grip with a finger or mouse is **not built yet** (candidate for a later polish pass).
- **Free-text fields** (exercise, reps, coach note) are text inputs with suggestion lists instead of the prototype's "pick or choose Other" dropdowns; sets and rest are number inputs (sets at least 1, rest at least 0).
- **Library link follows the name**: choosing a linked exercise's name keeps its library id (used for the cue and for remapping); typing a different name makes it a free exercise.
- **Draft**: the unsent routine (items, session name, coach, date, notes, guest name) is kept in this browser per gym, so a reload does not lose it. It holds no client records.
- **Templates** are stored per trainer with the gym they were made at (tables `templates` and `template_items`), saved under a name (same name updates it), listed with Load, Add to session and a two-tap Delete. Loading remaps machines onto the open gym: same machine, then same name and type, then a machine the exercise is linked to; the toast says how many moved and how many were skipped. Items whose machine was deleted keep their exercise and can still remap by exercise link.
- **Not in Phase 3**: saved clients, assigning programmes, PDF, WhatsApp and email sharing and the client link (all Phase 5); the live run (Phase 4). The Session tab has a free-typed "guest name" until clients exist.

## Phase 4 decisions (run mode and history)

- **Behaviour follows the prototype**: the Run tab and a bar above the plan show total time and time at the current machine, with Pause, Back and "Done, next" (the last step reads "Done, finish"). Markers turn blue (in the routine), orange with a pulse (current), red (still to do, with an animated red route) and grey with a tick (done). Tapping a machine during a run jumps to its next step still to do. "End workout" (two taps) finishes early; unfinished steps are skipped. Reset needs two taps while running.
- **Rest countdown between sets (added at the owner's request; not in the prototype).** Each exercise tracks its sets: **Set done** moves to the next set and starts the exercise's rest (seconds, from the session item) counting down in the bar; when it runs out the phone vibrates and beeps, and the bar says to start the next set. **Skip rest** ends it early. On the last set the bar offers **Done, next** (**Done, finish** on the last machine), and **Next machine** is always available to move on early. Pausing freezes the rest; the rest counts towards total and machine time. An exercise with no rest time goes straight to the next set. Vibration works on Android browsers; **iPhone Safari does not support the vibration API**, so the beep (and the on-screen change) is the signal there. **Rest alert: on/off** in the bar switches both off. Browsers only allow sound after a tap, so audio is unlocked by Start, Resume and Set done.
- **History**: a finished run is saved to `runs` and `run_steps` with the machine, zone and exercise names copied in, so it stays readable after equipment or a gym is deleted. Undo last then finishing again updates the same record. The Run tab lists the latest 10 (details, copy log for WhatsApp, two-tap delete). A failed save is reported and the finished screen stays.
- **The clock** counts from real timestamps four times a second (so a throttled background tab still counts correctly), pauses on Pause, and asks the browser to keep the screen awake while running (re-requested when the tab becomes visible again).
- **A run in progress survives a reload** (added at the owner's request). The run state and the unsent routine (with its item ids) are kept in this browser; after a reload the app reopens the same gym on the Run tab with the workout **paused**, showing its time, step and set. Time while the page was closed is not counted; Resume carries on from now. A finished or reset run is forgotten. One run at a time; a corrupted saved run is ignored.
- **Not in Phase 4**: saved clients and "who is training" pickers, PDF of a past run, and the client-view preview (all Phase 5). The Run tab loads a saved workout from your templates; the client/programme pickers arrive with clients.
