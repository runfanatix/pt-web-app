import { describe, expect, it } from 'vitest';
import { reminderEmail, sessionIcs, whenText } from '../../../supabase/functions/_shared/reminder-email.ts';
import { parseBookings, parseReminderPrefs, reminderSettingsFromRow, toIcs, toIso } from './index.ts';

describe('when, in plain words, from the reader’s today', () => {
  const now = '2026-12-01T10:00:00Z'; // 12:00 on Tuesday 1 December in South Africa
  it('today, tomorrow, or the day', () => {
    expect(whenText(toIso('2026-12-01', '17:30'), toIso('2026-12-01', '18:30'), now)).toBe(
      'today, 17:30 to 18:30',
    );
    expect(whenText(toIso('2026-12-02', '07:00'), toIso('2026-12-02', '08:00'), now)).toBe(
      'tomorrow, Wednesday 2 December, 07:00 to 08:00',
    );
    expect(whenText(toIso('2026-12-04', '07:00'), toIso('2026-12-04', '08:00'), now)).toBe(
      'Friday 4 December, 07:00 to 08:00',
    );
  });
  it('follows South African midnight, not UTC’s', () => {
    // 00:30 on 2 December in South Africa is 22:30 UTC on 1 December
    expect(whenText('2026-12-01T22:30:00Z', '2026-12-01T23:30:00Z', '2026-12-01T21:00:00Z')).toBe(
      'tomorrow, Wednesday 2 December, 00:30 to 01:30',
    );
    expect(whenText('2026-12-01T22:30:00Z', '2026-12-01T23:30:00Z', '2026-12-01T22:10:00Z')).toBe(
      'today, 00:30 to 01:30',
    );
  });
});

describe('the reminder email', () => {
  const base = {
    clientName: 'Dan Dillon',
    trainerName: 'Alice <Fit>',
    trainerPhone: '082 111 2222',
    title: 'Training session',
    startsAt: toIso('2026-12-02', '07:00'),
    endsAt: toIso('2026-12-02', '08:00'),
    gym: 'Virgin Active Bedfordview',
    gymAddress: '1 Main Rd',
    portalUrl: 'https://app.example/portal',
    nowIso: '2026-12-01T10:00:00Z',
  };
  it('says what, when, where, who to tell, and how to stop reminders', () => {
    const m = reminderEmail(base);
    expect(m.subject).toBe('Reminder: training session tomorrow with Alice <Fit>');
    expect(m.text).toContain('Hi Dan,');
    expect(m.text).toContain('Tomorrow, Wednesday 2 December, 07:00 to 08:00');
    expect(m.text).toContain('Virgin Active Bedfordview, 1 Main Rd');
    expect(m.text).toContain('on 082 111 2222');
    expect(m.text).toContain('turn off reminders');
  });
  it('escapes anything that could break the html', () => {
    const m = reminderEmail(base);
    expect(m.html).toContain('Alice &lt;Fit&gt;');
    expect(m.html).not.toContain('<Fit>');
  });
  it('copes with no gym, no phone and no name', () => {
    const m = reminderEmail({
      ...base,
      gym: '',
      gymAddress: '',
      trainerPhone: '',
      clientName: '',
      trainerName: '',
    });
    expect(m.text).toContain('Hi there,');
    expect(m.text).toContain('with your trainer');
    expect(m.text).not.toContain(' on .');
  });
  it('the day subject for later in the week', () => {
    expect(
      reminderEmail({ ...base, startsAt: toIso('2026-12-04', '07:00'), endsAt: toIso('2026-12-04', '08:00') })
        .subject,
    ).toBe('Reminder: training session on Friday 4 December with Alice <Fit>');
    expect(
      reminderEmail({ ...base, startsAt: toIso('2026-12-01', '17:00'), endsAt: toIso('2026-12-01', '18:00') })
        .subject,
    ).toBe('Reminder: training session today with Alice <Fit>');
  });
});

describe('the calendar file attached to it', () => {
  it('is the same file the app makes for a calendar export', () => {
    const b = {
      id: 'x1',
      title: 'Training session with Alice',
      startsAt: '2026-12-02T05:00:00.000Z',
      endsAt: '2026-12-02T06:00:00.000Z',
      location: 'Virgin Active, 1 Main Rd',
    };
    const now = Date.parse('2026-12-01T10:00:00Z');
    expect(sessionIcs(b, new Date(now).toISOString())).toBe(toIcs([b], now));
  });
});

describe('settings and preferences from the database', () => {
  it('reads the trainer’s reminder settings and refuses nonsense', () => {
    expect(reminderSettingsFromRow({ session_reminders: true, reminder_hours: 48 })).toEqual({
      enabled: true,
      hours: 48,
    });
    expect(() => reminderSettingsFromRow({ session_reminders: true, reminder_hours: 0 })).toThrow();
  });
  it('reads the client’s reminder preferences', () => {
    expect(
      parseReminderPrefs([
        { client_id: 'c', trainer: null, trainer_sends: true, hours: 24, has_email: false, on: true },
      ]),
    ).toEqual([{ clientId: 'c', trainerName: '', trainerSends: true, hours: 24, hasEmail: false, on: true }]);
    expect(parseReminderPrefs(null)).toEqual([]);
  });
  it('a booking row says when its reminder went out', () => {
    const row = {
      id: 'a',
      client_id: null,
      gym_id: null,
      series_id: null,
      title: 'T',
      starts_at: '2026-12-02T05:00:00Z',
      ends_at: '2026-12-02T06:00:00Z',
      status: 'scheduled',
      client_response: 'pending',
      cancelled_by: null,
      notes: '',
    };
    expect(parseBookings([{ ...row, reminder_sent_at: '2026-12-01T05:00:00Z' }])[0]!.reminderSentAt).toBe(
      '2026-12-01T05:00:00Z',
    );
    expect(parseBookings([row])[0]!.reminderSentAt).toBeNull();
  });
});
