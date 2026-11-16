# Invoicing (Phase 11a)

Clients are billed **monthly in advance**. Once next month's sessions are in the calendar, an invoice is made for each
client with sessions, counting those sessions at the client's rate. Amounts are in South African rand, in whole cents.

## What the trainer does
1. **Invoice settings** (Invoices tab): default rate per session, VAT % (0 if you do not charge VAT), invoice number
   prefix, bank details (shown on every invoice), an optional payment link (PayFast, Yoco, Ozow or similar: any
   `https://` page), payment terms.
2. **Rates per client**: a rate for a client, or leave it blank to use the default.
3. **Make the invoices**: pick the month (it opens on next month) and press *Make the ... invoices*. One draft is made
   per client who has scheduled or completed sessions in that month (cancelled and missed sessions are not counted;
   dates are South African dates). It names clients it skipped because they have no rate. It never makes a second
   invoice for the same client and month (cancel the first to make it again).
4. **Check and send**: a draft's lines can be edited (description, quantity, price), added to, or removed, for example a
   discount. *Send to client* marks it sent and emails it. A sent invoice's lines are locked: *Edit again* turns it
   back into a draft.
5. **Get paid**: the invoice has your bank details with the invoice number as the reference, plus the payment link.
   Download the PDF, send a WhatsApp message, or let the client see it in their portal. When the money arrives press
   *Mark as paid* (EFT, cash, card or other, and the date).
6. The tab shows what is owed and what is overdue (past its due date). Invoices are due on the 1st of the month they are for
   (or the day they are made, if that is later).

## Automatic invoicing
Switch on **Make next month's invoices automatically** and choose how many days before the month ends. On that day the
daily job makes next month's invoices from the calendar, as drafts for you to check, or, if you also tick *Send them
to clients without checking first*, marked as sent and queued to be emailed. Clients with no sessions or no rate are
skipped. If a day is missed it catches up later in the month, and it never makes anything twice.

### One-time setup of the daily job (Supabase)
Automatic invoicing needs a daily schedule. In the Supabase dashboard enable the **pg_cron** extension (Database >
Extensions), then run once in the SQL editor:

```
select cron.schedule('pt-auto-invoicing', '0 5 * * *', $$ select public.run_auto_invoicing() $$);
```
(05:00 UTC is 07:00 in South Africa.) The function can be called only by this job, never by a trainer or a client.

### Emailing invoices (needs Resend, see docs/09-client-portal.md)
```
supabase functions deploy send-invoice
supabase secrets set RESEND_API_KEY=re_xxxxxxxx MAIL_FROM="PT Planner <invoices@yourdomain.com>" APP_URL=https://your-app.example
```
*Send to client* in the app then emails the invoice. For invoices the automatic run sent straight away, schedule the
function to email the queue (call it with `{ "queued": true }` and the service role key, for example from a second
cron job using `pg_net`, keeping the key in Supabase Vault, not in the command). Until email is set up, a sent
invoice shows "waiting to be emailed" if it was queued, and the trainer can send it by WhatsApp or PDF; the client
always sees it in their portal.

## What the client sees
A **My invoices** tab with what they owe, each invoice's lines, how to pay (bank details with the invoice number as
the reference, and the payment link as a button), and a PDF. Drafts and cancelled invoices are never shown. A paid
invoice shows as paid.

## Rules in the database
Clients have no table access (`portal_invoices` only). An invoice's lines are always quantity x price and its totals
always follow its lines (VAT on the subtotal); only a draft's lines can change. One live invoice per client per month.
When a client is erased the invoices stay (tax records are kept for five years) with the name and email as they were.

## Not built yet
- More online payment providers: PayFast is built (Phase 11b); the provider is a setting so others can be added.
- Credit notes, part payments, packages and session credits, and a tax invoice format with VAT numbers.
- Reminders for overdue invoices.
