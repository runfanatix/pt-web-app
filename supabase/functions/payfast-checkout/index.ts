// Makes the signed PayFast payment form for one of the signed-in client's invoices.
//
//   supabase functions deploy payfast-checkout
//
// The client's browser calls this with an invoice id. It first asks the database (as the client, so row-level rules
// apply) whether that invoice is theirs, is waiting to be paid, and the trainer takes online payment. Only then does it
// read the trainer's PayFast keys (with the service role: no client can) and sign the form. The passphrase never
// leaves the server; the browser only gets the finished form to post to PayFast. Setup: docs/12-go-live.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkoutForm } from '../_shared/payfast.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth) return reply(401, { error: 'Sign in first.' });
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!appUrl || !url || !serviceKey)
    return reply(503, { error: 'Online payment is not set up yet (APP_URL).' });

  let invoiceId = '';
  try {
    invoiceId = String((await req.json()).invoiceId ?? '');
  } catch {
    return reply(400, { error: 'Send the invoice id.' });
  }

  // as the client: is this their invoice, still to pay, with online payment on?
  const asClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: mine } = await asClient.rpc('portal_invoices');
  const inv = (Array.isArray(mine) ? mine : []).find((i: { id: string }) => i.id === invoiceId);
  if (!inv || inv.status !== 'sent' || !inv.pay_online)
    return reply(404, { error: 'That invoice cannot be paid online.' });

  // as the server: the trainer's keys
  const sb = createClient(url, serviceKey);
  const { data: row } = await sb
    .from('invoices')
    .select('trainer_id, number, total_cents, client_name, client_email, period_start')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!row) return reply(404, { error: 'That invoice cannot be paid online.' });
  const { data: ps } = await sb
    .from('payment_settings')
    .select('enabled, sandbox, merchant_id, merchant_key, passphrase')
    .eq('trainer_id', row.trainer_id)
    .maybeSingle();
  if (!ps || !ps.enabled || !ps.merchant_id || !ps.merchant_key)
    return reply(404, { error: 'That invoice cannot be paid online.' });

  const form = checkoutForm({
    merchantId: ps.merchant_id,
    merchantKey: ps.merchant_key,
    passphrase: ps.passphrase,
    sandbox: ps.sandbox,
    returnUrl: `${appUrl}/portal?paid=${encodeURIComponent(row.number)}`,
    cancelUrl: `${appUrl}/portal`,
    notifyUrl: `${url}/functions/v1/payfast-notify`,
    invoiceId,
    totalCents: row.total_cents,
    invoiceNumber: row.number,
    description: `Training sessions, ${MONTHS[Number(String(row.period_start).slice(5, 7)) - 1]} ${String(row.period_start).slice(0, 4)}`,
    clientName: row.client_name,
    clientEmail: row.client_email,
  });
  return reply(200, form);
});
