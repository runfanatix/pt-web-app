import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { addDays, toIso, todaySast, type Booking, type ReminderSettings } from '@pt/core';
import { App } from './App.tsx';
import { CalendarTab } from './components/CalendarTab.tsx';
import type { BookingsApi } from './data/bookings.ts';

const today = todaySast();

function fakeApi(initial: Booking[] = [], settings: ReminderSettings = { enabled: false, hours: 24 }) {
  const api: BookingsApi = {
    list: vi.fn(async () => initial),
    create: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    cancelSeriesFrom: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    reminderSettings: vi.fn(async () => settings),
    saveReminderSettings: vi.fn(async () => {}),
  };
  return api;
}
const mount = (api: BookingsApi, say = vi.fn()) => {
  render(<CalendarTab api={api} clients={[]} gyms={[]} openGymId="" trainerName="Alice" say={say} />);
  return say;
};

beforeEach(() => localStorage.clear());

describe('the trainer’s reminder settings', () => {
  it('shows whether reminders are on and how long before', async () => {
    mount(fakeApi([], { enabled: true, hours: 12 }));
    expect(await screen.findByText('On, 12 hours before')).toBeInTheDocument();
  });

  it('switching them on and choosing the time saves both', async () => {
    const api = fakeApi();
    const say = mount(api);
    fireEvent.click(await screen.findByText('Automatic reminders'));
    expect(screen.getByText('Off')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Email my clients a reminder before their sessions'));
    fireEvent.change(screen.getByLabelText('How long before'), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder settings' }));
    await waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalledWith({ enabled: true, hours: 48 }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Reminders are on: 48 hours before.'));
  });

  it('switching them off says so', async () => {
    const api = fakeApi([], { enabled: true, hours: 24 });
    const say = mount(api);
    fireEvent.click(await screen.findByText('Automatic reminders'));
    fireEvent.click(screen.getByLabelText('Email my clients a reminder before their sessions'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder settings' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Reminders are off.'));
  });

  it('a session whose reminder has gone out says so', async () => {
    const b: Booking = {
      id: 'a',
      clientId: null,
      gymId: null,
      seriesId: null,
      title: 'Training session',
      startsAt: toIso(today, '23:00'),
      endsAt: toIso(today, '23:59'),
      status: 'scheduled',
      response: 'pending',
      cancelledBy: null,
      notes: '',
      reminderSentAt: `${today}T05:00:00Z`,
    };
    mount(fakeApi([b]));
    expect(await screen.findByText(/reminder sent/)).toBeInTheDocument();
    void addDays;
  });
});

describe('the client’s reminder choice', () => {
  const SESSION = { user: { id: 'u1', email: 'dan@example.com' } } as unknown as Session;
  const overview = {
    email: 'dan@example.com',
    memberships: [
      {
        client_id: 'c1',
        client_name: 'Dan',
        trainer: {
          business_name: 'Alice Fitness',
          display_name: 'a',
          address: '',
          contact_email: '',
          contact_phone: '',
          information_officer_name: '',
          information_officer_email: '',
        },
        programmes: [],
        consents: [],
      },
    ],
  };
  async function open(prefs: unknown[]) {
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'portal_overview'
          ? overview
          : name === 'portal_reminder_prefs'
            ? prefs
            : name === 'portal_set_reminders'
              ? true
              : [],
      error: null,
    }));
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: SESSION } }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      rpc,
    } as unknown as SupabaseClient;
    render(<App client={client} pathname="/portal" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My sessions' }));
    return rpc;
  }
  const pref = (over: Record<string, unknown> = {}) => ({
    client_id: 'c1',
    trainer: 'Alice Fitness',
    trainer_sends: true,
    hours: 24,
    has_email: true,
    on: true,
    ...over,
  });

  it('offers a tick box when the trainer sends reminders, ticked when they are on', async () => {
    await open([pref()]);
    const box = await screen.findByLabelText('Email me a reminder 24 hours before each session');
    expect(box).toBeChecked();
  });

  it('turning it off tells the database and confirms', async () => {
    const rpc = await open([pref()]);
    fireEvent.click(await screen.findByLabelText('Email me a reminder 24 hours before each session'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('portal_set_reminders', { p_client_id: 'c1', p_on: false }),
    );
    expect(await screen.findByText(/Reminders are off/)).toBeInTheDocument();
  });

  it('shows nothing when the trainer does not send reminders', async () => {
    await open([pref({ trainer_sends: false })]);
    await screen.findByText('No sessions booked yet.');
    expect(screen.queryByText(/Email me a reminder/)).toBeNull();
  });

  it('a client with no email on file is told why, and cannot tick it', async () => {
    await open([pref({ has_email: false })]);
    const box = await screen.findByLabelText(/has no email address for you/);
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });
});
