// Receives PayFast's payment notification (ITN) and marks the invoice paid.
//
//   supabase functions deploy payfast-notify --no-verify-jwt
//
// PayFast calls this by itself, so it has no sign-in: everything is checked instead. A notification counts only when
//   1. its signature matches (made with the trainer's secret passphrase),
//   2. its status is COMPLETE and it names the trainer's own PayFast account,
//   3. PayFast itself confirms it when we ask them (query/validate answers VALID), and
//   4. the amount is exactly the invoice total (checked inside record_online_payment).
// A payment that fails any check is ignored (or, for a wrong amount, recorded but not applied). The reply is always
// 200 so PayFast does not keep retrying. Setup: docs/12-go-live.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkItn, itnConfirmationBody, parseItn, validateUrl } from '../_shared/payfast.ts';

const ok = () => new Response('OK', { status: 200 });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return ok();
  const fields = parseItn(await req.text());
  const get = (k: string) => fields.find(([f]) => f === k)?.[1] ?? '';
  const invoiceId = get('m_payment_id');
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return ok();

  const sb = createClient(url, serviceKey);
  const { data: inv } = await sb.from('invoices').select('trainer_id').eq('id', invoiceId).maybeSingle();
  if (!inv) return ok();
  const { data: ps } = await sb
    .from('payment_settings')
    .select('sandbox, merchant_id, passphrase, enabled')
    .eq('trainer_id', inv.trainer_id)
    .maybeSingle();
  if (!ps || get('merchant_id') !== ps.merchant_id) return ok();

  const verdict = checkItn(fields, ps.passphrase);
  if (!verdict.ok) {
    console.log('PayFast notification refused:', verdict.reason);
    return ok();
  }
  // ask PayFast whether it really sent this
  const check = await fetch(validateUrl(ps.sandbox), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: itnConfirmationBody(fields),
  });
  if ((await check.text()).trim() !== 'VALID') {
    console.log('PayFast did not confirm the notification.');
    return ok();
  }
  const { data, error } = await sb.rpc('record_online_payment', {
    p_invoice: invoiceId,
    p_provider: 'payfast',
    p_ref: verdict.paymentRef,
    p_amount_cents: verdict.amountCents,
  });
  console.log('Payment', verdict.paymentRef, error ? `error: ${error.message}` : data);
  return ok();
});
