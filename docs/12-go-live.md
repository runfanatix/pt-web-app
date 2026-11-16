# Going live: the checklist

Everything the app needs outside the code, in the order to do it. Tick each step off. Where a step says **tell Claude**,
that is the point where you can paste what you see and Claude will check it with you.

You will use four dashboards: **Supabase** (database and sign-in), **Resend** (email), **Vercel** (hosts the app) and
**PayFast** (online payments). Your Supabase project is `wpscshxxjerwguddblmn` (London).

---

## 1. Database: make sure every migration has been run

In Supabase: **SQL Editor > New query**, paste this and press Run:

```sql
select
  to_regclass('public.share_links') is not null                              as share_links,
  exists (select 1 from pg_proc where proname = 'get_shared_programme')      as public_link,
  exists (select 1 from pg_proc where proname = 'save_gym_layout')           as layout_save,
  to_regclass('public.manufacturers') is not null                            as catalogue,
  to_regclass('public.client_invites') is not null                           as client_portal,
  exists (select 1 from pg_proc where proname = 'portal_save_run')           as client_workouts,
  to_regclass('public.bookings') is not null                                 as bookings,
  exists (select 1 from pg_proc where proname = 'generate_invoices')         as invoicing,
  to_regclass('public.payment_settings') is not null                         as online_payments;
```

Every column must say `true`. For each one that says `false`, open that migration from the repository's
`supabase/migrations` folder, copy the whole file into a new query and run it. Run them **in this order**:

| If this is false | Run this file |
|---|---|
| public_link | `20261117090000_shared_programme.sql` |
| layout_save | `20261118090000_save_gym_layout.sql` |
| catalogue | `20261119090000_catalogue.sql` |
| client_portal | `20261120090000_client_portal.sql` |
| client_workouts | `20261121090000_client_runs.sql` |
| bookings | `20261122090000_bookings.sql` |
| invoicing | `20261123090000_invoicing.sql` |
| online_payments | `20261124090000_online_payments.sql` |

If a file says something "already exists", that step was done before: carry on to the next. After a run, re-run the check
above. **Tell Claude** if any column stays false.

---

## 2. Put the app on the internet (Vercel)

The client portal, the invoice emails and PayFast all need a public web address.

1. Go to vercel.com, sign in with GitHub, **Add New > Project**, and pick this repository.
2. Leave **Root Directory** as the repository root. The repository's `vercel.json` already tells Vercel how to build it
   and sends every address to the app.
3. Under **Environment Variables** add two, with the values from your `.env` file (the same ones the app uses on your
   computer): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Use the **anon (public)** key only, never the service key.
4. Press **Deploy**. When it finishes you get an address like `https://pt-planner-xxxx.vercel.app`. Open it and sign in.
5. Write that address down: it is your **app address** below. (A custom domain can be added later in Vercel.)

If the build fails, copy the last 20 lines of the build log to Claude.

---

## 3. Resend (sends the emails)

1. At resend.com, **Domains > Add Domain**: enter a domain you own (for example `yourgym.co.za`). Resend shows a few
   DNS records. Add them at wherever you bought the domain, wait until Resend says **Verified**.
   (No domain yet? You can try with Resend's test sender, but it only delivers to your own email.)
2. **API Keys > Create API Key**, permission **Sending access**. Copy it now (it is shown once). It starts with `re_`.
3. Decide the sending address, for example `PT Planner <hello@yourgym.co.za>`. It must be on the verified domain.

---

## 4. Supabase sign-in emails (the client's sign-in link)

In Supabase:
1. **Authentication > Emails > SMTP Settings**: switch on **Enable custom SMTP** and enter
   host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender email = the address from
   step 3, sender name = your business name. Save.
2. **Authentication > URL Configuration**: set **Site URL** to your app address, and under **Redirect URLs** add
   `https://<your app address>/portal`.
3. **Authentication > Sign In / Providers > Email**: make sure **Confirm email** is **on**. The client portal relies on it.
4. **Authentication > Emails > Templates > Magic link**: change the wording if you like (keep the link).

---

## 5. The email and payment functions (Supabase Edge Functions)

Five small programs run on Supabase's servers. You deploy them once from your computer, in the repository folder.

```
npx supabase login
npx supabase link --project-ref wpscshxxjerwguddblmn
```
`login` opens a browser. `link` may ask for the database password you chose when you created the project.

Then set the settings they need (replace the values):

```
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxx MAIL_FROM="PT Planner <hello@yourgym.co.za>" APP_URL=https://your-app-address
```

Then deploy them. The notification one must be allowed to receive calls from PayFast, which has no sign-in, so it
has an extra flag:

```
npx supabase functions deploy send-portal-invite --use-api
npx supabase functions deploy send-invoice --use-api
npx supabase functions deploy payfast-checkout --use-api
npx supabase functions deploy payfast-notify --use-api --no-verify-jwt
npx supabase functions deploy send-reminders --use-api --no-verify-jwt
```
(`--use-api` means you do not need Docker.)

What each does: `send-portal-invite` emails the client's portal invitation; `send-invoice` emails invoices;
`payfast-checkout` prepares a signed PayFast payment for a client; `payfast-notify` is where PayFast reports a payment;
`send-reminders` emails clients before their sessions (it only answers the scheduler, which proves itself with the service key).
**Tell Claude** if a command shows an error.

---

## 6. The daily automatic job (invoices)

In Supabase: **Database > Extensions**, search **pg_cron**, switch it on. Then in the SQL Editor run:

```sql
select cron.schedule('pt-auto-invoicing', '0 5 * * *', $$ select public.run_auto_invoicing() $$);
```
That is 07:00 South African time every day. It only does anything for trainers who have switched on automatic invoicing,
and only on the right day of the month.

To email the invoices that the automatic run sends without checking (only if you tick that option): in Supabase,
**Integrations > Cron > Create job**, type **Supabase Edge Function**, pick `send-invoice`, schedule daily at 05:15, method
POST, body `{"queued": true}`. (The dashboard adds the needed key for you, so you never paste a secret into a command.)

Then the reminders: in Supabase, **Integrations > Cron > Create job**, type **Supabase Edge Function**, pick
`send-reminders`, schedule **every 30 minutes** (`*/30 * * * *`), method POST. Then, in the app, **Calendar > Automatic
reminders**: switch it on and choose how long before (24 hours is the day before). A reminder goes to a client who has an
email address on file and has not turned reminders off in their portal; it carries a calendar file, and sessions that are
cancelled or that the client said they cannot make are skipped. Each session is reminded once.

---

## 7. PayFast (online payments)

**First try it with fake money (the sandbox):**
1. Go to sandbox.payfast.co.za and sign up (it is free and separate from the real PayFast). Log in, **Settings >
   Integration**: note your **Merchant ID** and **Merchant Key**, and set a **Passphrase** (any phrase you choose; save it).
2. In the app: **Invoices > Online payments (PayFast)**: tick *Let clients pay invoices online*, leave *Test mode* ticked,
   enter the merchant ID, key and passphrase, and Save.
3. Make and send an invoice, then open the client portal as the client. **My invoices** shows *Pay R... now*. Pay with
   the sandbox buyer details PayFast shows on its payment page. A minute later the invoice shows as **Paid** in both views.

**Then for real:**
1. Create a live PayFast account at payfast.co.za. PayFast checks your identity and business, so this can take a few days.
   (Fees are charged by PayFast on each payment: check their current pricing.)
2. In the live account, **Settings > Integration**, note the live Merchant ID and Key and set a passphrase.
3. In the app, enter the live ones and **untick Test mode**.

You do not need to give PayFast any web address: the app sends it with every payment.

---

## 8. A full test before real clients

1. Sign in as yourself on the live address. Add a client with your own second email address and invite them.
2. Open the email, click the link, and check the portal opens on your phone.
3. Book four weekly sessions next month, set a rate, make the invoice, send it, and check the email arrives.
4. In the portal, pay it in sandbox mode and check it turns to Paid.
5. Switch automatic invoicing on with 0 days before the end of the month (only for a test client), run
   `select public.run_auto_invoicing();` in the SQL editor on the last day of the month, and check the draft appears. Switch it off again after.

## What still needs a decision from you
- A lawyer's review of the privacy wording (docs/07-privacy-popia.md).
- The real product name and logo (the placeholder is in one place: docs/09-client-portal.md).
