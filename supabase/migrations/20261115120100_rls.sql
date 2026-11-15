-- PT Planner: row-level security (Phase 1).
-- A trainer sees and changes only their own rows. Built-in exercises (trainer_id null) are read-only to everyone.
-- Anonymous visitors get nothing: public client pages (Phase 5) will read through a server-side function, not a table.

-- Sign-up hook: create the trainers row for every new auth user.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- ownership helpers
-- SECURITY DEFINER so the lookups below are not themselves filtered by RLS (no recursion, one index hit each).
create function public.current_trainer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.trainers where user_id = auth.uid()
$$;

create function public.owns_gym(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gyms where id = p_id and trainer_id = public.current_trainer_id())
$$;

create function public.owns_floor(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.floors f join public.gyms g on g.id = f.gym_id
                 where f.id = p_id and g.trainer_id = public.current_trainer_id())
$$;

create function public.owns_zone(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.zones z join public.floors f on f.id = z.floor_id
                 join public.gyms g on g.id = f.gym_id
                 where z.id = p_id and g.trainer_id = public.current_trainer_id())
$$;

create function public.owns_equipment(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipment e join public.zones z on z.id = e.zone_id
                 join public.floors f on f.id = z.floor_id join public.gyms g on g.id = f.gym_id
                 where e.id = p_id and g.trainer_id = public.current_trainer_id())
$$;

create function public.owns_client(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients where id = p_id and trainer_id = public.current_trainer_id())
$$;

create function public.owns_programme(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.programmes p join public.clients c on c.id = p.client_id
                 where p.id = p_id and c.trainer_id = public.current_trainer_id())
$$;

create function public.owns_template(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.templates where id = p_id and trainer_id = public.current_trainer_id())
$$;

create function public.owns_run(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.runs where id = p_id and trainer_id = public.current_trainer_id())
$$;

-- An exercise the trainer may reference: built-in or their own.
create function public.can_use_exercise(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exercises
                 where id = p_id and (trainer_id is null or trainer_id = public.current_trainer_id()))
$$;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.trainers            enable row level security;
alter table public.gyms                enable row level security;
alter table public.floors              enable row level security;
alter table public.zones               enable row level security;
alter table public.zone_parts          enable row level security;
alter table public.structs             enable row level security;
alter table public.equipment           enable row level security;
alter table public.exercises           enable row level security;
alter table public.exercise_equipment  enable row level security;
alter table public.templates           enable row level security;
alter table public.template_items      enable row level security;
alter table public.clients             enable row level security;
alter table public.programmes          enable row level security;
alter table public.programme_items     enable row level security;
alter table public.runs                enable row level security;
alter table public.run_steps           enable row level security;
alter table public.share_links         enable row level security;
alter table public.consents            enable row level security;

-- ---------------------------------------------------------------- policies
create policy trainers_select on public.trainers for select to authenticated using (user_id = auth.uid());
create policy trainers_update on public.trainers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy gyms_all on public.gyms for all to authenticated
  using (trainer_id = public.current_trainer_id()) with check (trainer_id = public.current_trainer_id());

create policy floors_all on public.floors for all to authenticated
  using (public.owns_gym(gym_id)) with check (public.owns_gym(gym_id));

create policy zones_all on public.zones for all to authenticated
  using (public.owns_floor(floor_id)) with check (public.owns_floor(floor_id));

create policy zone_parts_all on public.zone_parts for all to authenticated
  using (public.owns_zone(zone_id)) with check (public.owns_zone(zone_id));

create policy structs_all on public.structs for all to authenticated
  using (public.owns_floor(floor_id)) with check (public.owns_floor(floor_id));

create policy equipment_all on public.equipment for all to authenticated
  using (public.owns_zone(zone_id)) with check (public.owns_zone(zone_id));

create policy exercises_select on public.exercises for select to authenticated
  using (trainer_id is null or trainer_id = public.current_trainer_id());
create policy exercises_insert on public.exercises for insert to authenticated
  with check (trainer_id = public.current_trainer_id());
create policy exercises_update on public.exercises for update to authenticated
  using (trainer_id = public.current_trainer_id()) with check (trainer_id = public.current_trainer_id());
create policy exercises_delete on public.exercises for delete to authenticated
  using (trainer_id = public.current_trainer_id());

create policy exercise_equipment_all on public.exercise_equipment for all to authenticated
  using (public.owns_equipment(equipment_id))
  with check (public.owns_equipment(equipment_id) and public.can_use_exercise(exercise_id));

create policy templates_all on public.templates for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id() and public.owns_gym(gym_id));

create policy template_items_all on public.template_items for all to authenticated
  using (public.owns_template(template_id)) with check (public.owns_template(template_id));

create policy clients_all on public.clients for all to authenticated
  using (trainer_id = public.current_trainer_id()) with check (trainer_id = public.current_trainer_id());

create policy programmes_all on public.programmes for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id) and (gym_id is null or public.owns_gym(gym_id)));

create policy programme_items_all on public.programme_items for all to authenticated
  using (public.owns_programme(programme_id)) with check (public.owns_programme(programme_id));

create policy runs_all on public.runs for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id()
              and (client_id is null or public.owns_client(client_id))
              and (gym_id is null or public.owns_gym(gym_id)));

create policy run_steps_all on public.run_steps for all to authenticated
  using (public.owns_run(run_id)) with check (public.owns_run(run_id));

create policy share_links_all on public.share_links for all to authenticated
  using (public.owns_programme(programme_id)) with check (public.owns_programme(programme_id));

-- Consent records are kept as evidence: trainers can read, add and withdraw them, but not delete them.
-- (They are removed only when the client or trainer account is erased, via ON DELETE CASCADE.)
create policy consents_select on public.consents for select to authenticated
  using (trainer_id = public.current_trainer_id());
create policy consents_insert on public.consents for insert to authenticated
  with check (trainer_id = public.current_trainer_id() and (client_id is null or public.owns_client(client_id)));
create policy consents_update on public.consents for update to authenticated
  using (trainer_id = public.current_trainer_id()) with check (trainer_id = public.current_trainer_id());

-- ---------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke delete on public.consents from authenticated;
revoke insert, delete on public.trainers from authenticated;
grant execute on all functions in schema public to authenticated;
-- handle_new_user / touch_updated_at are trigger functions; they never need to be called directly.
revoke execute on function public.handle_new_user() from authenticated;
