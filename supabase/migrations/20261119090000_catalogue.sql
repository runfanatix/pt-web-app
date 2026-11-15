-- PT Planner: the equipment catalogue (Phase 8). A new migration: earlier ones are already applied.
--
-- Manufacturers (Technogym, Eleiko...) and the models they make ("Selection Pin Loaded Chest Press", code, kind,
-- muscles, specifications). The trainer fills these in by hand; rows with trainer_id null are shared ones loaded by
-- a script (everyone can read them, nobody can change them from the app). A machine on the floor plan can point at
-- one model (equipment.catalogue_item_id), so a routine can say exactly which real machine each exercise uses.
--
-- Deleting a model never deletes a machine: the machine keeps its name and just loses the link.

create table public.manufacturers (
  id         uuid primary key default gen_random_uuid(),
  trainer_id uuid references public.trainers (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index manufacturers_name_idx
  on public.manufacturers (coalesce(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index manufacturers_trainer_idx on public.manufacturers (trainer_id);

create table public.catalogue_items (
  id              uuid primary key default gen_random_uuid(),
  trainer_id      uuid references public.trainers (id) on delete cascade,
  manufacturer_id uuid not null references public.manufacturers (id) on delete cascade,
  model_name      text not null check (char_length(btrim(model_name)) between 1 and 80),
  code            text not null default '' check (char_length(code) <= 40),
  kind            text not null default 'machine' check (kind in ('cardio','machine','free','rig','space')),
  muscles         text[] not null default '{}'
    check (muscles <@ array['chest','back','shoulders','arms','core','legs','glutes','cardio','full body','mobility']),
  specs           jsonb not null default '[]' check (jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) <= 30),
  notes           text not null default '' check (char_length(notes) <= 1000),
  created_at      timestamptz not null default now()
);
create unique index catalogue_items_code_idx
  on public.catalogue_items (manufacturer_id, lower(code)) where code <> '';
create index catalogue_items_manufacturer_idx on public.catalogue_items (manufacturer_id);
create index catalogue_items_trainer_idx on public.catalogue_items (trainer_id);

alter table public.equipment
  add constraint equipment_catalogue_item_fk
  foreign key (catalogue_item_id) references public.catalogue_items (id) on delete set null;
create index equipment_catalogue_idx on public.equipment (catalogue_item_id);

alter table public.manufacturers  enable row level security;
alter table public.catalogue_items enable row level security;

create policy manufacturers_select on public.manufacturers for select to authenticated
  using (trainer_id is null or trainer_id = public.current_trainer_id());
create policy manufacturers_insert on public.manufacturers for insert to authenticated
  with check (trainer_id = public.current_trainer_id());
create policy manufacturers_update on public.manufacturers for update to authenticated
  using (trainer_id = public.current_trainer_id()) with check (trainer_id = public.current_trainer_id());
create policy manufacturers_delete on public.manufacturers for delete to authenticated
  using (trainer_id = public.current_trainer_id());

-- a trainer's model may sit under their own manufacturer or a shared one (the subquery is itself row-level secured)
create policy catalogue_items_select on public.catalogue_items for select to authenticated
  using (trainer_id is null or trainer_id = public.current_trainer_id());
create policy catalogue_items_insert on public.catalogue_items for insert to authenticated
  with check (trainer_id = public.current_trainer_id()
              and exists (select 1 from public.manufacturers m where m.id = manufacturer_id));
create policy catalogue_items_update on public.catalogue_items for update to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id()
              and exists (select 1 from public.manufacturers m where m.id = manufacturer_id));
create policy catalogue_items_delete on public.catalogue_items for delete to authenticated
  using (trainer_id = public.current_trainer_id());

grant select, insert, update, delete on public.manufacturers, public.catalogue_items to authenticated;

-- The layout save now also keeps each machine's catalogue model.
create or replace function public.save_gym_layout(p_gym_id uuid, p_layout json) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_floors    uuid[] := array(select (x ->> 'id')::uuid from json_array_elements(coalesce(p_layout -> 'floors', '[]'::json)) x);
  v_zones     uuid[] := array(select (x ->> 'id')::uuid from json_array_elements(coalesce(p_layout -> 'zones', '[]'::json)) x);
  v_structs   uuid[] := array(select (x ->> 'id')::uuid from json_array_elements(coalesce(p_layout -> 'structs', '[]'::json)) x);
  v_equipment uuid[] := array(select (x ->> 'id')::uuid from json_array_elements(coalesce(p_layout -> 'equipment', '[]'::json)) x);
begin
  if not public.owns_gym(p_gym_id) then
    raise exception 'That gym was not found.' using errcode = '42501';
  end if;
  if coalesce(array_length(v_floors, 1), 0) = 0 then
    raise exception 'A gym needs at least one floor.' using errcode = '22023';
  end if;

  -- every zone, structure and machine must point at something in this same layout
  if exists (select 1 from json_array_elements(coalesce(p_layout -> 'zones', '[]'::json)) x
              where not ((x ->> 'floor_id')::uuid = any (v_floors))) then
    raise exception 'A zone is on a floor that is not in the layout.' using errcode = '23503';
  end if;
  if exists (select 1 from json_array_elements(coalesce(p_layout -> 'structs', '[]'::json)) x
              where not ((x ->> 'floor_id')::uuid = any (v_floors))) then
    raise exception 'A structure is on a floor that is not in the layout.' using errcode = '23503';
  end if;
  if exists (select 1 from json_array_elements(coalesce(p_layout -> 'equipment', '[]'::json)) x
              where not ((x ->> 'zone_id')::uuid = any (v_zones))) then
    raise exception 'A machine is in a zone that is not in the layout.' using errcode = '23503';
  end if;

  -- a machine may point at a catalogue model, but only one this trainer can see (their own or a shared one)
  if exists (select 1 from json_array_elements(coalesce(p_layout -> 'equipment', '[]'::json)) x
              where nullif(x ->> 'catalogue_item_id', '') is not null
                and not exists (select 1 from public.catalogue_items c where c.id = (x ->> 'catalogue_item_id')::uuid)) then
    raise exception 'A machine uses a catalogue model that was not found.' using errcode = '23503';
  end if;

  -- remove what is no longer there (machines first: deleting one also removes its exercise links;
  -- history, templates and programmes keep their rows and just lose the link to the machine)
  delete from public.equipment e using public.zones z, public.floors f
   where e.zone_id = z.id and z.floor_id = f.id and f.gym_id = p_gym_id and not (e.id = any (v_equipment));
  delete from public.zones z using public.floors f
   where z.floor_id = f.id and f.gym_id = p_gym_id and not (z.id = any (v_zones));
  delete from public.structs s using public.floors f
   where s.floor_id = f.id and f.gym_id = p_gym_id and not (s.id = any (v_structs));
  delete from public.floors where gym_id = p_gym_id and not (id = any (v_floors));

  insert into public.floors (id, gym_id, name, w, h, position)
  select (x ->> 'id')::uuid, p_gym_id, x ->> 'name', (x ->> 'w')::int, (x ->> 'h')::int, (x ->> 'position')::int
    from json_array_elements(p_layout -> 'floors') x
  on conflict (id) do update
    set name = excluded.name, w = excluded.w, h = excluded.h, position = excluded.position
    where public.floors.gym_id = p_gym_id;

  insert into public.zones (id, floor_id, name, category, x, y, w, h)
  select (x ->> 'id')::uuid, (x ->> 'floor_id')::uuid, x ->> 'name', x ->> 'category',
         (x ->> 'x')::numeric, (x ->> 'y')::numeric, (x ->> 'w')::numeric, (x ->> 'h')::numeric
    from json_array_elements(coalesce(p_layout -> 'zones', '[]'::json)) x
  on conflict (id) do update
    set floor_id = excluded.floor_id, name = excluded.name, category = excluded.category,
        x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h
    where exists (select 1 from public.floors f where f.id = public.zones.floor_id and f.gym_id = p_gym_id);

  delete from public.zone_parts where zone_id = any (v_zones);
  insert into public.zone_parts (zone_id, x, y, w, h, position)
  select (z ->> 'id')::uuid, (p ->> 'x')::numeric, (p ->> 'y')::numeric, (p ->> 'w')::numeric, (p ->> 'h')::numeric, (p ->> 'position')::int
    from json_array_elements(coalesce(p_layout -> 'zones', '[]'::json)) z,
         json_array_elements(coalesce(z -> 'parts', '[]'::json)) p;

  insert into public.structs (id, floor_id, type, x, y, w, h, x2, y2, rotation, label, shared)
  select (x ->> 'id')::uuid, (x ->> 'floor_id')::uuid, x ->> 'type', (x ->> 'x')::numeric, (x ->> 'y')::numeric,
         (x ->> 'w')::numeric, (x ->> 'h')::numeric, (x ->> 'x2')::numeric, (x ->> 'y2')::numeric,
         coalesce((x ->> 'rotation')::numeric, 0), coalesce(x ->> 'label', ''), coalesce((x ->> 'shared')::boolean, false)
    from json_array_elements(coalesce(p_layout -> 'structs', '[]'::json)) x
  on conflict (id) do update
    set floor_id = excluded.floor_id, type = excluded.type, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
        x2 = excluded.x2, y2 = excluded.y2, rotation = excluded.rotation, label = excluded.label, shared = excluded.shared
    where exists (select 1 from public.floors f where f.id = public.structs.floor_id and f.gym_id = p_gym_id);

  insert into public.equipment (id, zone_id, name, type, x, y, muscles, notes, catalogue_item_id)
  select (x ->> 'id')::uuid, (x ->> 'zone_id')::uuid, x ->> 'name', x ->> 'type', (x ->> 'x')::numeric, (x ->> 'y')::numeric,
         array(select json_array_elements_text(coalesce(x -> 'muscles', '[]'::json))), coalesce(x ->> 'notes', ''),
         nullif(x ->> 'catalogue_item_id', '')::uuid
    from json_array_elements(coalesce(p_layout -> 'equipment', '[]'::json)) x
  on conflict (id) do update
    set zone_id = excluded.zone_id, name = excluded.name, type = excluded.type, x = excluded.x, y = excluded.y,
        muscles = excluded.muscles, notes = excluded.notes, catalogue_item_id = excluded.catalogue_item_id
    where exists (select 1 from public.zones z join public.floors f on f.id = z.floor_id
                   where z.id = public.equipment.zone_id and f.gym_id = p_gym_id);

  -- an id that already belongs to another gym is never taken over: the counts must match what was sent
  if (select count(*) from public.floors where gym_id = p_gym_id) <> coalesce(array_length(v_floors, 1), 0)
     or (select count(*) from public.zones z join public.floors f on f.id = z.floor_id where f.gym_id = p_gym_id) <> coalesce(array_length(v_zones, 1), 0)
     or (select count(*) from public.structs s join public.floors f on f.id = s.floor_id where f.gym_id = p_gym_id) <> coalesce(array_length(v_structs, 1), 0)
     or (select count(*) from public.equipment e join public.zones z on z.id = e.zone_id join public.floors f on f.id = z.floor_id where f.gym_id = p_gym_id) <> coalesce(array_length(v_equipment, 1), 0)
  then
    raise exception 'The layout uses an id that belongs to something else.' using errcode = '23505';
  end if;

  update public.gyms set updated_at = now() where id = p_gym_id;
end $$;

revoke all on function public.save_gym_layout(uuid, json) from public;
grant execute on function public.save_gym_layout(uuid, json) to authenticated;
