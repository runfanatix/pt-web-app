/**
 * Bookings and the calendar: pure date maths in South African time (UTC+2, no daylight saving), the rows the
 * database returns, repeating weekly sessions, clash detection and calendar (.ics) files. Dates are 'YYYY-MM-DD'
 * and times 'HH:MM' in South African time; stored moments are ISO strings in UTC.
 */
import { z } from 'zod';

export const SAST_OFFSET_MIN = 120;
export const TIME_ZONE = 'Africa/Johannesburg';

const pad = (n: number) => String(n).padStart(2, '0');
const MS_DAY = 86400000;

/** Midnight UTC of a date, as a number (days are counted from here, so there is no time zone in the maths). */
const dayNum = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const dayStr = (n: number): string => {
  const t = new Date(n);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && dayStr(dayNum(s)) === s;
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const addDays = (date: string, n: number): string => dayStr(dayNum(date) + n * MS_DAY);
export const diffDays = (a: string, b: string): number => Math.round((dayNum(b) - dayNum(a)) / MS_DAY);

/** 0 = Monday ... 6 = Sunday. */
export const weekdayOf = (date: string): number => (new Date(dayNum(date)).getUTCDay() + 6) % 7;
export const mondayOf = (date: string): string => addDays(date, -weekdayOf(date));

/** A South African date and time as the exact moment (ISO, UTC). */
export function toIso(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(dayNum(date) + (h * 60 + m - SAST_OFFSET_MIN) * 60000).toISOString();
}

/** The South African date and time of an exact moment. */
export function fromIso(iso: string): { date: string; time: string } {
  const t = new Date(Date.parse(iso) + SAST_OFFSET_MIN * 60000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
}

/** Today in South African time. */
export const todaySast = (now: number = Date.now()): string => fromIso(new Date(now).toISOString()).date;

export const minutesBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 60000);

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
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const monthName = (m: number): string => MONTHS[m - 1] ?? '';
/** "Monday 23 November 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${DAYS[weekdayOf(date)]} ${d} ${MONTHS[m - 1]} ${y}`;
}
/** "23 Nov". */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

export const addMonths = (date: string, n: number): string => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
};

export interface GridDay {
  date: string;
  inMonth: boolean;
}
/** The weeks to draw for a month (Monday first), always whole weeks. `month` is 1 to 12. */
export function monthGrid(year: number, month: number): GridDay[][] {
  const first = `${year}-${pad(month)}-01`;
  const start = mondayOf(first);
  const last = addDays(addMonths(first, 1), -1);
  const weeks: GridDay[][] = [];
  for (let w = start; diffDays(w, last) >= 0; w = addDays(w, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => ({
        date: addDays(w, i),
        inMonth: addDays(w, i).slice(0, 7) === first.slice(0, 7),
      })),
    );
  }
  return weeks;
}
export const weekDates = (date: string): string[] => {
  const m = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(m, i));
};

/* ---------------------------------------------------------------- bookings */

export const STATUSES = ['scheduled', 'completed', 'no_show', 'cancelled'] as const;
export type BookingStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<BookingStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Done',
  no_show: 'Did not come',
  cancelled: 'Cancelled',
};
export type ClientResponse = 'pending' | 'confirmed' | 'declined';
export const RESPONSE_LABEL: Record<ClientResponse, string> = {
  pending: 'Not answered',
  confirmed: 'Confirmed',
  declined: 'Cannot make it',
};

export interface Booking {
  id: string;
  clientId: string | null;
  gymId: string | null;
  seriesId: string | null;
  title: string;
  /** Exact moments (ISO, UTC). */
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  response: ClientResponse;
  cancelledBy: 'trainer' | 'client' | null;
  notes: string;
  /** When the automatic reminder email went out, if it has. */
  reminderSentAt?: string | null;
}

export const BOOKINGS_SELECT =
  'id, client_id, gym_id, series_id, title, starts_at, ends_at, status, client_response, cancelled_by, notes, reminder_sent_at';

const Row = z.object({
  id: z.string(),
  client_id: z.string().nullable(),
  gym_id: z.string().nullable(),
  series_id: z.string().nullable(),
  title: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(STATUSES),
  client_response: z.enum(['pending', 'confirmed', 'declined']),
  cancelled_by: z.enum(['trainer', 'client']).nullable(),
  notes: z.string(),
  reminder_sent_at: z.string().nullable().optional(),
});

/** Validates rows from `bookings`, soonest first. */
export function parseBookings(raw: unknown): Booking[] {
  return Row.array()
    .parse(raw)
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
      gymId: r.gym_id,
      seriesId: r.series_id,
      title: r.title,
      startsAt: new Date(r.starts_at).toISOString(),
      endsAt: new Date(r.ends_at).toISOString(),
      status: r.status,
      response: r.client_response,
      cancelledBy: r.cancelled_by,
      notes: r.notes,
      reminderSentAt: r.reminder_sent_at ?? null,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface NewBooking {
  clientId: string | null;
  gymId: string | null;
  title: string;
  /** SAST date and start time of the first session. */
  date: string;
  time: string;
  minutes: number;
  /** How many weekly sessions in all (1 = just this one). */
  weeks: number;
  notes: string;
}

export interface BookingRowInput {
  client_id: string | null;
  gym_id: string | null;
  series_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  notes: string;
}

export const MAX_WEEKS = 52;

/** Checks a new booking form; returns the problems in plain words (empty when fine). */
export function bookingProblems(b: NewBooking): string[] {
  const out: string[] = [];
  if (!isDate(b.date)) out.push('Pick a date.');
  if (!isTime(b.time)) out.push('Pick a start time.');
  if (!(b.minutes >= 5 && b.minutes <= 720)) out.push('A session lasts between 5 minutes and 12 hours.');
  if (!(Number.isInteger(b.weeks) && b.weeks >= 1 && b.weeks <= MAX_WEEKS))
    out.push(`Repeat for 1 to ${MAX_WEEKS} weeks.`);
  if (!b.title.trim()) out.push('Give the session a title.');
  return out;
}

/** The rows to insert: one session, or one a week for `weeks` weeks (sharing a series id), same time of day. */
export function bookingRows(b: NewBooking, newId: () => string): BookingRowInput[] {
  const series = b.weeks > 1 ? newId() : null;
  return Array.from({ length: b.weeks }, (_, i) => {
    const date = addDays(b.date, 7 * i);
    const startsAt = toIso(date, b.time);
    return {
      client_id: b.clientId,
      gym_id: b.gymId,
      series_id: series,
      title: b.title.trim().slice(0, 120),
      starts_at: startsAt,
      ends_at: new Date(Date.parse(startsAt) + b.minutes * 60000).toISOString(),
      notes: b.notes.trim().slice(0, 1000),
    };
  });
}

/** Sessions on a South African date, earliest first (cancelled ones included; hide them in the screen if wanted). */
export const bookingsOn = (list: Booking[], date: string): Booking[] =>
  list.filter((b) => fromIso(b.startsAt).date === date).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

/** Sessions that still count: not cancelled. */
export const isLive = (b: Booking): boolean => b.status !== 'cancelled';

/** Live sessions that overlap the given time (except `ignoreId`): the trainer is warned, not stopped. */
export function clashes(list: Booking[], startsAt: string, endsAt: string, ignoreId?: string): Booking[] {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  return list.filter(
    (b) => isLive(b) && b.id !== ignoreId && Date.parse(b.startsAt) < e && Date.parse(b.endsAt) > s,
  );
}

/** Per date: how many live sessions, for the dots on the month view. */
export function countsByDate(list: Booking[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of list)
    if (isLive(b)) m.set(fromIso(b.startsAt).date, (m.get(fromIso(b.startsAt).date) ?? 0) + 1);
  return m;
}

/** "08:00 to 09:00". */
export const timeRange = (b: { startsAt: string; endsAt: string }): string =>
  `${fromIso(b.startsAt).time} to ${fromIso(b.endsAt).time}`;

/** Reminder text a trainer can send by WhatsApp. */
export function reminderText(
  b: Booking,
  opts: { clientName: string; trainerName: string; gym: string },
): string {
  const when = `${longDate(fromIso(b.startsAt).date)} at ${fromIso(b.startsAt).time}`;
  return `Hi ${opts.clientName.split(/\s+/)[0] || 'there'}, a reminder of your ${b.title.toLowerCase()} with ${opts.trainerName || 'your trainer'} on ${when}${opts.gym ? ` at ${opts.gym}` : ''}. Reply if you cannot make it.`;
}

/* ---------------------------------------------------------------- calendar files (.ics) */

const icsStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A calendar file (works with Google, Apple and Outlook calendars) for these sessions. Cancelled ones are left out. */
export function toIcs(
  list: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
    description?: string;
  }[],
  now: number = Date.now(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PT Planner//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const b of list) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@ptplanner`,
      `DTSTAMP:${icsStamp(new Date(now).toISOString())}`,
      `DTSTART:${icsStamp(b.startsAt)}`,
      `DTEND:${icsStamp(b.endsAt)}`,
      `SUMMARY:${icsText(b.title)}`,
      ...(b.location ? [`LOCATION:${icsText(b.location)}`] : []),
      ...(b.description ? [`DESCRIPTION:${icsText(b.description)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------- what the portal receives */

const PortalRow = z.object({
  id: z.string(),
  client_id: z.string(),
  title: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(STATUSES),
  client_response: z.enum(['pending', 'confirmed', 'declined']),
  cancelled_by: z.enum(['trainer', 'client']).nullable(),
  gym: z.string().nullable(),
  gym_address: z.string().nullable(),
  trainer: z.string().nullable(),
});

export interface PortalBooking {
  id: string;
  clientId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  response: ClientResponse;
  cancelledBy: 'trainer' | 'client' | null;
  gym: string;
  gymAddress: string;
  trainerName: string;
}

/** Validates what `portal_bookings` returned (soonest first). */
export function parsePortalBookings(raw: unknown): PortalBooking[] {
  if (raw === null || raw === undefined) return [];
  return PortalRow.array()
    .parse(raw)
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
      title: r.title,
      startsAt: new Date(r.starts_at).toISOString(),
      endsAt: new Date(r.ends_at).toISOString(),
      status: r.status,
      response: r.client_response,
      cancelledBy: r.cancelled_by,
      gym: r.gym ?? '',
      gymAddress: r.gym_address ?? '',
      trainerName: r.trainer ?? '',
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/* ---------------------------------------------------------------- automatic reminders */

/** How long before a session the reminder email goes out, for the trainer to pick from. */
export const REMINDER_HOURS = [2, 12, 24, 48] as const;

export interface ReminderSettings {
  enabled: boolean;
  hours: number;
}
export const REMINDER_SELECT = 'session_reminders, reminder_hours';
const SettingsRow = z.object({
  session_reminders: z.boolean(),
  reminder_hours: z.number().int().min(1).max(72),
});
export const reminderSettingsFromRow = (raw: unknown): ReminderSettings => {
  const r = SettingsRow.parse(raw);
  return { enabled: r.session_reminders, hours: r.reminder_hours };
};

const PrefRow = z.object({
  client_id: z.string(),
  trainer: z.string().nullable(),
  trainer_sends: z.boolean(),
  hours: z.number(),
  has_email: z.boolean(),
  on: z.boolean(),
});
export interface ReminderPref {
  clientId: string;
  trainerName: string;
  /** The trainer has reminders switched on. */
  trainerSends: boolean;
  hours: number;
  /** The trainer has an email address for this client. */
  hasEmail: boolean;
  /** The client wants them. */
  on: boolean;
}
/** Validates what `portal_reminder_prefs` returned. */
export function parseReminderPrefs(raw: unknown): ReminderPref[] {
  if (raw === null || raw === undefined) return [];
  return PrefRow.array()
    .parse(raw)
    .map((r) => ({
      clientId: r.client_id,
      trainerName: r.trainer ?? '',
      trainerSends: r.trainer_sends,
      hours: r.hours,
      hasEmail: r.has_email,
      on: r.on,
    }));
}
