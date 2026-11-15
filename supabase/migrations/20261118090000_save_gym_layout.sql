-- PT Planner: saving an edited gym layout in one step (Phase 6). A new migration: earlier ones are already applied.
--
-- The layout editor works on a copy of the plan and presses "Save layout" once. This function makes the saved gym
-- match that copy: rows that are no longer in it are deleted, the rest are inserted or updated by id (so equipment
-- keeps its exercise links and its place in programmes and history), and zone parts are replaced. It runs as ONE
-- transaction: if any row breaks a rule (a zone too small, a bad category...) nothing is changed.
--
-- SECURITY INVOKER: row-level security still applies, so a trainer can only ever change their own gym. The function
-- also checks ownership first and refuses ids that already belong to another gym.

create function public.save_gym_layout(p_gym_id uuid, p_layout json) returns void
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

  insert into public.equipment (id, zone_id, name, type, x, y, muscles, notes)
  select (x ->> 'id')::uuid, (x ->> 'zone_id')::uuid, x ->> 'name', x ->> 'type', (x ->> 'x')::numeric, (x ->> 'y')::numeric,
         array(select json_array_elements_text(coalesce(x -> 'muscles', '[]'::json))), coalesce(x ->> 'notes', '')
    from json_array_elements(coalesce(p_layout -> 'equipment', '[]'::json)) x
  on conflict (id) do update
    set zone_id = excluded.zone_id, name = excluded.name, type = excluded.type, x = excluded.x, y = excluded.y,
        muscles = excluded.muscles, notes = excluded.notes
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
