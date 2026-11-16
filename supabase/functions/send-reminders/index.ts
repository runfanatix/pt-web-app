// Emails the clients whose sessions are coming up (the trainer chooses how long before: 1 to 72 hours).
//
//   supabase functions deploy send-reminders --use-api --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="PT Planner <hello@yourgym.co.za>" APP_URL=https://your-app.example CRON_SECRET=<a long random phrase>
//
// Run it every half hour (docs/12-go-live.md). It asks the database which sessions need a reminder; the database
// marks them as reminded in the same step, so a second run never repeats one. If an email fails the session is given
// back and tried again at the next run. It only answers a caller that knows CRON_SECRET (or the service role key).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reminderEmail, sessionIcs } from '../_shared/reminder-email.ts';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Due = any;

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  const given = auth.replace(/^Bearer\s+/i, '');
  if (!given || (given !== secret && given !== service)) return reply(403, { error: 'Not allowed.' });

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  const url = Deno.env.get('SUPABASE_URL');
  if (!key || !from || !appUrl || !url || !service)
    return reply(503, { error: 'Email is not set up yet (RESEND_API_KEY, MAIL_FROM, APP_URL).' });

  const sb = createClient(url, service);
  const nowIso = new Date().toISOString();
  const { data, error } = await sb.rpc('claim_due_reminders', { p_now: nowIso });
  if (error) return reply(500, { error: error.message });
  const due: Due[] = Array.isArray(data) ? data : [];

  let sent = 0;
  let failed = 0;
  for (const b of due) {
    const mail = reminderEmail({
      clientName: b.client_name,
      trainerName: b.trainer ?? '',
      trainerPhone: b.trainer_phone ?? '',
      title: b.title,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      gym: b.gym ?? '',
      gymAddress: b.gym_address ?? '',
      portalUrl: `${appUrl}/portal`,
      nowIso,
    });
    const ics = sessionIcs(
      {
        id: b.id,
        title: `${b.title}${b.trainer ? ` with ${b.trainer}` : ''}`,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        location: [b.gym, b.gym_address].filter(Boolean).join(', '),
      },
      nowIso,
    );
    let ok = false;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [b.client_email],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          attachments: [{ filename: 'session.ics', content: btoa(ics) }],
        }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) sent += 1;
    else {
      failed += 1;
      await sb.rpc('release_reminder', { p_booking: b.id });
    }
  }
  return reply(200, { due: due.length, sent, failed });
});
