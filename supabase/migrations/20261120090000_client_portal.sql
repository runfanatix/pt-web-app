-- PT Planner: the client portal (Phase 9a). A new migration: earlier ones are already applied.
--
-- A trainer invites a client by email. The client signs in with an emailed link (Supabase Auth). The first time
-- they open the portal, every valid invite for their VERIFIED email is claimed: that links their sign-in to the
-- client record(s) the invites were for. A person can be a client of several trainers: each trainer has their own
-- client record, and one sign-in can be linked to all of them.
--
-- Clients get NO direct access to any table. They can only call the functions below, which return the safe parts
-- of their own records (never private notes, never another client's data, never the trainer's other clients).
-- A trainer switches access off with client_accounts.revoked_at or client_invites.revoked_at.
--
-- Sign-ups with user metadata role = 'client' do not get a trainer account.

-- ---------------------------------------------------------------- no trainer account for a client sign-in
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trainer uuid;
begin
  if new.raw_user_meta_data ->> 'role' = 'client' then
    return new;
  end if;
  insert into public.trainers (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  returning id into v_trainer;
  if new.raw_user_meta_data ->> 'privacy_notice_version' is not null then
    insert into public.consents (trainer_id, subject, purpose, notice_version)
    values (v_trainer, 'trainer', 'privacy-notice', left(new.raw_user_meta_data ->> 'privacy_notice_version', 40));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- invites and accounts
create table public.client_invites (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references public.trainers (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  email       text not null check (char_length(email) between 3 and 160 and email = lower(btrim(email))),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  emailed_at  timestamptz,
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create index client_invites_client_idx on public.client_invites (client_id);
create index client_invites_email_idx on public.client_invites (email);

create table public.client_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, client_id)
);
create index client_accounts_client_idx on public.client_accounts (client_id);

alter table public.client_invites  enable row level security;
alter table public.client_accounts enable row level security;

-- a trainer manages invites and accounts for their own clients only; a client has no policy, so no table access
create policy client_invites_all on public.client_invites for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id() and public.owns_client(client_id));
create policy client_accounts_select on public.client_accounts for select to authenticated
  using (public.owns_client(client_id));
create policy client_accounts_update on public.client_accounts for update to authenticated
  using (public.owns_client(client_id)) with check (public.owns_client(client_id));

revoke all on public.client_invites, public.client_accounts from anon;
grant select, insert, update, delete on public.client_invites to authenticated;
grant select, update on public.client_accounts to authenticated;

-- ---------------------------------------------------------------- the one programme description
-- Shared by the public link and the portal, so both show exactly the same safe fields. Internal: not callable
-- by anyone but the functions below.
create or replace function public.programme_json(p_programme_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_prog    public.programmes;
  v_trainer text;
begin
  select * into v_prog from public.programmes where id = p_programme_id;
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
revoke all on function public.programme_json(uuid) from public, anon, authenticated;

-- the public link now uses the shared description (same answers as before: the earlier tests still apply)
create or replace function public.get_shared_programme(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_link public.share_links;
begin
  if p_token is null or char_length(p_token) < 16 then return null; end if;
  select * into v_link from public.share_links where token = p_token;
  if not found then return null; end if;
  if v_link.revoked_at is not null then return null; end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then return null; end if;
  return public.programme_json(v_link.programme_id);
end $$;
revoke all on function public.get_shared_programme(text) from public;
grant execute on function public.get_shared_programme(text) to anon, authenticated;

-- ---------------------------------------------------------------- what a signed-in client may do
-- The signed-in person's verified email, or null.
create or replace function public.portal_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(btrim(u.email)) from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.portal_email() from public, anon, authenticated;

-- Links this sign-in to every valid invite for its verified email. Safe to call as often as you like.
create or replace function public.portal_claim() returns integer
language plpgsql security definer set search_path = public as $$
declare v_email text := public.portal_email(); v_n integer := 0; r record;
begin
  if auth.uid() is null or v_email is null then return 0; end if;
  for r in
    select * from public.client_invites
     where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()
  loop
    insert into public.client_accounts (user_id, client_id)
    values (auth.uid(), r.client_id)
    on conflict (user_id, client_id) do update set revoked_at = null;
    update public.client_invites set accepted_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.portal_claim() from public, anon;
grant execute on function public.portal_claim() to authenticated;

-- Everything the portal's home screen shows: for each trainer the person trains with, the trainer's business
-- details, the programmes assigned to them, and what they have consented to.
create or replace function public.portal_overview() returns json
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  perform public.portal_claim();
  return json_build_object(
    'email', public.portal_email(),
    'memberships', coalesce((
      select json_agg(json_build_object(
        'client_id', c.id,
        'client_name', c.name,
        'trainer', json_build_object(
          'business_name', t.business_name, 'display_name', t.display_name, 'address', t.address,
          'contact_email', t.contact_email, 'contact_phone', t.contact_phone,
          'information_officer_name', t.information_officer_name,
          'information_officer_email', t.information_officer_email),
        'programmes', coalesce((
          select json_agg(json_build_object(
                   'id', p.id, 'title', p.title, 'assigned_at', p.assigned_at,
                   'gym', (select nullif(btrim(g.name || ' ' || g.branch), '') from public.gyms g where g.id = p.gym_id),
                   'exercises', (select count(*) from public.programme_items i where i.programme_id = p.id))
                 order by p.assigned_at desc)
            from public.programmes p where p.client_id = c.id), '[]'::json),
        'consents', coalesce((
          select json_agg(json_build_object(
                   'purpose', k.purpose, 'detail', k.detail, 'granted', k.granted,
                   'at', k.granted_at, 'notice_version', k.notice_version)
                 order by k.purpose, k.detail)
            from (select distinct on (purpose, detail) purpose, detail, granted, granted_at, notice_version
                    from public.consents where client_id = c.id and subject = 'client'
                   order by purpose, detail, granted_at desc) k), '[]'::json)
      ) order by t.business_name, c.created_at)
        from public.client_accounts a
        join public.clients c on c.id = a.client_id
        join public.trainers t on t.id = c.trainer_id
       where a.user_id = auth.uid() and a.revoked_at is null), '[]'::json)
  );
end $$;
revoke all on function public.portal_overview() from public, anon;
grant execute on function public.portal_overview() to authenticated;

-- One of the person's own programmes, with the gym plan: the same description the public link gives.
create or replace function public.portal_programme(p_programme_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if not exists (
    select 1 from public.programmes p
      join public.client_accounts a on a.client_id = p.client_id
     where p.id = p_programme_id and a.user_id = auth.uid() and a.revoked_at is null
  ) then return null; end if;
  return public.programme_json(p_programme_id);
end $$;
revoke all on function public.portal_programme(uuid) from public, anon;
grant execute on function public.portal_programme(uuid) to authenticated;

create or replace function public.portal_is_mine(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_accounts a
                  where a.client_id = p_client_id and a.user_id = auth.uid() and a.revoked_at is null)
$$;
revoke all on function public.portal_is_mine(uuid) from public, anon, authenticated;

-- A client withdraws one of their consents. Consent records are append-only, so this adds a "no" and logs a
-- consent-withdrawal request for the trainer to see.
create or replace function public.portal_withdraw_consent(p_client_id uuid, p_purpose text, p_detail text default '')
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_last public.consents; v_client public.clients;
begin
  if not public.portal_is_mine(p_client_id) then return false; end if;
  select * into v_client from public.clients where id = p_client_id;
  select * into v_last from public.consents
   where client_id = p_client_id and subject = 'client' and purpose = p_purpose and detail = coalesce(p_detail, '')
   order by granted_at desc limit 1;
  if not found or not v_last.granted then return false; end if;
  insert into public.consents (trainer_id, client_id, subject, purpose, notice_version, granted, detail, wording)
  values (v_client.trainer_id, p_client_id, 'client', p_purpose, v_last.notice_version, false,
          coalesce(p_detail, ''), 'Withdrawn by the client in their own portal.');
  insert into public.data_requests (trainer_id, client_id, client_name, kind, completed_at, outcome)
  values (v_client.trainer_id, p_client_id, v_client.name, 'consent-withdrawal', now(),
          'Withdrawn by the client in the portal: ' || p_purpose);
  return true;
end $$;
revoke all on function public.portal_withdraw_consent(uuid, text, text) from public, anon;
grant execute on function public.portal_withdraw_consent(uuid, text, text) to authenticated;

-- A client asks their trainer to give them their information, correct it, delete it, or stop using it.
create or replace function public.portal_request(p_client_id uuid, p_kind text, p_note text default '')
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client public.clients;
begin
  if p_kind not in ('access', 'correction', 'deletion', 'objection') then return false; end if;
  if not public.portal_is_mine(p_client_id) then return false; end if;
  select * into v_client from public.clients where id = p_client_id;
  insert into public.data_requests (trainer_id, client_id, client_name, kind, outcome)
  values (v_client.trainer_id, p_client_id, v_client.name, p_kind,
          'Asked by the client in the portal. ' || left(coalesce(p_note, ''), 800));
  return true;
end $$;
revoke all on function public.portal_request(uuid, text, text) from public, anon;
grant execute on function public.portal_request(uuid, text, text) to authenticated;
