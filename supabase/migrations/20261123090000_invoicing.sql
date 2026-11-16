-- PT Planner: invoicing (Phase 11a). A new migration: earlier ones are already applied. Safe to run more than once.
--
-- Clients are billed monthly IN ADVANCE: once the next month's sessions are in the calendar, an invoice is made for
-- them (by the trainer pressing Generate, or automatically near the end of the month by run_auto_invoicing()). The
-- invoice counts that client's booked sessions in that month at their rate. Amounts are whole cents (South African rand).
-- Nothing here takes payment: the invoice carries the trainer's bank details and an optional payment link, and the
-- trainer marks it paid. Clients see their own sent and paid invoices through portal_invoices() and nothing else.

-- ---------------------------------------------------------------- settings and rates
alter table public.trainers
  add column if not exists default_rate_cents integer check (default_rate_cents between 0 and 10000000),
  add column if not exists vat_percent numeric(5,2) not null default 0 check (vat_percent between 0 and 100),
  add column if not exists invoice_prefix text not null default 'INV'
    check (char_length(invoice_prefix) between 1 and 10 and invoice_prefix ~ '^[A-Za-z0-9-]+$'),
  add column if not exists bank_details text not null default '' check (char_length(bank_details) <= 600),
  add column if not exists payment_link text not null default '' check (char_length(payment_link) <= 300),
  add column if not exists invoice_terms text not null default '' check (char_length(invoice_terms) <= 600),
  add column if not exists auto_invoice boolean not null default false,
  add column if not exists invoice_days_before integer not null default 5 check (invoice_days_before between 0 and 25),
  add column if not exists auto_send boolean not null default false;

alter table public.clients
  add column if not exists rate_cents integer check (rate_cents between 0 and 10000000);

-- ---------------------------------------------------------------- invoices
-- A client erased under POPIA leaves the invoice behind (tax records are kept for five years) with the name and
-- email as they were; client_id becomes null.
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  trainer_id       uuid not null references public.trainers (id) on delete cascade,
  client_id        uuid references public.clients (id) on delete set null,
  client_name      text not null default '' check (char_length(client_name) <= 120),
  client_email     text not null default '' check (char_length(client_email) <= 160),
  number           text not null check (char_length(number) between 1 and 40),
  period_start     date not null check (extract(day from period_start) = 1),
  issued_on        date not null,
  due_on           date not null,
  status           text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  vat_percent      numeric(5,2) not null default 0,
  subtotal_cents   integer not null default 0,
  vat_cents        integer not null default 0,
  total_cents      integer not null default 0,
  notes            text not null default '' check (char_length(notes) <= 1000),
  auto_generated   boolean not null default false,
  email_queued_at  timestamptz,
  emailed_at       timestamptz,
  paid_at          timestamptz,
  paid_method      text check (paid_method in ('eft', 'cash', 'card', 'other')),
  created_at       timestamptz not null default now(),
  unique (trainer_id, number)
);
create unique index if not exists invoices_one_per_month_idx
  on public.invoices (client_id, period_start) where status <> 'void' and client_id is not null;
create index if not exists invoices_trainer_month_idx on public.invoices (trainer_id, period_start);
create index if not exists invoices_client_idx on public.invoices (client_id);

create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  position     integer not null default 0,
  description  text not null check (char_length(btrim(description)) between 1 and 300),
  quantity     numeric(8,2) not null default 1 check (quantity >= 0 and quantity <= 9999),
  unit_cents   integer not null default 0 check (unit_cents between -10000000 and 10000000),
  amount_cents integer not null default 0
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;

drop policy if exists invoices_all on public.invoices;
create policy invoices_all on public.invoices for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id() and (client_id is null or public.owns_client(client_id)));

drop policy if exists invoice_lines_all on public.invoice_lines;
create policy invoice_lines_all on public.invoice_lines for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.trainer_id = public.current_trainer_id()))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.trainer_id = public.current_trainer_id()));

revoke all on public.invoices, public.invoice_lines from anon;
grant select, insert, update, delete on public.invoices, public.invoice_lines to authenticated;

-- A line's amount is always quantity x unit price; an invoice's totals always follow its lines; and only a draft's
-- lines can change (once an invoice is sent, void it and make a new one).
create or replace function public.invoice_lines_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.invoice_id, old.invoice_id); v_status text;
begin
  select status into v_status from public.invoices where id = v_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Only a draft invoice can be changed.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.amount_cents := round(new.quantity * new.unit_cents);
  return new;
end $$;
drop trigger if exists invoice_lines_guard_trg on public.invoice_lines;
create trigger invoice_lines_guard_trg before insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_guard();

create or replace function public.invoice_lines_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
     set subtotal_cents = s.sub,
         vat_cents = round(s.sub * i.vat_percent / 100),
         total_cents = s.sub + round(s.sub * i.vat_percent / 100)
    from (select coalesce(sum(amount_cents), 0)::integer as sub from public.invoice_lines where invoice_id = v_id) s
   where i.id = v_id;
  return null;
end $$;
drop trigger if exists invoice_lines_totals_trg on public.invoice_lines;
create trigger invoice_lines_totals_trg after insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_totals();

-- ---------------------------------------------------------------- making the month's invoices
-- South African date of a moment.
create or replace function public.sast_date(p timestamptz) returns date
language sql immutable as $$ select (p at time zone 'Africa/Johannesburg')::date $$;

-- Makes one invoice per client who has sessions booked in the month and no live invoice for it yet.
-- Counts scheduled and completed sessions (not cancelled or missed ones). Returns what it did.
create or replace function public.gen_invoices_for(p_trainer uuid, p_month date, p_today date, p_auto boolean)
returns json
language plpgsql security definer set search_path = public as $$
declare
  t         public.trainers;
  c         record;
  v_start   date := date_trunc('month', p_month)::date;
  v_end     date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_n       integer;
  v_rate    integer;
  v_inv     uuid;
  v_seq     integer;
  v_number  text;
  v_issued  date := p_today;
  v_send    boolean;
  v_made    uuid[] := '{}';
  v_norate  text[] := '{}';
  v_exists  integer := 0;
  v_empty   integer := 0;
  v_dates   text;
  g         record;
begin
  select * into t from public.trainers where id = p_trainer;
  if not found then return null; end if;
  v_send := p_auto and t.auto_send;

  for c in select * from public.clients where trainer_id = p_trainer order by name loop
    select count(*) into v_n from public.bookings b
     where b.client_id = c.id and b.status in ('scheduled', 'completed')
       and public.sast_date(b.starts_at) >= v_start and public.sast_date(b.starts_at) < v_end;
    if v_n = 0 then v_empty := v_empty + 1; continue; end if;
    if exists (select 1 from public.invoices i where i.client_id = c.id and i.period_start = v_start and i.status <> 'void') then
      v_exists := v_exists + 1; continue;
    end if;
    v_rate := coalesce(c.rate_cents, t.default_rate_cents);
    if v_rate is null then v_norate := v_norate || c.name; continue; end if;

    select coalesce(max((substring(number from '(\d+)$'))::int), 0) + 1 into v_seq
      from public.invoices where trainer_id = p_trainer and number like t.invoice_prefix || '-' || to_char(v_start, 'YYYYMM') || '-%';
    v_number := t.invoice_prefix || '-' || to_char(v_start, 'YYYYMM') || '-' || lpad(v_seq::text, 3, '0');

    select string_agg(to_char(public.sast_date(b.starts_at), 'FMDD Mon') || ' ' || to_char(b.starts_at at time zone 'Africa/Johannesburg', 'HH24:MI'), ', ' order by b.starts_at)
      into v_dates from public.bookings b
     where b.client_id = c.id and b.status in ('scheduled', 'completed')
       and public.sast_date(b.starts_at) >= v_start and public.sast_date(b.starts_at) < v_end;

    insert into public.invoices (trainer_id, client_id, client_name, client_email, number, period_start, issued_on, due_on,
                                 status, vat_percent, notes, auto_generated, email_queued_at)
    values (p_trainer, c.id, c.name, c.email, v_number, v_start, v_issued, greatest(v_start, v_issued), 'draft', t.vat_percent,
            left('Sessions: ' || v_dates, 1000), p_auto, null)
    returning id into v_inv;

    -- one line per kind of session (by title), at the client's rate
    for g in
      select b.title, count(*) as qty from public.bookings b
       where b.client_id = c.id and b.status in ('scheduled', 'completed')
         and public.sast_date(b.starts_at) >= v_start and public.sast_date(b.starts_at) < v_end
       group by b.title order by min(b.starts_at)
    loop
      insert into public.invoice_lines (invoice_id, position, description, quantity, unit_cents)
      values (v_inv, coalesce((select max(position) + 1 from public.invoice_lines where invoice_id = v_inv), 0),
              left(g.title || ', ' || to_char(v_start, 'FMMonth YYYY'), 300), g.qty, v_rate);
    end loop;

    if v_send then
      update public.invoices set status = 'sent', email_queued_at = now() where id = v_inv;
    end if;
    v_made := v_made || v_inv;
  end loop;

  return json_build_object(
    'month', v_start, 'generated', coalesce(array_length(v_made, 1), 0), 'invoice_ids', v_made,
    'skipped_no_rate', v_norate, 'skipped_existing', v_exists, 'skipped_no_sessions', v_empty);
end $$;
revoke all on function public.gen_invoices_for(uuid, date, date, boolean) from public, anon, authenticated;

-- The trainer's button: make this month's invoices for their own clients.
create or replace function public.generate_invoices(p_month date) returns json
language plpgsql security definer set search_path = public as $$
declare v_trainer uuid := public.current_trainer_id();
begin
  if v_trainer is null then raise exception 'Sign in as a trainer.' using errcode = '42501'; end if;
  return public.gen_invoices_for(v_trainer, p_month, public.sast_date(now()), false);
end $$;
revoke all on function public.generate_invoices(date) from public, anon;
grant execute on function public.generate_invoices(date) to authenticated;

-- The scheduled job: for each trainer who switched automatic invoicing on, once it is `invoice_days_before` days
-- before the end of the month (or later in the month, if a run was missed) make next month's invoices. It does
-- nothing twice. Run it daily; see docs/11-invoicing.md for the one line that schedules it.
create or replace function public.run_auto_invoicing(p_today date default public.sast_date(now())) returns json
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_next date := (date_trunc('month', p_today) + interval '1 month')::date;
  v_out json[] := '{}';
begin
  for t in select id, invoice_days_before from public.trainers where auto_invoice loop
    if p_today >= (v_next - 1) - t.invoice_days_before then
      v_out := v_out || public.gen_invoices_for(t.id, v_next, p_today, true);
    end if;
  end loop;
  return to_json(v_out);
end $$;
revoke all on function public.run_auto_invoicing(date) from public, anon, authenticated;

-- ---------------------------------------------------------------- what a client may see
-- Their own invoices that have been sent or paid (never drafts or voided ones), with the lines and where to pay.
create or replace function public.portal_invoices() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', i.id, 'client_id', i.client_id, 'number', i.number, 'period_start', i.period_start,
             'issued_on', i.issued_on, 'due_on', i.due_on, 'status', i.status, 'vat_percent', i.vat_percent,
             'subtotal_cents', i.subtotal_cents, 'vat_cents', i.vat_cents, 'total_cents', i.total_cents,
             'notes', i.notes, 'paid_at', i.paid_at,
             'trainer', json_build_object(
               'business_name', t.business_name, 'address', t.address, 'contact_email', t.contact_email,
               'contact_phone', t.contact_phone, 'bank_details', t.bank_details, 'payment_link', t.payment_link,
               'terms', t.invoice_terms),
             'lines', coalesce((select json_agg(json_build_object(
                         'description', l.description, 'quantity', l.quantity, 'unit_cents', l.unit_cents,
                         'amount_cents', l.amount_cents) order by l.position)
                        from public.invoice_lines l where l.invoice_id = i.id), '[]'::json))
           order by i.period_start desc, i.number)
      from public.invoices i
      join public.client_accounts a on a.client_id = i.client_id
      join public.trainers t on t.id = i.trainer_id
     where a.user_id = auth.uid() and a.revoked_at is null and i.status in ('sent', 'paid')), '[]'::json);
end $$;
revoke all on function public.portal_invoices() from public, anon;
grant execute on function public.portal_invoices() to authenticated;
