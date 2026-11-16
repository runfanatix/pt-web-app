/**
 * The reminder a client gets before a session, and the calendar file that goes with it. Plain TypeScript with no
 * imports, so the Edge Function (Deno) and the unit tests (Node) both use it. Times are South African (UTC+2, no
 * daylight saving). The wording is a placeholder until there is a brand.
 */
const SAST_MS = 2 * 3600000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
const pad = (n: number) => String(n).padStart(2, '0');

const sast = (iso: string) => new Date(Date.parse(iso) + SAST_MS);
const dateKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const clock = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** "today, 07:00 to 08:00" / "tomorrow, Tuesday 2 December, 07:00 to 08:00" / "Thursday 4 December, 07:00 to 08:00". */
export function whenText(startsAt: string, endsAt: string, nowIso: string): string {
  const s = sast(startsAt);
  const days = Math.round(
    (Date.parse(`${dateKey(s)}T00:00:00Z`) - Date.parse(`${dateKey(sast(nowIso))}T00:00:00Z`)) / 86400000,
  );
  const date = `${DAYS[s.getUTCDay()]} ${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
  const range = `${clock(s)} to ${clock(sast(endsAt))}`;
  return days === 0 ? `today, ${range}` : days === 1 ? `tomorrow, ${date}, ${range}` : `${date}, ${range}`;
}

export interface ReminderInput {
  clientName: string;
  trainerName: string;
  trainerPhone: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** "Virgin Active Bedfordview", or empty. */
  gym: string;
  gymAddress: string;
  portalUrl: string;
  nowIso: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function reminderEmail(i: ReminderInput): { subject: string; text: string; html: string } {
  const first = i.clientName.trim().split(/\s+/)[0] || 'there';
  const trainer = i.trainerName.trim() || 'your trainer';
  const when = whenText(i.startsAt, i.endsAt, i.nowIso);
  const where = [i.gym, i.gymAddress].filter(Boolean).join(', ');
  const subject = `Reminder: ${i.title.toLowerCase()} ${when.split(',')[0] === 'today' ? 'today' : when.startsWith('tomorrow') ? 'tomorrow' : `on ${when.split(',')[0]}`} with ${trainer}`;
  const text = [
    `Hi ${first},`,
    '',
    `A reminder of your ${i.title.toLowerCase()} with ${trainer}:`,
    '',
    when.charAt(0).toUpperCase() + when.slice(1),
    ...(where ? [where] : []),
    '',
    `If you cannot make it, please tell ${trainer}${i.trainerPhone ? ` on ${i.trainerPhone}` : ''} as soon as you can, or open ${i.portalUrl} and tap "I cannot make it".`,
    '',
    `To stop these reminders, sign in at ${i.portalUrl}, open My sessions and turn off reminders.`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2330;line-height:1.5;max-width:520px;margin:0 auto;padding:16px">
<p>Hi ${esc(first)},</p>
<p>A reminder of your ${esc(i.title.toLowerCase())} with ${esc(trainer)}:</p>
<p style="font-size:18px"><b>${esc(when.charAt(0).toUpperCase() + when.slice(1))}</b>${where ? `<br>${esc(where)}` : ''}</p>
<p>If you cannot make it, please tell ${esc(trainer)}${i.trainerPhone ? ` on ${esc(i.trainerPhone)}` : ''} as soon as you can, or <a href="${esc(i.portalUrl)}">open your portal</a> and tap “I cannot make it”.</p>
<p style="color:#6b7280;font-size:13px">To stop these reminders, sign in to <a href="${esc(i.portalUrl)}">your portal</a>, open My sessions and turn off reminders.</p>
</body></html>`;
  return { subject, text, html };
}

/* ---------------------------------------------------------------- calendar file */
const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A one-session calendar file (opens in Google, Apple and Outlook calendars). */
export function sessionIcs(
  b: { id: string; title: string; startsAt: string; endsAt: string; location: string },
  nowIso: string,
): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PT Planner//Bookings//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${b.id}@ptplanner`,
      `DTSTAMP:${stamp(nowIso)}`,
      `DTSTART:${stamp(b.startsAt)}`,
      `DTEND:${stamp(b.endsAt)}`,
      `SUMMARY:${icsText(b.title)}`,
      ...(b.location ? [`LOCATION:${icsText(b.location)}`] : []),
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}
