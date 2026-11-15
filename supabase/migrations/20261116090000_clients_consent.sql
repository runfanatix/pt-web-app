-- PT Planner: clients, consent records and data-subject requests (Phase 5, POPIA).
-- This is a NEW migration: the earlier ones are already applied to the live project and must not change.

-- ---------------------------------------------------------------- trainer business details
-- Used to fill in the privacy notice the trainer's clients read (who the responsible party is, how to reach them,
-- who the Information Officer is). Empty until the trainer fills them in.
alter table public.trainers
  add column business_name text not null default '' check (char_length(business_name) <= 120),
  add column address text not null default '' check (char_length(address) <= 300),
  add column contact_email text not null default '' check (char_length(contact_email) <= 160),
  add column contact_phone text not null default '' check (char_length(contact_phone) <= 40),
  add column information_officer_name text not null default '' check (char_length(information_officer_name) <= 120),
  add column information_officer_email text not null default '' check (char_length(information_officer_email) <= 160),
  add column payment_provider text not null default '' check (char_length(payment_provider) <= 120),
  add column messaging_provider text not null default '' check (char_length(messaging_provider) <= 120),
  add column studio_name text not null default '' check (char_length(studio_name) <= 120);

-- ---------------------------------------------------------------- clients
alter table public.clients
  add column date_of_birth date,                                    -- decides whether a guardian must consent
  add column guardian_name text not null default '' check (char_length(guardian_name) <= 120),
  add column retention_until date;                                  -- flagged for deletion or de-identification after this

-- ---------------------------------------------------------------- consent records: append-only
-- One row per client per consent type per change. A withdrawal is a NEW row with granted = false: rows are never
-- overwritten or deleted by a trainer, so what a client agreed to, and when, can always be shown.
-- A consent's current state is its latest row for (client_id, purpose, detail).
alter table public.consents drop column withdrawn_at;
alter table public.consents
  add column granted boolean not null default true,
  add column detail  text not null default '' check (char_length(detail) <= 120),   -- e.g. the person data is shared with
  add column wording text not null default '' check (char_length(wording) <= 12000); -- the exact text the person saw

drop policy consents_update on public.consents;
revoke update on public.consents from authenticated;
create index consents_lookup_idx on public.consents (client_id, purpose, detail, granted_at desc);

-- ---------------------------------------------------------------- data-subject requests (access, correction, deletion)
create table public.data_requests (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   uuid not null references public.trainers (id) on delete cascade,
  client_id    uuid references public.clients (id) on delete set null,
  client_name  text not null default '' check (char_length(client_name) <= 120),
  kind         text not null check (kind in ('access','correction','deletion','consent-withdrawal','objection')),
  received_at  timestamptz not null default now(),
  completed_at timestamptz,
  outcome      text not null default '' check (char_length(outcome) <= 1000)
);
create index data_requests_trainer_idx on public.data_requests (trainer_id, received_at desc);

alter table public.data_requests enable row level security;
create policy data_requests_all on public.data_requests for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id() and (client_id is null or public.owns_client(client_id)));

revoke all on public.data_requests from anon;
grant select, insert, update, delete on public.data_requests to authenticated;
