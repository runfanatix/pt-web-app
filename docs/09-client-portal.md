# The client portal (Phase 9a)

A client signs in at `https://<your app>/portal` with an **emailed link** (no password) and sees only their own
programmes, the gym plan, and their privacy choices. A person who trains with two trainers sees both, kept apart.

## How it works

1. On a client's page the trainer opens **Client portal**, checks the email address, and presses **Invite to the
   portal**. The invitation is saved and an email goes out (Resend, below). The link in it is just the portal address.
2. The client opens the portal, types the same email address, and gets a one-time sign-in link from Supabase.
3. The first time they are signed in, every valid invite for their **verified** email is claimed: that links their
   sign-in to the client record(s). Nothing is shared with an email address that has not been invited.
4. The trainer sees **Active** and can **Switch off access** at any time (two taps); it takes effect on the next request.

What the database lets a client do is limited to functions (`portal_overview`, `portal_programme`,
`portal_withdraw_consent`, `portal_request`). A client has no access to any table, so private notes, goals, other
clients and the trainer's other data cannot be reached. The tests try each of these and must fail.

A person who signs in through the portal is created with `role = client` and **does not get a trainer account**.

## One-time setup (Supabase and Resend)

You do these once, in dashboards. Nothing here goes in the repository.

### 1. Resend (sends the emails)
1. Create a free account at resend.com and **verify a sending domain** (or use their test address while trying it).
2. Create an **API key** and keep it for step 3.

### 2. Supabase: send sign-in emails through Resend
Supabase's built-in email allows only a few messages an hour, so it is not enough for real clients.

1. Supabase dashboard, **Authentication > Emails > SMTP settings**, switch on **custom SMTP**:
   host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender = an address on your
   verified domain, sender name = your product name.
2. **Authentication > URL configuration**: set **Site URL** to your app address and add `https://<your app>/portal`
   to **Redirect URLs**.
3. **Authentication > Providers > Email**: keep **Confirm email** switched **on**. The portal relies on a verified email.
4. **Authentication > Emails > Templates**: edit the "Magic link" email wording if you like.

### 3. The invitation email (an Edge Function)
```
supabase functions deploy send-portal-invite
supabase secrets set RESEND_API_KEY=re_xxxxxxxx MAIL_FROM="PT Planner <invites@yourdomain.com>" APP_URL=https://your-app.example
```
If this is not deployed, **Invite** still works: the invitation is saved, the app says the email could not be sent,
and copies the portal link so the trainer can send it by WhatsApp. The client can sign in either way.

### 4. The database
Run `supabase/migrations/20261120090000_client_portal.sql` in the SQL editor. It is safe to run once; it changes the
sign-up trigger (client sign-ins get no trainer account) and the public link function (it now shares the portal's
description, with the same answers as before).

## Branding

The name and logo are placeholders in `packages/core/src/portal.ts` (`BRAND`) and the email wording in
`supabase/functions/_shared/invite-email.ts`. Change them there when the brand exists.

## Clients running their own workouts (Phase 9b)

Open a programme and press **Start workout**: the same run bar, rest countdown, live plan and wake lock the trainer
has. Finishing saves the workout for that client under their trainer (it appears in the trainer's Past runs, marked
"done by the client"). Under **My workouts** the client sees their own workouts and any their trainer recorded, and
can delete the ones they did themselves (two taps). A workout that never started is not saved.

Rules in the database (`20261121090000_client_runs.sql`): a client can save only to their own programme; a saved run
uses the programme's gym (machines from another gym are not linked); the same id saves over itself (finish, undo,
finish); numbers are clamped; at most 100 exercises; a client's record is kept five years from their last workout.
Run the migration in the SQL editor (safe to run twice).

## Not built yet

- A client changing their own contact details.
- Notifications when a trainer assigns a new programme.
- Two-step sign-in for trainers (see docs/07-privacy-popia.md).
