-- PT Planner: clients run their own workouts (Phase 9b). A new migration: earlier ones are already applied.
--
-- A client who is signed in to the portal can run one of their programmes on their phone. When they finish, the
-- workout is saved as a run for that client, under their trainer, so it shows in the trainer's history for the
-- client. Clients still have no table access: they save, list and delete THEIR OWN runs only through these functions.
-- Safe to run more than once.

alter table public.runs add column if not exists by_client boolean not null default false;

-- Saves (or updates) a workout the client did. `p_run` is:
--   { id, title, run_date, started_at, total_ms, planned_min,
--     steps: [ { n, equipment_id, machine, zone, exercise_name, sets, reps, rest, ms, done, step_order } ] }
-- Using the same id again replaces the earlier save (finishing, undoing and finishing again). Returns the run id,
-- or null when the programme is not the caller's.
create or replace function public.portal_save_run(p_programme_id uuid, p_run json) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prog   public.programmes;
  v_client public.clients;
  v_id     uuid := coalesce(nullif(p_run ->> 'id', '')::uuid, gen_random_uuid());
  v_date   date := coalesce(nullif(p_run ->> 'run_date', '')::date, current_date);
  v_total  bigint := greatest(0, least(coalesce((p_run ->> 'total_ms')::bigint, 0), 86400000));
  v_gym    text;
  s        json;
begin
  if auth.uid() is null then return null; end if;
  select * into v_prog from public.programmes where id = p_programme_id;
  if not found or not public.portal_is_mine(v_prog.client_id) then return null; end if;
  select * into v_client from public.clients where id = v_prog.client_id;
  if json_array_length(coalesce(p_run -> 'steps', '[]'::json)) > 100 then
    raise exception 'A workout can have at most 100 exercises.' using errcode = '22023';
  end if;
  select nullif(btrim(g.name || ' ' || g.branch), '') into v_gym from public.gyms g where g.id = v_prog.gym_id;

  -- an id that already belongs to a run that is not this client's own save is never taken over
  if exists (select 1 from public.runs r where r.id = v_id and not (r.by_client and r.client_id = v_client.id)) then
    return null;
  end if;

  insert into public.runs (id, trainer_id, client_id, gym_id, client_name, gym_name, coach, title, run_date,
                           started_at, total_ms, planned_min, by_client)
  values (v_id, v_client.trainer_id, v_client.id, v_prog.gym_id, v_client.name, coalesce(v_gym, ''), '',
          left(coalesce(nullif(p_run ->> 'title', ''), v_prog.title), 120), v_date,
          coalesce(nullif(p_run ->> 'started_at', '')::timestamptz, now()), v_total,
          greatest(0, least(coalesce((p_run ->> 'planned_min')::int, 0), 1440)), true)
  on conflict (id) do update
    set title = excluded.title, run_date = excluded.run_date, started_at = excluded.started_at,
        total_ms = excluded.total_ms, planned_min = excluded.planned_min;

  delete from public.run_steps where run_id = v_id;
  for s in select * from json_array_elements(coalesce(p_run -> 'steps', '[]'::json)) loop
    insert into public.run_steps (run_id, n, equipment_id, machine, zone, exercise_name, sets, reps, rest, ms, done, step_order)
    values (v_id, coalesce((s ->> 'n')::int, 0),
            (select e.id from public.equipment e join public.zones z on z.id = e.zone_id join public.floors f on f.id = z.floor_id
              where e.id = nullif(s ->> 'equipment_id', '')::uuid and f.gym_id = v_prog.gym_id),
            left(coalesce(s ->> 'machine', ''), 120), left(coalesce(s ->> 'zone', ''), 120),
            left(coalesce(nullif(s ->> 'exercise_name', ''), 'Exercise'), 120),
            greatest(1, least(coalesce((s ->> 'sets')::int, 1), 99)), left(coalesce(s ->> 'reps', ''), 40),
            greatest(0, least(coalesce((s ->> 'rest')::int, 0), 3600)),
            greatest(0, least(coalesce((s ->> 'ms')::bigint, 0), 86400000)),
            coalesce((s ->> 'done')::boolean, false), coalesce((s ->> 'step_order')::int, 0));
  end loop;

  -- a client's record is kept for five years after their last workout
  update public.clients set retention_until = greatest(coalesce(retention_until, v_date), (v_date + interval '5 years')::date)
   where id = v_client.id;
  return v_id;
end $$;
revoke all on function public.portal_save_run(uuid, json) from public, anon;
grant execute on function public.portal_save_run(uuid, json) to authenticated;

-- The person's own workouts, newest first: the ones they did and the ones their trainer recorded for them.
create or replace function public.portal_history() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(q.j order by q.started_at desc)
      from (
        select r.started_at,
               json_build_object(
                 'id', r.id, 'client_id', r.client_id, 'title', r.title, 'run_date', r.run_date,
                 'total_ms', r.total_ms, 'planned_min', r.planned_min, 'by_client', r.by_client,
                 'gym', nullif(r.gym_name, ''),
                 'trainer', t.business_name,
                 'steps', coalesce((
                   select json_agg(json_build_object(
                            'n', st.n, 'machine', st.machine, 'exercise_name', st.exercise_name,
                            'sets', st.sets, 'reps', st.reps, 'ms', st.ms, 'done', st.done)
                          order by st.n)
                     from public.run_steps st where st.run_id = r.id), '[]'::json)
               ) as j
          from public.runs r
          join public.client_accounts a on a.client_id = r.client_id
          join public.trainers t on t.id = r.trainer_id
         where a.user_id = auth.uid() and a.revoked_at is null
         order by r.started_at desc nulls last
         limit 100) q), '[]'::json);
end $$;
revoke all on function public.portal_history() from public, anon;
grant execute on function public.portal_history() to authenticated;

-- A client deletes a workout they did themselves. (Workouts the trainer recorded stay with the trainer.)
create or replace function public.portal_delete_run(p_run_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_run public.runs;
begin
  if auth.uid() is null then return false; end if;
  select * into v_run from public.runs where id = p_run_id;
  if not found or not v_run.by_client or v_run.client_id is null or not public.portal_is_mine(v_run.client_id) then
    return false;
  end if;
  delete from public.runs where id = p_run_id;
  return true;
end $$;
revoke all on function public.portal_delete_run(uuid) from public, anon;
grant execute on function public.portal_delete_run(uuid) to authenticated;
