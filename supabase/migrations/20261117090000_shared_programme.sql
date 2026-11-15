-- PT Planner: the public client page (Phase 5). A new migration: earlier ones are already applied.
--
-- A client opens https://<app>/p/<token> without logging in. The page cannot read tables (anonymous visitors have no
-- table access, by design); it calls this one function with the token. The function returns ONLY the programme,
-- the trainer's business name, the gym name and the gym's layout. It never returns the client's name, contact details,
-- goals, private notes, consent records or anything else about them, and equipment notes are blanked.
--
-- A token that does not exist, was revoked, or has expired returns null. Tokens are 256 random bits, so they cannot
-- be guessed; a trainer revokes one by setting share_links.revoked_at.

create function public.get_shared_programme(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_link    public.share_links;
  v_prog    public.programmes;
  v_trainer text;
begin
  if p_token is null or char_length(p_token) < 16 then return null; end if;

  select * into v_link from public.share_links where token = p_token;
  if not found then return null; end if;
  if v_link.revoked_at is not null then return null; end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then return null; end if;

  select * into v_prog from public.programmes where id = v_link.programme_id;
  if not found then return null; end if;

  select t.business_name into v_trainer
    from public.trainers t join public.clients c on c.trainer_id = t.id
   where c.id = v_prog.client_id;

  return json_build_object(
    'title',       v_prog.title,
    'notes',       v_prog.notes,
    'assigned_at', v_prog.assigned_at,
    'trainer',     coalesce(v_trainer, ''),
    'gym', (select json_build_object('name', g.name, 'branch', g.branch, 'address', g.address)
              from public.gyms g where g.id = v_prog.gym_id),
    'items', coalesce((
      select json_agg(json_build_object(
               'position', i.position, 'equipment_id', i.equipment_id, 'exercise_name', i.exercise_name,
               'sets', i.sets, 'reps', i.reps, 'rest', i.rest, 'note', i.note, 'cue', coalesce(x.cue, ''))
             order by i.position)
        from public.programme_items i
        left join public.exercises x on x.id = i.exercise_id
       where i.programme_id = v_prog.id), '[]'::json),
    'floors', coalesce((
      select json_agg(q.floor_json order by q.position)
        from (
          select f.position,
                 json_build_object(
                   'id', f.id, 'name', f.name, 'w', f.w, 'h', f.h, 'position', f.position,
                   'zones', coalesce((
                     select json_agg(json_build_object(
                              'id', z.id, 'name', z.name, 'category', z.category,
                              'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h,
                              'zone_parts', coalesce((
                                select json_agg(json_build_object('x', p.x, 'y', p.y, 'w', p.w, 'h', p.h, 'position', p.position))
                                  from public.zone_parts p where p.zone_id = z.id), '[]'::json),
                              'equipment', coalesce((
                                select json_agg(json_build_object(
                                         'id', e.id, 'name', e.name, 'type', e.type, 'x', e.x, 'y', e.y,
                                         'muscles', e.muscles, 'notes', ''))
                                  from public.equipment e where e.zone_id = z.id), '[]'::json)))
                       from public.zones z where z.floor_id = f.id), '[]'::json),
                   'structs', coalesce((
                     select json_agg(json_build_object(
                              'id', s.id, 'type', s.type, 'x', s.x, 'y', s.y, 'w', s.w, 'h', s.h,
                              'x2', s.x2, 'y2', s.y2, 'rotation', s.rotation, 'label', s.label, 'shared', s.shared))
                       from public.structs s where s.floor_id = f.id), '[]'::json)
                 ) as floor_json
            from public.floors f where f.gym_id = v_prog.gym_id
        ) q), '[]'::json)
  );
end $$;

revoke all on function public.get_shared_programme(text) from public;
grant execute on function public.get_shared_programme(text) to anon, authenticated;
