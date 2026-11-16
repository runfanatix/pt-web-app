-- PT Planner: bookings and the calendar (Phase 10a). A new migration: earlier ones are already applied.
--
-- A trainer books in-person sessions with their clients (one-off or repeating weekly), sees them by day, week and
-- month, and marks them done, missed or cancelled. A client sees their own upcoming sessions in the portal and can
-- confirm or say they cannot make it. Times are stored as exact moments (timestamptz); the app shows them in
-- South African time. Clients have no table access: they use the functions at the bottom, which never return the
-- trainer's private notes. Safe to run more than once.

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  trainer_id      uuid not null references public.trainers (id) on delete cascade,
  client_id       uuid references public.clients (id) on delete cascade,
  gym_id          uuid references public.gyms (id) on delete set null,
  series_id       uuid,
  title           text not null default 'Training session' check (char_length(btrim(title)) between 1 and 120),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          text not null default 'scheduled' check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),
  client_response text not null default 'pending' check (client_response in ('pending', 'confirmed', 'declined')),
  cancelled_by    text check (cancelled_by in ('trainer', 'client')),
  notes           text not null default '' check (char_length(notes) <= 1000),
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours')
);
create index if not exists bookings_trainer_time_idx on public.bookings (trainer_id, starts_at);
create index if not exists bookings_client_idx on public.bookings (client_id, starts_at);
create index if not exists bookings_series_idx on public.bookings (series_id);

alter table public.bookings enable row level security;

-- a trainer manages their own bookings, and only for their own clients and gyms
drop policy if exists bookings_all on public.bookings;
create policy bookings_all on public.bookings for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id()
              and (client_id is null or public.owns_client(client_id))
              and (gym_id is null or public.owns_gym(gym_id)));

revoke all on public.bookings from anon;
grant select, insert, update, delete on public.bookings to authenticated;

-- ---------------------------------------------------------------- what a client may do
-- The person's own sessions: coming up (not cancelled) and the last few weeks. Never the trainer's notes.
create or replace function public.portal_bookings() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', b.id, 'client_id', b.client_id, 'title', b.title, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
             'status', b.status, 'client_response', b.client_response, 'cancelled_by', b.cancelled_by,
             'gym', (select nullif(btrim(g.name || ' ' || g.branch), '') from public.gyms g where g.id = b.gym_id),
             'gym_address', (select nullif(g.address, '') from public.gyms g where g.id = b.gym_id),
             'trainer', t.business_name)
           order by b.starts_at)
      from public.bookings b
      join public.client_accounts a on a.client_id = b.client_id
      join public.trainers t on t.id = b.trainer_id
     where a.user_id = auth.uid() and a.revoked_at is null
       and b.starts_at > now() - interval '60 days'
       and b.starts_at < now() + interval '400 days'), '[]'::json);
end $$;
revoke all on function public.portal_bookings() from public, anon;
grant execute on function public.portal_bookings() to authenticated;

-- A client says they will be there, or cannot make it. Only for a session that has not happened and is not cancelled.
create or replace function public.portal_respond_booking(p_booking_id uuid, p_response text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_b public.bookings;
begin
  if auth.uid() is null or p_response not in ('confirmed', 'declined') then return false; end if;
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or v_b.client_id is null or not public.portal_is_mine(v_b.client_id) then return false; end if;
  if v_b.status <> 'scheduled' or v_b.starts_at <= now() then return false; end if;
  update public.bookings set client_response = p_response where id = p_booking_id;
  return true;
end $$;
revoke all on function public.portal_respond_booking(uuid, text) from public, anon;
grant execute on function public.portal_respond_booking(uuid, text) to authenticated;
