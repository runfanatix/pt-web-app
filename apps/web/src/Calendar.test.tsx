import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  fromIso,
  todaySast,
  toIso,
  type Booking,
  type BookingRowInput,
  type ClientRecord,
  type GymSummary,
} from '@pt/core';
import { App } from './App.tsx';
import { CalendarTab } from './components/CalendarTab.tsx';
import type { BookingPatch, BookingsApi } from './data/bookings.ts';

const today = todaySast();
const clientRec = (id: string, name: string, whatsapp = ''): ClientRecord =>
  ({
    client: { id, name, whatsapp },
    consents: [],
    programmes: [],
    createdAt: '2026-01-01T00:00:00Z',
  }) as unknown as ClientRecord;
const clients = [clientRec('c1', 'Dan Dillon', '082 555 0100'), clientRec('c2', 'Eve Evans')];
const gyms: GymSummary[] = [
  { id: 'g1', name: 'Virgin Active', branch: 'Bedfordview', address: '1 Main Rd', phone: '', notes: '' },
];

function booking(over: Partial<Booking> & { id: string }): Booking {
  return {
    clientId: 'c1',
    gymId: 'g1',
    seriesId: null,
    title: 'Training session',
    startsAt: toIso(addDays(today, 1), '09:00'),
    endsAt: toIso(addDays(today, 1), '10:00'),
    status: 'scheduled',
    response: 'pending',
    cancelledBy: null,
    notes: '',
    ...over,
  };
}

function fakeApi(initial: Booking[] = []) {
  let rows = [...initial];
  const created: BookingRowInput[][] = [];
  const api: BookingsApi = {
    list: vi.fn(async (from: string, to: string) =>
      rows
        .filter((b) => b.startsAt >= from && b.startsAt < to)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    ),
    create: vi.fn(async (r: BookingRowInput[]) => {
      created.push(r);
      rows = [
        ...rows,
        ...r.map((x, i) => ({
          id: `n${rows.length + i}`,
          clientId: x.client_id,
          gymId: x.gym_id,
          seriesId: x.series_id,
          title: x.title,
          startsAt: x.starts_at,
          endsAt: x.ends_at,
          status: 'scheduled' as const,
          response: 'pending' as const,
          cancelledBy: null,
          notes: x.notes,
        })),
      ];
    }),
    update: vi.fn(async (id: string, p: BookingPatch) => {
      rows = rows.map((b) =>
        b.id === id
          ? {
              ...b,
              ...(p.status ? { status: p.status } : {}),
              ...(p.starts_at ? { startsAt: p.starts_at } : {}),
              ...(p.ends_at ? { endsAt: p.ends_at } : {}),
              ...(p.title ? { title: p.title } : {}),
              ...(p.client_response ? { response: p.client_response } : {}),
            }
          : b,
      );
    }),
    cancelSeriesFrom: vi.fn(async (series: string, from: string) => {
      rows = rows.map((b) =>
        b.seriesId === series && b.startsAt >= from && b.status === 'scheduled'
          ? { ...b, status: 'cancelled' as const }
          : b,
      );
    }),
    remove: vi.fn(async (id: string) => {
      rows = rows.filter((b) => b.id !== id);
    }),
    reminderSettings: vi.fn(async () => ({ enabled: false, hours: 24 })),
    saveReminderSettings: vi.fn(async () => {}),
  };
  return { api, created };
}

function mount(f = fakeApi(), say = vi.fn()) {
  render(
    <CalendarTab
      api={f.api}
      clients={clients}
      gyms={gyms}
      openGymId="g1"
      trainerName="Alice Fitness"
      say={say}
    />,
  );
  return { ...f, say };
}

beforeEach(() => localStorage.clear());

describe('the calendar', () => {
  it('opens on this month with today marked, and a day shows its sessions earliest first', async () => {
    mount(
      fakeApi([
        booking({ id: 'a', startsAt: toIso(today, '15:00'), endsAt: toIso(today, '16:00') }),
        booking({ id: 'b', clientId: 'c2', startsAt: toIso(today, '07:00'), endsAt: toIso(today, '08:00') }),
      ]),
    );
    const day = await screen.findByRole('list', { name: /^Sessions on/ });
    const items = within(day).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('07:00');
    expect(items[0]).toHaveTextContent('Eve Evans');
    expect(items[1]).toHaveTextContent('15:00');
    expect(items[1]).toHaveTextContent('Dan Dillon');
    expect(screen.getByRole('gridcell', { name: /2 sessions/ })).toBeInTheDocument();
  });

  it('tapping another day shows that day, and Today comes back', async () => {
    mount(
      fakeApi([
        booking({
          id: 'a',
          startsAt: toIso(addDays(today, 1), '09:00'),
          endsAt: toIso(addDays(today, 1), '10:00'),
        }),
      ]),
    );
    await screen.findByText(/Nothing booked|Sessions/);
    fireEvent.click(screen.getByRole('gridcell', { name: /1 session$/ }));
    expect(await screen.findByRole('list', { name: /^Sessions on/ })).toHaveTextContent('Dan Dillon');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('Nothing booked.')).toBeInTheDocument();
  });

  it('books a session: needs a date and time, then saves it with the right moments', async () => {
    const f = mount();
    await screen.findByText('Nothing booked.');
    fireEvent.click(screen.getByRole('button', { name: 'Book a session' }));
    const form = screen.getByRole('region', { name: 'Book a session' });
    fireEvent.change(within(form).getByLabelText('Client'), { target: { value: 'c1' } });
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: addDays(today, 2) } });
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '06:30' } });
    fireEvent.change(within(form).getByLabelText('Length (minutes)'), { target: { value: '45' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Book it' }));
    await waitFor(() => expect(f.api.create).toHaveBeenCalledTimes(1));
    const row = f.created[0]![0]!;
    expect(row).toMatchObject({ client_id: 'c1', gym_id: 'g1', title: 'Training session', series_id: null });
    expect(fromIso(row.starts_at)).toEqual({ date: addDays(today, 2), time: '06:30' });
    expect(Date.parse(row.ends_at) - Date.parse(row.starts_at)).toBe(45 * 60000);
    expect(f.say).toHaveBeenCalledWith('Session booked.');
  });

  it('a form with no title is refused with a message', async () => {
    const f = mount();
    await screen.findByText('Nothing booked.');
    fireEvent.click(screen.getByRole('button', { name: 'Book a session' }));
    const form = screen.getByRole('region', { name: 'Book a session' });
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: ' ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Book it' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give the session a title.');
    expect(f.api.create).not.toHaveBeenCalled();
  });

  it('repeating weekly makes one session a week, sharing a series', async () => {
    const f = mount();
    await screen.findByText('Nothing booked.');
    fireEvent.click(screen.getByRole('button', { name: 'Book a session' }));
    const form = screen.getByRole('region', { name: 'Book a session' });
    fireEvent.change(within(form).getByLabelText('Client'), { target: { value: 'c1' } });
    fireEvent.change(within(form).getByLabelText('Repeat every week for'), { target: { value: '4' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Book it' }));
    await waitFor(() => expect(f.api.create).toHaveBeenCalled());
    const rows = f.created[0]!;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.series_id)).size).toBe(1);
    expect(rows[0]!.series_id).not.toBeNull();
    expect(fromIso(rows[3]!.starts_at).date).toBe(addDays(today, 21));
    expect(f.say).toHaveBeenCalledWith('4 weekly sessions booked.');
  });

  it('warns when the new time clashes with a session, and still lets it be saved', async () => {
    const f = mount(
      fakeApi([booking({ id: 'a', startsAt: toIso(today, '07:00'), endsAt: toIso(today, '08:00') })]),
    );
    await screen.findByRole('list', { name: /^Sessions on/ });
    fireEvent.click(screen.getByRole('button', { name: 'Book a session' }));
    const form = screen.getByRole('region', { name: 'Book a session' });
    expect(within(form).getByRole('status')).toHaveTextContent('Clash: Dan Dillon at 07:00 to 08:00');
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '08:00' } });
    expect(within(form).queryByRole('status')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '07:30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Book it' }));
    await waitFor(() => expect(f.api.create).toHaveBeenCalled());
  });

  it('marks a session done, and a missed one as did not come', async () => {
    const f = mount(
      fakeApi([
        booking({ id: 'a', startsAt: toIso(today, '07:00'), endsAt: toIso(today, '08:00') }),
        booking({ id: 'b', startsAt: toIso(today, '09:00'), endsAt: toIso(today, '10:00') }),
      ]),
    );
    const day = await screen.findByRole('list', { name: /^Sessions on/ });
    const [first, second] = within(day).getAllByRole('listitem');
    fireEvent.click(within(first!).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(f.api.update).toHaveBeenCalledWith('a', { status: 'completed', cancelled_by: null }),
    );
    fireEvent.click(within(second!).getByRole('button', { name: 'Did not come' }));
    await waitFor(() =>
      expect(f.api.update).toHaveBeenCalledWith('b', { status: 'no_show', cancelled_by: null }),
    );
    expect(await screen.findByText(/Did not come$/)).toBeInTheDocument();
  });

  it('cancelling takes two taps; a series offers cancelling the rest too', async () => {
    const f = mount(
      fakeApi([
        booking({ id: 'a', seriesId: 's', startsAt: toIso(today, '07:00'), endsAt: toIso(today, '08:00') }),
        booking({
          id: 'b',
          seriesId: 's',
          startsAt: toIso(addDays(today, 7), '07:00'),
          endsAt: toIso(addDays(today, 7), '08:00'),
        }),
      ]),
    );
    await screen.findByRole('list', { name: /^Sessions on/ });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel this and all later/ }));
    expect(f.api.cancelSeriesFrom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(f.api.cancelSeriesFrom).toHaveBeenCalledWith('s', toIso(today, '07:00')));
  });

  it('shows what the client answered, and editing the time resets it', async () => {
    const f = mount(
      fakeApi([
        booking({
          id: 'a',
          response: 'confirmed',
          startsAt: toIso(today, '07:00'),
          endsAt: toIso(today, '08:00'),
        }),
      ]),
    );
    await screen.findByText(/Confirmed/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('region', { name: 'Edit session' });
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '08:30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(f.api.update).toHaveBeenCalled());
    const patch = vi.mocked(f.api.update).mock.calls[0]![1];
    expect(patch.client_response).toBe('pending');
    expect(fromIso(patch.starts_at!).time).toBe('08:30');
  });

  it('a WhatsApp reminder link has the client’s number and the details', async () => {
    mount(
      fakeApi([
        booking({
          id: 'a',
          startsAt: toIso(addDays(today, 1), '07:00'),
          endsAt: toIso(addDays(today, 1), '08:00'),
        }),
      ]),
    );
    fireEvent.click(await screen.findByRole('gridcell', { name: /1 session$/ }));
    const link = await screen.findByRole('link', { name: 'Remind on WhatsApp' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/27825550100\?text=/);
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain(
      'Hi Dan, a reminder of your training session with Alice Fitness',
    );
  });

  it('week view lists seven days', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(await screen.findAllByText('Nothing booked.')).toHaveLength(7);
  });
});

describe('the client’s sessions', () => {
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
  const row = (id: string, offsetDays: number, over: Record<string, unknown> = {}) => ({
    id,
    client_id: 'c1',
    title: 'Training session',
    starts_at: toIso(addDays(today, offsetDays), '09:00'),
    ends_at: toIso(addDays(today, offsetDays), '10:00'),
    status: 'scheduled',
    client_response: 'pending',
    cancelled_by: null,
    gym: 'Virgin Active Bedfordview',
    gym_address: '1 Main Rd',
    trainer: 'Alice Fitness',
    ...over,
  });
  function client(rows: unknown[]) {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'portal_overview') return { data: overview, error: null };
      if (name === 'portal_bookings') return { data: rows, error: null };
      if (name === 'portal_respond_booking') return { data: true, error: null };
      return { data: null, error: null };
    });
    return {
      rpc,
      client: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: SESSION } }),
          onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        },
        rpc,
      } as unknown as SupabaseClient,
    };
  }
  async function open(rows: unknown[]) {
    const c = client(rows);
    render(<App client={c.client} pathname="/portal" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My sessions' }));
    return c;
  }

  it('lists what is coming up, with where and when, and what has happened', async () => {
    await open([
      row('a', 2),
      row('b', -3, { status: 'completed' }),
      row('c', -9, { status: 'cancelled', cancelled_by: 'trainer' }),
    ]);
    const up = await screen.findByRole('list', { name: 'Upcoming sessions' });
    expect(up).toHaveTextContent('09:00 to 10:00');
    expect(up).toHaveTextContent('Virgin Active Bedfordview, 1 Main Rd');
    expect(up).toHaveTextContent('Not answered');
    const earlier = screen.getByRole('list', { name: 'Earlier sessions' });
    expect(earlier).toHaveTextContent('Done');
    expect(earlier).toHaveTextContent('Cancelled by your trainer');
  });

  it('confirming and declining go to the trainer', async () => {
    const c = await open([row('a', 2)]);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirm Training session/ }));
    await waitFor(() =>
      expect(c.rpc).toHaveBeenCalledWith('portal_respond_booking', {
        p_booking_id: 'a',
        p_response: 'confirmed',
      }),
    );
    expect(await screen.findByText('Thanks, your trainer knows you will be there.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cannot make Training session/ }));
    await waitFor(() =>
      expect(c.rpc).toHaveBeenCalledWith('portal_respond_booking', {
        p_booking_id: 'a',
        p_response: 'declined',
      }),
    );
  });

  it('says so when nothing is booked, and offers no calendar file', async () => {
    await open([]);
    expect(await screen.findByText('No sessions booked yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add these to my calendar' })).toBeNull();
  });

  it('saves the upcoming sessions as a calendar file', async () => {
    const created: string[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => (
      created.push(String((b as Blob).size)),
      'blob:x'
    )) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    await open([row('a', 2)]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add these to my calendar' }));
    expect(created).toHaveLength(1);
    expect(Number(created[0])).toBeGreaterThan(100);
    URL.createObjectURL = orig;
  });
});
