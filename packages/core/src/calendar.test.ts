import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  bookingProblems,
  bookingRows,
  bookingsOn,
  clashes,
  countsByDate,
  diffDays,
  fromIso,
  isDate,
  isTime,
  longDate,
  mondayOf,
  monthGrid,
  parseBookings,
  parsePortalBookings,
  reminderText,
  toIcs,
  toIso,
  todaySast,
  weekDates,
  weekdayOf,
  type Booking,
} from './index.ts';

const b = (id: string, date: string, from: string, to: string, over: Partial<Booking> = {}): Booking => ({
  id,
  clientId: 'c1',
  gymId: null,
  seriesId: null,
  title: 'Training session',
  startsAt: toIso(date, from),
  endsAt: toIso(date, to),
  status: 'scheduled',
  response: 'pending',
  cancelledBy: null,
  notes: '',
  ...over,
});

describe('South African time', () => {
  it('08:00 in Johannesburg is 06:00 UTC, and back again', () => {
    expect(toIso('2026-11-23', '08:00')).toBe('2026-11-23T06:00:00.000Z');
    expect(fromIso('2026-11-23T06:00:00.000Z')).toEqual({ date: '2026-11-23', time: '08:00' });
  });
  it('a late session lands on the right local date across midnight UTC', () => {
    expect(toIso('2026-11-23', '00:30')).toBe('2026-11-22T22:30:00.000Z');
    expect(fromIso('2026-11-22T22:30:00.000Z')).toEqual({ date: '2026-11-23', time: '00:30' });
    expect(fromIso('2026-11-23T21:59:00.000Z').date).toBe('2026-11-23');
    expect(fromIso('2026-11-23T22:00:00.000Z').date).toBe('2026-11-24');
  });
  it('today follows South African time, not the computer’s', () => {
    expect(todaySast(Date.parse('2026-11-23T21:30:00Z'))).toBe('2026-11-23');
    expect(todaySast(Date.parse('2026-11-23T22:30:00Z'))).toBe('2026-11-24');
  });
});

describe('dates', () => {
  it('validates dates and times', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-1-1')).toBe(false);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('07:05')).toBe(true);
  });
  it('adds days and months across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-01', '2026-11-30')).toBe(29);
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });
  it('weeks start on Monday', () => {
    expect(weekdayOf('2026-11-23')).toBe(0);
    expect(weekdayOf('2026-11-29')).toBe(6);
    expect(mondayOf('2026-11-27')).toBe('2026-11-23');
    expect(weekDates('2026-11-29')).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
    expect(longDate('2026-11-23')).toBe('Monday 23 November 2026');
  });
  it('a month grid is whole weeks, Monday first, marking the days outside the month', () => {
    const g = monthGrid(2026, 11);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]!.date).toBe('2026-10-26');
    expect(g[0]![0]!.inMonth).toBe(false);
    expect(g[0]![6]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(g.at(-1)!.at(-1)!.date).toBe('2026-12-06');
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(monthGrid(2026, 2)).toHaveLength(5); // Feb 2026 starts on a Sunday
  });
});

describe('new bookings', () => {
  const form = {
    clientId: 'c1',
    gymId: 'g1',
    title: ' Leg day ',
    date: '2026-11-23',
    time: '07:00',
    minutes: 60,
    weeks: 1,
    notes: '  bring a towel ',
  };
  it('refuses a bad form in plain words', () => {
    expect(bookingProblems(form)).toEqual([]);
    expect(
      bookingProblems({ ...form, date: '2026-13-01', time: '7am', minutes: 2, weeks: 0, title: ' ' }),
    ).toHaveLength(5);
  });
  it('one session is one row with the right moments and tidy text', () => {
    const rows = bookingRows(form, () => 'series');
    expect(rows).toEqual([
      {
        client_id: 'c1',
        gym_id: 'g1',
        series_id: null,
        title: 'Leg day',
        starts_at: '2026-11-23T05:00:00.000Z',
        ends_at: '2026-11-23T06:00:00.000Z',
        notes: 'bring a towel',
      },
    ]);
  });
  it('weekly repeats keep the same time of day, share a series, and cross month ends', () => {
    const rows = bookingRows({ ...form, date: '2026-11-23', weeks: 3 }, () => 'S1');
    expect(rows.map((r) => fromIso(r.starts_at).date)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
    expect(new Set(rows.map((r) => r.series_id))).toEqual(new Set(['S1']));
    expect(rows.every((r) => fromIso(r.starts_at).time === '07:00')).toBe(true);
  });
});

describe('the day and the month', () => {
  const list = [
    b('a', '2026-11-23', '09:00', '10:00'),
    b('b', '2026-11-23', '07:00', '08:00'),
    b('c', '2026-11-24', '07:00', '08:00'),
    b('d', '2026-11-23', '12:00', '13:00', { status: 'cancelled' }),
  ];
  it('lists a day earliest first, and counts only the sessions that still count', () => {
    expect(bookingsOn(list, '2026-11-23').map((x) => x.id)).toEqual(['b', 'a', 'd']);
    expect(countsByDate(list).get('2026-11-23')).toBe(2);
    expect(countsByDate(list).get('2026-11-24')).toBe(1);
  });
  it('warns about overlaps, ignoring cancelled ones, back-to-back sessions and the session being edited', () => {
    expect(
      clashes(list, toIso('2026-11-23', '09:30'), toIso('2026-11-23', '10:30')).map((x) => x.id),
    ).toEqual(['a']);
    expect(clashes(list, toIso('2026-11-23', '10:00'), toIso('2026-11-23', '11:00'))).toEqual([]);
    expect(clashes(list, toIso('2026-11-23', '12:30'), toIso('2026-11-23', '12:45'))).toEqual([]);
    expect(clashes(list, toIso('2026-11-23', '09:30'), toIso('2026-11-23', '10:30'), 'a')).toEqual([]);
  });
  it('a reminder names the day, time, place and first name', () => {
    expect(
      reminderText(b('a', '2026-11-23', '09:00', '10:00'), {
        clientName: 'Dan Dillon',
        trainerName: 'Alice',
        gym: 'Virgin Active',
      }),
    ).toBe(
      'Hi Dan, a reminder of your training session with Alice on Monday 23 November 2026 at 09:00 at Virgin Active. Reply if you cannot make it.',
    );
  });
});

describe('database rows', () => {
  it('reads bookings soonest first and refuses nonsense', () => {
    const row = (id: string, s: string) => ({
      id,
      client_id: null,
      gym_id: null,
      series_id: null,
      title: 'T',
      starts_at: s,
      ends_at: s,
      status: 'scheduled',
      client_response: 'pending',
      cancelled_by: null,
      notes: '',
    });
    expect(
      parseBookings([row('b', '2026-11-24T06:00:00+00:00'), row('a', '2026-11-23T06:00:00+00:00')]).map(
        (x) => x.id,
      ),
    ).toEqual(['a', 'b']);
    expect(() => parseBookings([{ ...row('a', 'x'), status: 'done' }])).toThrow();
  });
  it('reads the portal’s list, with blanks for what is missing', () => {
    const l = parsePortalBookings([
      {
        id: 'a',
        client_id: 'c',
        title: 'T',
        starts_at: '2026-11-23T06:00:00Z',
        ends_at: '2026-11-23T07:00:00Z',
        status: 'scheduled',
        client_response: 'pending',
        cancelled_by: null,
        gym: null,
        gym_address: null,
        trainer: 'Alice',
      },
    ]);
    expect(l[0]).toMatchObject({ gym: '', gymAddress: '', trainerName: 'Alice' });
    expect(parsePortalBookings(null)).toEqual([]);
  });
});

describe('calendar files', () => {
  it('makes a valid calendar with exact UTC times, escaped text and CRLF lines', () => {
    const ics = toIcs(
      [
        {
          id: 'x1',
          title: 'Legs; chest, back',
          startsAt: '2026-11-23T05:00:00.000Z',
          endsAt: '2026-11-23T06:00:00.000Z',
          location: 'Virgin Active, 1 Main Rd',
          description: 'Bring water\nand a towel',
        },
      ],
      Date.parse('2026-11-20T10:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261123T050000Z');
    expect(ics).toContain('DTEND:20261123T060000Z');
    expect(ics).toContain('DTSTAMP:20261120T100000Z');
    expect(ics).toContain('SUMMARY:Legs\\; chest\\, back');
    expect(ics).toContain('LOCATION:Virgin Active\\, 1 Main Rd');
    expect(ics).toContain('DESCRIPTION:Bring water\\nand a towel');
    expect(ics).toContain('UID:x1@ptplanner');
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });
});
