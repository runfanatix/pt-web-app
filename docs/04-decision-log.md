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

1. Hosting and accounts: Supabase and Vercel as recommended, or something else? Who pays for them?
2. Do clients log in (their own accounts) from day one, or is the share link enough for the first release?
3. Should layout editing be restricted to the gym owner or any trainer? Are layouts shared between trainers at the
   same gym?
4. Equipment catalogue: who supplies the Technogym and Eleiko item list, codes and images, and under what licence?
5. Should exercise-to-machine links be copied from one gym to another by name when a gym is created?
6. Branding: product name, colours and logo for the real app (the prototype is named after Bedfordview only).
7. POPIA: where will data be hosted, and is a privacy notice and client consent flow needed at launch?
8. Which payments and calendar providers for the later platform modules?

## What the prototype does not have (candidate backlog)

Real accounts, offline mode, exercise images or videos, progression tracking over time, body metrics, client
notifications, calendar and bookings, invoicing and payments, trainer analytics, multi-trainer roles.
