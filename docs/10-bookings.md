# Bookings and the calendar (Phase 10a)

## The trainer's Calendar tab
- **Month, Week and Day** views. The month shows a count on each day with sessions; tap a day to see it. Today is
  outlined. Times are **South African time** (UTC+2, no daylight saving) whatever the device's own clock says.
- **Book a session**: pick a client (or leave it as blocked time), date, start time, length (30 to 120 minutes or
  your own), gym and title. **Repeat every week** for 4, 8, 12, 26 or 52 weeks makes one session a week at the same
  time, linked as a series.
- **Clashes** are shown as a warning with who and when; you can still save (group sessions are normal).
- On each session: **Done**, **Did not come**, **Edit**, **Cancel** (two taps), and for a series **Cancel this and
  the rest** (two taps). A cancelled or missed session can be put back as scheduled or deleted. Changing the time of a
  session clears the client's earlier answer.
- **Remind on WhatsApp** opens a message with the client's first name, day, time and gym (the client's WhatsApp number
  from their profile).
- **Save this month as a calendar file** gives an `.ics` file that opens in Google, Apple or Outlook calendars.

## The client's portal
A **My sessions** tab lists coming sessions with trainer, gym and address, and earlier ones (done, missed, cancelled by
you or your trainer). For each coming session the client taps **I will be there** or **I cannot make it**; the trainer
sees the answer on the session. A client cannot cancel or move a session: a "cannot make it" is a message to the
trainer, who decides. **Add these to my calendar** saves their upcoming sessions as a calendar file.

## What the database allows
Clients have no table access. They call `portal_bookings` (their own sessions, never the trainer's private notes) and
`portal_respond_booking` (only for their own session that has not started and is not cancelled). The trainer's bookings
can only name the trainer's own clients and gyms. The migration is safe to run twice.

## Automatic reminders (Phase 10b)
In **Calendar > Automatic reminders** the trainer switches on an email reminder to clients and chooses how long before a
session it goes (2, 12, 24 or 48 hours). A job that runs every half hour (docs/12-go-live.md) emails each client once
per session, with the day, time, place, who to tell if they cannot come, and a calendar file. Not sent: sessions that are
cancelled or missed, ones the client said they cannot make, clients with no email address, or clients who turned
reminders off (a tick box under **My sessions** in their portal, with a link to it in every email). Moving a session
makes it eligible again. If an email fails it is tried again at the next run. The calendar shows "reminder sent" on
each session.

## Not built yet
- Reminders by WhatsApp or SMS (needs a provider; the one-tap WhatsApp reminder link is still there).
- Client-requested bookings, a bookable availability calendar, packages and session credits.
- A two-way sync with Google or Outlook calendars (the `.ics` file is a one-way export).
- Opening a booked session straight into a workout.
