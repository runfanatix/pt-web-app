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

## Phase 5 decisions (clients, consent, programmes), first slice

- **Order of work**: consent and privacy first (from the owner's draft), then clients, then assigning programmes. PDF, WhatsApp and email sharing, share tokens and the public client page come next because they depend on clients and programmes existing.
- **Clients cannot be added until the trainer's business details are filled in** (name, address, contact email, Information Officer name and email), so a client never reads a notice with [PLACEHOLDERS] in it. Optional details (phone, payment provider, messaging provider, studio name) appear in the notice only when filled in.
- **Onboarding order** follows the draft: privacy notice, health information, storing information outside South Africa, [guardian for a minor], then the optional marketing screen (an unticked box is recorded as a "no" so the client is not asked again). Every box starts unticked; required screens cannot be passed without a tick. The sharing screen (one person at a time) and the photos screen are not part of onboarding: sharing is added per person from the client's page, and photos are not offered.
- **A minor** is a client whose date of birth makes them under 18; they need a guardian's name and the guardian consent screen. No date of birth counts as an adult.
- **Health data** (goals and private notes) is blocked before consent and locked after withdrawal. The saved profile never overwrites locked fields.
- **Consents are append-only**; the current state of a consent is its latest row. Withdrawing is a two-tap action that adds a row and logs a `consent-withdrawal` request.
- **Programmes**: the Session tab can name a saved client (their name goes on the session and the run log) and assign the routine to one or more clients as a programme; a client's profile lists their programmes, opens one into the session for that client, and deletes one (two taps). Runs now record which client they were for, and a saved run pushes that client's keep-until date out.
- **Bug found by the tests**: the date-of-birth check in the shared schema had a doubled backslash and rejected every date; fixed and covered.
- **Database change**: `supabase/migrations/20261116090000_clients_consent.sql` is a new migration. It must be applied to the live project before the Clients tab is used.

## Phase 5 decisions (sharing), second slice

- **The client's link** is `/p/<token>`. The token is 64 hex characters (256 random bits) from the existing `share_links` table. A trainer makes a link from a programme on the client's profile (Share), chooses how long it works (90 days by default, 30, 7, or never expires), can have several, and switches any off with two taps; switching off works at once. Links also stop working if the programme is deleted.
- **What a link shows**: the programme (title, notes, exercises with sets, reps, rest, coach notes and cues), the trainer's business name, the gym name and address, and the gym plan with the numbered route per floor. **Never** the client's name, contact details, goals, private notes, consent records, date of birth or the trainer's equipment notes. This is enforced in the database: a visitor who is not logged in has no table access at all and can only call the function `get_shared_programme(token)`, which returns exactly that and nothing else. Tests assert that none of the client's secrets appear in what it returns, and the browser test checks the visitor's page makes no other server call.
- **A bad, revoked or expired link** shows "This link is no longer available" and nothing else; the function returns null for all three, so a visitor cannot tell them apart.
- **The page** has no sign-in and no way into the rest of the app, and a "Save as PDF" button (the PDF has no client name). It needs the host to send every path to `index.html`: `apps/web/vercel.json` does that for Vercel.
- **Messages and PDF** follow the prototype: the same WhatsApp-style text, a WhatsApp link (numbers starting with 0 are treated as South African, +27), an email link (a very long message is replaced by a short one), and a PDF with header, meta row, exercise table and a route map per floor. A PDF can be attached only by the trainer: a web page cannot attach files to WhatsApp or the mail app. The Session tab has "Send to your client" for the current routine (no link); a link needs the routine saved as a programme first. Past runs have "Save PDF" for a results PDF with the actual times.
- **Machine names and the route map** appear in a message or PDF only for programmes made at the gym that is open; for another gym the exercises are listed without machines.
- **Database change**: `supabase/migrations/20261117090000_shared_programme.sql` adds the function. It must be applied to the live project before links work.

## Phase 6 decisions (layout editor)

- **Working copy, one save.** Edit layout works on a copy of the gym. Nothing reaches the database until the trainer presses Save layout, which sends the whole layout in one all-or-nothing call (`save_gym_layout`, migration `20261118090000`). Discard drops the copy. Leaving edit mode, switching gym or starting a run is blocked while changes are unsaved. A drag that ends where it began is not a change.
- **Deleting a zone deletes its machines** (the prototype leaves them zoneless). The database keeps every machine inside a zone, so the button says how many machines go and needs two taps. Deleting a floor likewise removes its zones, machines and architecture, except shared stairs and lifts, which move to the first remaining floor. Machines that no longer exist drop out of the unsent routine on save; history, templates and programmes keep their rows.
- **Duplicate zone copies exercise links after saving**: new machines have no database row until the save, so their links are written straight afterwards (the screen says if any failed).
- **Joined zones**: only touching zones on the same floor (within 12 px, sharing 16 px of edge) can be joined; a join closes small gaps; a zone can have at most 12 rectangles; a loose part can be split off as its own zone.
- **Rules are pure and parity-tested**: `layout-edit.ts`, `layout-structs.ts` and `layout-zones.ts` are compared with the prototype's own functions (resize, fit, join, split, duplicate) on hundreds of random cases.
- **Known limit**: on a phone the plan is scaled down, so the grips are small to hit with a finger; the number fields in the Layout tab do the same job.

## Phase 7 decisions (multi-gym)

- **Switching carries the routine.** The routine in the Session tab goes with the trainer: its exercises are remapped onto the machines of the gym they open (same machine, else same name and kind, else a machine the exercise is linked to), using the rules already used for templates. Exercises with no match are removed, and the trainer is told how many first. If the routine is empty, the other gym's own unsent draft is kept. This replaces the earlier behaviour of one separate draft per gym.
- **The question is asked only when needed**: unsaved layout changes (Save layout and switch / Discard changes and switch / Cancel) or exercises that would be removed (Switch / Cancel). Otherwise the switch just happens. A live run blocks switching.
- **Adding a gym**: a blank plan (one "Ground floor", 1000 x 620), or a copy of the plan as it is on screen (unsaved edits included; the gym it came from goes back to as saved). Copies get new ids for every floor, zone, structure and machine, and each machine's exercise links are copied. **Not built**: the prototype's "Virgin Active Bedfordview starting layout" option, because the real app has no built-in gym (the Bedfordview plan is imported once with the import script).
- **Duplicating a gym** copies its saved plan, links and details ("Branch copy"); it does not open it. A name already in use gets a number.
- **If saving a new gym's plan fails**, the half-made gym row is deleted again.
- **Deleting a gym** (never the open one, never the last one, two taps) deletes its plan, machines and templates. Finished workouts and client programmes are kept, with the gym left blank.
- **No new migration**: gyms, layouts and links use the existing tables and `save_gym_layout`; the database tests cover creating, copying, deleting and isolation between trainers.

## Phase 8 decisions (equipment catalogue)

- **Built as a framework the trainer fills in by hand**, because there is no full Technogym or Eleiko list yet. Manufacturers and models are rows the trainer adds in the Catalogue tab; nothing is pre-loaded. A bulk import (`scripts/import-catalogue.ts`, JSON) exists for when a list turns up; rows can be loaded as **shared** (everyone reads them, nobody edits them in the app) or into one trainer's own catalogue.
- **A model has**: manufacturer, model name, item code (unique within its manufacturer when given), kind (cardio, machine, free weights, rig, open space), muscles, specification rows (a label and a value each, up to 30) and notes.
- **A machine on the plan points at one model** (`equipment.catalogue_item_id`). The machine keeps its own name; when a model is picked the trainer can tick "use the model name" and "use the model's kind and muscles" (both ticked by default), so the plan, the muscle filter and the routine agree with the real machine. A new machine can also be created straight from a model.
- **Where the model shows**: machine pop-up, Zones tab (with its specifications), Session and Run lists, the run bar, and the PDF and message text ("Chest press · Technogym Selection Chest Press"). It is not on the client's public link yet: that database function does not return catalogue data, and adding it is a change to what a visitor can see.
- **Deleting a model or manufacturer never deletes a machine**: the machine keeps its name and loses only the link (the screen says how many machines use the model first). The layout save refuses a model the trainer cannot see.
- **Left for later**: item images (Storage), a gym walkthrough mode to place catalogue items, and licensing of any supplier content (decision-log question 4 is still open for whoever supplies the lists).

## Phase 9a decisions (client portal)

- **Owner's answers (2026-11-20):** emailed sign-in links (no passwords); Resend as the mail service; clients may run their own programmes (slice 9b); a client can belong to more than one trainer; placeholder branding for now.
- **Invites are tied to an email address, not a secret link.** The invitation email only contains the portal address. Whoever signs in with that **verified** email gets linked to the client record. This needs Supabase's "Confirm email" setting left on. A leaked invitation email is useless to anyone who cannot receive mail at the invited address.
- **More than one trainer**: each trainer keeps their own client record for the person; one sign-in can be linked to several. The portal shows each trainer separately. Switching access off is per trainer.
- **A client has no table access.** Everything goes through functions that return only the safe fields (never private notes, goals, other clients or other programmes). The public link and the portal share one function for describing a programme, so they cannot drift apart.
- **A client sign-in does not create a trainer account** (user metadata role = client). Anyone can still request a sign-in link, but with no invite they see "Nothing here yet".
- **Consent withdrawal by the client** adds a "no" record (consent records stay append-only) and logs a consent-withdrawal request for the trainer. Withdrawing a core consent warns the client first. Other requests (access, correction, deletion, objection) are logged for the trainer to answer; nothing is deleted automatically.
- **If the invitation email cannot be sent** (Resend not set up yet) the invitation is still saved and the trainer is given the portal link to send by WhatsApp.
- **Offline demo**: a Client view and Trainer view switch in the demo banner; in the demo, "emailing" a sign-in link simply signs in.

## Phase 9b decisions (clients run their own workouts)

- **The client runs a programme from the portal** with the same run engine as the trainer (rest countdown, vibration and beep, wake lock, a run in progress kept across a reload, restored paused).
- **Saved under the trainer, for that client**, marked as done by the client. The trainer sees it in Past runs; the client sees it under My workouts. A client can delete only workouts they did themselves; the trainer's own records stay with the trainer.
- **Nothing is saved for a workout with no time on the clock.** If saving fails the client is told.
- **The programme decides the gym and the client**, so a client cannot attach a workout to anyone else's record or gym. Saving is idempotent by id, and an id that belongs to someone else's run is refused.
- **Retention**: each saved workout moves the client's keep-until date out to five years after it, as the trainer's own runs do.
- **Not built**: progress charts over time, sharing a result with the trainer by message, editing a saved workout.

## Phase 10a decisions (bookings and calendar)

- **Our own calendar, no outside provider yet.** It covers daily, weekly and monthly in-person sessions without a calendar service. A one-way `.ics` export lets trainer and client put sessions in Google, Apple or Outlook. Two-way sync is left until the owner picks a provider (open question 8).
- **South African time everywhere** (fixed UTC+2); sessions are stored as exact moments, so a session means the same moment on any device.
- **Clashes warn, they do not block**, because group sessions and overlapping blocks are normal.
- **A client can confirm or say they cannot make it, not cancel or move.** The trainer stays in control of the diary; "cannot make it" is shown on the session.
- **Repeating sessions are separate rows linked by a series id**, so one can be changed or cancelled without touching the rest; "cancel this and the rest" cancels from that session on.
- **Automatic reminders are not built**: they need the email service from Phase 9a. Until then the trainer can send a WhatsApp reminder in one tap.
