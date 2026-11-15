-- PT Planner: core schema (Phase 1). See docs/02-data-model.md.
-- Conventions: uuid primary keys, ON DELETE CASCADE down the ownership chain, snake_case columns.
-- Denormalised names on programme items, template items and run steps keep history readable after deletes.


-- ---------------------------------------------------------------- trainers
create table public.trainers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at   timestamptz not null default now()
);

-- One trainer row per auth user, created automatically at sign-up. If the sign-up form recorded that the user
-- accepted the privacy notice (user metadata 'privacy_notice_version'), store that as a consent record (POPIA).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trainer uuid;
begin
  insert into public.trainers (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  returning id into v_trainer;
  if new.raw_user_meta_data ->> 'privacy_notice_version' is not null then
    insert into public.consents (trainer_id, subject, purpose, notice_version)
    values (v_trainer, 'trainer', 'privacy-notice', left(new.raw_user_meta_data ->> 'privacy_notice_version', 40));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- gyms and layout
create table public.gyms (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  branch     text not null default '' check (char_length(branch) <= 60),
  address    text not null default '' check (char_length(address) <= 160),
  phone      text not null default '' check (char_length(phone) <= 40),
  notes      text not null default '' check (char_length(notes) <= 1000),
  updated_at timestamptz not null default now()
);
create index gyms_trainer_idx on public.gyms (trainer_id);

create table public.floors (
  id       uuid primary key default gen_random_uuid(),
  gym_id   uuid not null references public.gyms (id) on delete cascade,
  name     text not null default 'Floor' check (char_length(name) between 1 and 60),
  w        integer not null default 1000 check (w between 600 and 2400),
  h        integer not null default 620  check (h between 400 and 1800),
  position integer not null default 0
);
create index floors_gym_idx on public.floors (gym_id);

create table public.zones (
  id       uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors (id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 60),
  category text not null check (category in ('cardio','strength','functional','studio','water','amenity','outdoor')),
  x numeric not null, y numeric not null,
  w numeric not null check (w >= 60),
  h numeric not null check (h >= 50)
);
create index zones_floor_idx on public.zones (floor_id);

-- Extra rectangles of a joined zone: at most 11, so 12 rectangles per zone in total.
create table public.zone_parts (
  id       uuid primary key default gen_random_uuid(),
  zone_id  uuid not null references public.zones (id) on delete cascade,
  x numeric not null, y numeric not null,
  w numeric not null check (w >= 16),
  h numeric not null check (h >= 16),
  position integer not null check (position between 0 and 10),
  unique (zone_id, position)
);

create table public.structs (
  id       uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors (id) on delete cascade,
  type     text not null check (type in ('stairs','lift','door','revolving','dglass','column','toilets','wall','balustrade','glass')),
  x numeric not null, y numeric not null,
  w numeric, h numeric, x2 numeric, y2 numeric,
  rotation numeric not null default 0,
  label    text not null default '' check (char_length(label) <= 60),
  shared   boolean not null default false
);
create index structs_floor_idx on public.structs (floor_id);

create table public.equipment (
  id      uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 60),
  type    text not null check (type in ('cardio','machine','free','rig','space')),
  x numeric not null, y numeric not null,
  muscles text[] not null default '{}'
    check (muscles <@ array['chest','back','shoulders','arms','core','legs','glutes','cardio','full body','mobility']),
  notes   text not null default '' check (char_length(notes) <= 1000),
  catalogue_item_id uuid          -- Phase 8: Technogym / Eleiko catalogue
);
create index equipment_zone_idx on public.equipment (zone_id);

-- ---------------------------------------------------------------- exercises
-- trainer_id null = built-in library, readable by every trainer, writable by none (seeded by an admin).
create table public.exercises (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid references public.trainers (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  muscles    text[] not null default '{}'
    check (muscles <@ array['chest','back','shoulders','arms','core','legs','glutes','cardio','full body','mobility']),
  level      text not null default 'B' check (level in ('B','I','A')),
  sets       integer not null default 3 check (sets between 1 and 99),
  reps       text not null default '10' check (char_length(reps) <= 40),
  rest       integer not null default 60 check (rest between 0 and 3600),
  cue        text not null default '' check (char_length(cue) <= 1000)
);
create index exercises_trainer_idx on public.exercises (trainer_id);

create table public.exercise_equipment (
  exercise_id  uuid not null references public.exercises (id) on delete cascade,
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  primary key (exercise_id, equipment_id)
);
create index exercise_equipment_equipment_idx on public.exercise_equipment (equipment_id);

-- ---------------------------------------------------------------- templates
create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (id) on delete cascade,
  gym_id     uuid not null references public.gyms (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  notes      text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index templates_trainer_idx on public.templates (trainer_id);
create index templates_gym_idx on public.templates (gym_id);

create table public.template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.templates (id) on delete cascade,
  position      integer not null,
  equipment_id  uuid references public.equipment (id) on delete set null,
  exercise_id   uuid references public.exercises (id) on delete set null,
  exercise_name text not null,
  sets          integer not null default 3,
  reps          text not null default '10',
  rest          integer not null default 60,
  note          text not null default ''
);
create index template_items_template_idx on public.template_items (template_id);

-- ---------------------------------------------------------------- clients (personal data, POPIA)
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    uuid not null references public.trainers (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  whatsapp      text not null default '',
  email         text not null default '',
  emergency_name text not null default '',
  emergency_phone text not null default '',
  emergency_relation text not null default '',
  plan          text not null default '',
  sub_status    text not null default 'active' check (sub_status in ('active','trial','paused','expired')),
  per_week      integer not null default 0 check (per_week between 0 and 14),
  sessions_left integer not null default 0,
  renewal       date,
  goals         text not null default '',
  private_notes text not null default '',   -- trainer-only; never exposed to a client link or PDF
  created_at    timestamptz not null default now()
);
create index clients_trainer_idx on public.clients (trainer_id);

create table public.programmes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  gym_id      uuid references public.gyms (id) on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  notes       text not null default '',
  assigned_at timestamptz not null default now()
);
create index programmes_client_idx on public.programmes (client_id);

create table public.programme_items (
  id            uuid primary key default gen_random_uuid(),
  programme_id  uuid not null references public.programmes (id) on delete cascade,
  position      integer not null,
  equipment_id  uuid references public.equipment (id) on delete set null,
  exercise_id   uuid references public.exercises (id) on delete set null,
  exercise_name text not null,
  sets          integer not null default 3,
  reps          text not null default '10',
  rest          integer not null default 60,
  note          text not null default ''
);
create index programme_items_programme_idx on public.programme_items (programme_id);

-- ---------------------------------------------------------------- run history
create table public.runs (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references public.trainers (id) on delete cascade,
  client_id   uuid references public.clients (id) on delete set null,
  gym_id      uuid references public.gyms (id) on delete set null,
  client_name text not null default '',
  gym_name    text not null default '',
  coach       text not null default '',
  title       text not null default '',
  run_date    date not null default current_date,
  started_at  timestamptz,
  total_ms    bigint not null default 0,
  planned_min integer not null default 0
);
create index runs_trainer_idx on public.runs (trainer_id);

create table public.run_steps (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete cascade,
  n             integer not null,
  equipment_id  uuid references public.equipment (id) on delete set null,
  machine       text not null default '',
  zone          text not null default '',
  exercise_name text not null,
  sets          integer not null default 3,
  reps          text not null default '10',
  rest          integer not null default 60,
  ms            bigint not null default 0,
  done          boolean not null default false,
  step_order    integer not null default 0
);
create index run_steps_run_idx on public.run_steps (run_id);

-- ---------------------------------------------------------------- share links (Phase 5 reads these server-side)
create table public.share_links (
  token        text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  programme_id uuid not null references public.programmes (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create index share_links_programme_idx on public.share_links (programme_id);

-- ---------------------------------------------------------------- consent records (POPIA)
-- subject 'trainer': the trainer accepted the privacy notice at sign-up.
-- subject 'client' : the trainer recorded that a client consented to their data being processed.
create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  trainer_id     uuid not null references public.trainers (id) on delete cascade,
  client_id      uuid references public.clients (id) on delete cascade,
  subject        text not null check (subject in ('trainer','client')),
  purpose        text not null check (char_length(purpose) between 1 and 80),
  notice_version text not null check (char_length(notice_version) between 1 and 40),
  granted_at     timestamptz not null default now(),
  withdrawn_at   timestamptz,
  check ((subject = 'client') = (client_id is not null))
);
create index consents_trainer_idx on public.consents (trainer_id);
create index consents_client_idx on public.consents (client_id);

-- gyms.updated_at maintenance
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger gyms_touch before update on public.gyms for each row execute function public.touch_updated_at();
