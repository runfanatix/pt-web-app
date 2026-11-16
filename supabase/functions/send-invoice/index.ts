// Emails a client their invoice through Resend (https://resend.com).
//
//   supabase functions deploy send-invoice
//   supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="PT Planner <invoices@yourdomain.com>" APP_URL=https://your-app.example
//
// The trainer's app calls it with an invoice id. It runs AS the trainer (their sign-in token is passed on), so
// row-level security decides whether that invoice is theirs. It also has a second way in, for the scheduled job that
// emails invoices the automatic run has queued: call it with { "queued": true } and the service role key.
// Setup steps: docs/11-invoicing.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { invoiceEmail } from '../_shared/invoice-email.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const rand = (cents: number) => {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}R${whole},${String(abs % 100).padStart(2, '0')}`;
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};

// deno-lint-ignore no-explicit-any
async function sendOne(
  sb: any,
  inv: any,
  trainer: any,
  appUrl: string,
  key: string,
  from: string,
): Promise<boolean> {
  if (!inv.client_email) return false;
  const mail = invoiceEmail({
    trainerName: trainer?.business_name || trainer?.display_name || '',
    clientName: inv.client_name,
    number: inv.number,
    monthLabel: `${MONTHS[Number(String(inv.period_start).slice(5, 7)) - 1]} ${String(inv.period_start).slice(0, 4)}`,
    total: rand(inv.total_cents),
    due: longDate(inv.due_on),
    // deno-lint-ignore no-explicit-any
    lines: (inv.invoice_lines ?? []).map((l: any) => ({
      description: l.description,
      amount: rand(l.amount_cents),
    })),
    bankDetails: trainer?.bank_details ?? '',
    paymentLink: trainer?.payment_link ?? '',
    terms: trainer?.invoice_terms ?? '',
    portalUrl: `${appUrl}/portal`,
    productName: Deno.env.get('PRODUCT_NAME') ?? 'PT Planner',
  });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [inv.client_email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) return false;
  await sb
    .from('invoices')
    .update({ emailed_at: new Date().toISOString(), email_queued_at: null })
    .eq('id', inv.id);
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  if (!key || !from || !appUrl)
    return reply(503, { error: 'Email is not set up yet (RESEND_API_KEY, MAIL_FROM, APP_URL).' });
  const auth = req.headers.get('Authorization');
  if (!auth) return reply(401, { error: 'Sign in first.' });

  let body: { invoiceId?: string; queued?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send the invoice id.' });
  }
  const select =
    'id, client_name, client_email, number, period_start, due_on, status, total_cents, trainer_id, invoice_lines(description, amount_cents, position)';
  const trainerSelect = 'business_name, display_name, bank_details, payment_link, invoice_terms';

  // The scheduled job: everything the automatic run has marked sent and not yet emailed. Needs the service role key.
  if (body.queued) {
    if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`)
      return reply(403, { error: 'Not allowed.' });
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: queued } = await sb
      .from('invoices')
      .select(select)
      .eq('status', 'sent')
      .not('email_queued_at', 'is', null)
      .is('emailed_at', null)
      .limit(100);
    let sent = 0;
    for (const inv of queued ?? []) {
      const { data: trainer } = await sb
        .from('trainers')
        .select(trainerSelect)
        .eq('id', inv.trainer_id)
        .maybeSingle();
      if (await sendOne(sb, inv, trainer, appUrl, key, from)) sent += 1;
    }
    return reply(200, { sent: true, count: sent });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: inv } = await sb
    .from('invoices')
    .select(select)
    .eq('id', String(body.invoiceId ?? ''))
    .maybeSingle();
  if (!inv || (inv.status !== 'sent' && inv.status !== 'paid'))
    return reply(404, { error: 'That invoice is not available.' });
  const { data: trainer } = await sb.from('trainers').select(trainerSelect).limit(1).maybeSingle();
  const ok = await sendOne(sb, inv, trainer, appUrl, key, from);
  return ok ? reply(200, { sent: true }) : reply(502, { error: 'The email could not be sent.' });
});
