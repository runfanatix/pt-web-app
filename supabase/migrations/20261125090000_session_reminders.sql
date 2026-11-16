-- PT Planner: automatic session reminders (Phase 10b). A new migration: earlier ones are already applied.
-- Safe to run more than once.
--
-- A trainer switches reminders on and chooses how many hours before a session they go out. A scheduled job (every
-- half hour) asks claim_due_reminders() which sessions need one: it marks them as reminded and hands them to the
-- email function (send-reminders), which sends them through Resend. If an email fails the claim is released and it is
-- tried again at the next run. Each session is reminded at most once; changing a session's time makes it eligible
-- again. A client can turn reminders off for themselves in the portal, and a client with no email address gets none.

alter table public.trainers
  add column if not exists session_reminders boolean not null default false,
  add column if not exists reminder_hours integer not null default 24 check (reminder_hours between 1 and 72);

alter table public.clients
  add column if not exists reminders_off boolean not null default false;

alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

-- A session that moves is a new session as far as reminders go.
create or replace function public.bookings_reset_reminder() returns trigger
language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at then new.reminder_sent_at := null; end if;
  return new;
end $$;
drop trigger if exists bookings_reset_reminder_trg on public.bookings;
create trigger bookings_reset_reminder_trg before update on public.bookings
  for each row execute function public.bookings_reset_reminder();

-- Picks the sessions that need a reminder now and marks them as reminded, so two runs never send the same one.
-- Service role only. Returns what the email needs and nothing else.
create or replace function public.claim_due_reminders(p_now timestamptz default now()) returns json
language plpgsql security definer set search_path = public as $$
declare v_rows json;
begin
  with due as (
    select b.id
      from public.bookings b
      join public.trainers t on t.id = b.trainer_id
      join public.clients c on c.id = b.client_id
     where t.session_reminders
       and b.status = 'scheduled'
       and b.client_response <> 'declined'
       and b.reminder_sent_at is null
       and b.starts_at > p_now + interval '30 minutes'
       and b.starts_at <= p_now + make_interval(hours => t.reminder_hours)
       and not c.reminders_off
       and btrim(c.email) <> ''
     for update of b skip locked
  ), claimed as (
    update public.bookings b set reminder_sent_at = p_now from due where b.id = due.id returning b.*
  )
  select coalesce(json_agg(json_build_object(
           'id', k.id, 'title', k.title, 'starts_at', k.starts_at, 'ends_at', k.ends_at,
           'client_name', c.name, 'client_email', c.email,
           'trainer', coalesce(nullif(t.business_name, ''), t.display_name),
           'trainer_phone', t.contact_phone,
           'gym', (select nullif(btrim(g.name || ' ' || g.branch), '') from public.gyms g where g.id = k.gym_id),
           'gym_address', (select nullif(g.address, '') from public.gyms g where g.id = k.gym_id))
         order by k.starts_at), '[]'::json)
    into v_rows
    from claimed k
    join public.clients c on c.id = k.client_id
    join public.trainers t on t.id = k.trainer_id;
  return v_rows;
end $$;
revoke all on function public.claim_due_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(timestamptz) to service_role;

-- The email could not be sent: give the session back so the next run tries again.
create or replace function public.release_reminder(p_booking uuid) returns void
language sql security definer set search_path = public as $$
  update public.bookings set reminder_sent_at = null where id = p_booking;
$$;
revoke all on function public.release_reminder(uuid) from public, anon, authenticated;
grant execute on function public.release_reminder(uuid) to service_role;

-- ---------------------------------------------------------------- the client's own choice
-- For each trainer the person trains with: whether reminders are on.
create or replace function public.portal_reminder_prefs() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object(
             'client_id', c.id, 'trainer', coalesce(nullif(t.business_name, ''), t.display_name),
             'trainer_sends', t.session_reminders, 'hours', t.reminder_hours,
             'has_email', btrim(c.email) <> '', 'on', not c.reminders_off) order by t.business_name)
      from public.client_accounts a
      join public.clients c on c.id = a.client_id
      join public.trainers t on t.id = c.trainer_id
     where a.user_id = auth.uid() and a.revoked_at is null), '[]'::json);
end $$;
revoke all on function public.portal_reminder_prefs() from public, anon;
grant execute on function public.portal_reminder_prefs() to authenticated;

create or replace function public.portal_set_reminders(p_client_id uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_on is null or not public.portal_is_mine(p_client_id) then return false; end if;
  update public.clients set reminders_off = not p_on where id = p_client_id;
  return true;
end $$;
revoke all on function public.portal_set_reminders(uuid, boolean) from public, anon;
grant execute on function public.portal_set_reminders(uuid, boolean) to authenticated;
