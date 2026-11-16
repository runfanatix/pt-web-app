// Sends a client their portal invitation email through Resend (https://resend.com).
//
//   supabase functions deploy send-portal-invite
//   supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="PT Planner <invites@yourdomain.com>" APP_URL=https://your-app.vercel.app
//
// The trainer's app calls it with the id of an invite it just created. The function runs AS the trainer (their
// sign-in token is passed on), so row-level security decides whether that invite is theirs: nobody can use it to
// email somebody else's client. Setup steps: docs/09-client-portal.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { inviteEmail } from '../_shared/invite-email.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth) return reply(401, { error: 'Sign in first.' });

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  if (!key || !from || !appUrl)
    return reply(503, { error: 'Email is not set up yet (RESEND_API_KEY, MAIL_FROM, APP_URL).' });

  let inviteId = '';
  try {
    inviteId = String((await req.json()).inviteId ?? '');
  } catch {
    return reply(400, { error: 'Send the invite id.' });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: invite } = await sb
    .from('client_invites')
    .select('id, email, client_id, revoked_at, accepted_at, expires_at')
    .eq('id', inviteId)
    .maybeSingle();
  if (!invite || invite.revoked_at || invite.accepted_at || Date.parse(invite.expires_at) < Date.now())
    return reply(404, { error: 'That invite is not available.' });
  const { data: client } = await sb.from('clients').select('name').eq('id', invite.client_id).maybeSingle();
  const { data: trainer } = await sb
    .from('trainers')
    .select('business_name, display_name')
    .limit(1)
    .maybeSingle();

  const mail = inviteEmail({
    trainerName: trainer?.business_name || trainer?.display_name || '',
    clientName: client?.name ?? '',
    portalUrl: `${appUrl}/portal`,
    productName: Deno.env.get('PRODUCT_NAME') ?? 'PT Planner',
  });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [invite.email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) return reply(502, { error: 'The email service refused the message.' });
  await sb.from('client_invites').update({ emailed_at: new Date().toISOString() }).eq('id', invite.id);
  return reply(200, { sent: true });
});
