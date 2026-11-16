-- PT Planner: online payments (Phase 11b). A new migration: earlier ones are already applied. Safe to run more than once.
--
-- A client can pay an invoice online through the trainer's own PayFast account (more providers can be added later:
-- `provider` says which). The trainer keeps their own PayFast keys here. Only the trainer can read or change them;
-- clients and visitors cannot, and they never reach the browser of anyone else. The money goes straight from the
-- client to the trainer's PayFast account: this app never touches it.
--
-- PayFast tells our server a payment succeeded (an "ITN"). The server checks it is genuine, then calls
-- record_online_payment, which marks the invoice paid, once, only if the amount is exactly what was owed.

create table if not exists public.payment_settings (
  trainer_id  uuid primary key references public.trainers (id) on delete cascade,
  provider    text not null default 'payfast' check (provider in ('payfast')),
  enabled     boolean not null default false,
  sandbox     boolean not null default true,
  merchant_id text not null default '' check (char_length(merchant_id) <= 40),
  merchant_key text not null default '' check (char_length(merchant_key) <= 80),
  passphrase  text not null default '' check (char_length(passphrase) <= 100),
  updated_at  timestamptz not null default now()
);

alter table public.payment_settings enable row level security;
drop policy if exists payment_settings_all on public.payment_settings;
create policy payment_settings_all on public.payment_settings for all to authenticated
  using (trainer_id = public.current_trainer_id())
  with check (trainer_id = public.current_trainer_id());
revoke all on public.payment_settings from anon;
grant select, insert, update, delete on public.payment_settings to authenticated;

-- Every payment the provider confirmed (or that did not match), kept as a record. One row per provider payment.
create table if not exists public.invoice_payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  trainer_id   uuid not null references public.trainers (id) on delete cascade,
  provider     text not null,
  provider_ref text not null check (char_length(provider_ref) between 1 and 80),
  amount_cents integer not null,
  outcome      text not null check (outcome in ('paid', 'amount_mismatch', 'not_payable')),
  received_at  timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;
drop policy if exists invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (trainer_id = public.current_trainer_id());
revoke all on public.invoice_payments from anon;
grant select on public.invoice_payments to authenticated;

-- Called by the payment-notification server (service role only). Marks the invoice paid when the money received is
-- exactly the invoice total and the invoice is still waiting to be paid. The same payment reported twice does nothing.
-- Returns what happened: 'paid', 'already_recorded', 'amount_mismatch' or 'not_payable'.
create or replace function public.record_online_payment(p_invoice uuid, p_provider text, p_ref text, p_amount_cents integer)
returns text
language plpgsql security definer set search_path = public as $$
declare v_inv public.invoices; v_outcome text;
begin
  if exists (select 1 from public.invoice_payments where provider = p_provider and provider_ref = p_ref) then
    return 'already_recorded';
  end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then return 'not_payable'; end if;
  if v_inv.status <> 'sent' then
    v_outcome := 'not_payable';
  elsif v_inv.total_cents <> p_amount_cents then
    v_outcome := 'amount_mismatch';
  else
    v_outcome := 'paid';
    update public.invoices set status = 'paid', paid_at = now(), paid_method = 'card' where id = p_invoice;
  end if;
  insert into public.invoice_payments (invoice_id, trainer_id, provider, provider_ref, amount_cents, outcome)
  values (p_invoice, v_inv.trainer_id, p_provider, p_ref, p_amount_cents, v_outcome);
  return v_outcome;
end $$;
revoke all on function public.record_online_payment(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_online_payment(uuid, text, text, integer) to service_role;

-- The client's invoices now also say whether the trainer takes online payment (never anything about the keys).
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
             'pay_online', exists (select 1 from public.payment_settings ps
                                    where ps.trainer_id = i.trainer_id and ps.enabled
                                      and ps.merchant_id <> '' and ps.merchant_key <> ''),
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
