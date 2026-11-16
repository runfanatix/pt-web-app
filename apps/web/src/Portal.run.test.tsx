import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { exercisesFor } from '@pt/core';
import { App } from './App.tsx';
import { bedfordviewData, bedfordviewFloorRows } from './test-utils.ts';

const data = bedfordviewData();
const machine = data.layout.equipment.find((e) => exercisesFor(data.library, e.id).length > 0)!;
const SESSION = { user: { id: 'u1', email: 'dan@example.com' } } as unknown as Session;

const overview = {
  email: 'dan@example.com',
  memberships: [
    {
      client_id: 'c1',
      client_name: 'Dan Dillon',
      trainer: {
        business_name: 'Alice Fitness',
        display_name: 'alice',
        address: '',
        contact_email: '',
        contact_phone: '',
        information_officer_name: '',
        information_officer_email: '',
      },
      programmes: [
        {
          id: 'p1',
          title: 'Starter',
          assigned_at: '2026-11-10T08:00:00Z',
          gym: 'Virgin Active',
          exercises: 1,
        },
      ],
      consents: [],
    },
  ],
};
const programme = {
  title: 'Starter',
  notes: '',
  assigned_at: '2026-11-10T08:00:00Z',
  trainer: 'Alice Fitness',
  gym: { name: 'Virgin Active', branch: 'Bedfordview', address: '' },
  items: [
    {
      position: 0,
      equipment_id: machine.id,
      exercise_name: 'Squat',
      sets: 1,
      reps: '10',
      rest: 0,
      note: '',
      cue: '',
    },
  ],
  floors: bedfordviewFloorRows(),
};
const workout = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  client_id: 'c1',
  title: 'Starter',
  run_date: '2026-11-12',
  total_ms: 125000,
  planned_min: 5,
  by_client: true,
  gym: 'Virgin Active',
  trainer: 'Alice Fitness',
  steps: [{ n: 1, machine: 'Press', exercise_name: 'Squat', sets: 1, reps: '10', ms: 125000, done: true }],
  ...over,
});

function fakeClient(history: unknown[] = []) {
  let list = history;
  const rpc = vi.fn(
    async (
      name: string,
      args?: Record<string, unknown>,
    ): Promise<{ data: unknown; error: { message: string } | null }> => {
      if (name === 'portal_overview') return { data: overview, error: null };
      if (name === 'portal_programme') return { data: programme, error: null };
      if (name === 'portal_history') return { data: list, error: null };
      if (name === 'portal_save_run') return { data: (args?.p_run as { id: string }).id, error: null };
      if (name === 'portal_delete_run') {
        list = list.filter((w) => (w as { id: string }).id !== args?.p_run_id);
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
  );
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: SESSION } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    rpc,
  } as unknown as SupabaseClient;
  return { client, rpc };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => vi.useRealTimers());

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('a client runs their own programme', () => {
  async function startRun(f = fakeClient()) {
    render(<App client={f.client} pathname="/portal" />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open Starter' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start workout' }));
    await flush();
    return f;
  }

  it('shows the run bar and the live plan, with no trainer tools, and only Start before it begins', async () => {
    const { container } = render(<App client={fakeClient().client} pathname="/portal" />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open Starter' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start workout' }));
    await flush();
    const bar = screen.getByRole('region', { name: 'Live workout' });
    expect(within(bar).getByRole('button', { name: 'Start workout' })).toBeInTheDocument();
    expect(container.querySelector('g.zone')).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Zones' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy log' })).toBeNull();
  });

  it('timing a workout to the end saves it for the client, once, with the time and steps', async () => {
    const f = await startRun();
    const bar = screen.getByRole('region', { name: 'Live workout' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Start workout' }));
    await flush(65_000);
    expect(within(bar).getByRole('timer')).toHaveTextContent('01:05');
    fireEvent.click(within(bar).getByRole('button', { name: /^(Done, finish|Finish)/ }));
    await flush();
    const save = f.rpc.mock.calls.filter((c) => c[0] === 'portal_save_run');
    expect(save).toHaveLength(1);
    const args = save[0]![1] as { p_programme_id: string; p_run: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(args.p_programme_id).toBe('p1');
    expect(args.p_run.total_ms).toBe(65_000);
    expect(args.p_run.title).toBe('Starter');
    expect(args.p_run.steps).toHaveLength(1);
    expect(args.p_run.steps[0]).toMatchObject({
      exercise_name: 'Squat',
      done: true,
      equipment_id: machine.id,
    });
    expect(
      screen.getByText(/Well done! Workout finished in 01:05 and saved to your history/),
    ).toBeInTheDocument();
  }, 30_000);

  it('if saving fails the client is told, not left thinking it worked', async () => {
    const f = fakeClient();
    const base = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) =>
      name === 'portal_save_run' ? { data: null, error: { message: 'offline' } } : base(name, args),
    );
    await startRun(f);
    const bar = screen.getByRole('region', { name: 'Live workout' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Start workout' }));
    await flush(10_000);
    fireEvent.click(within(bar).getByRole('button', { name: /^(Done, finish|Finish)/ }));
    await flush();
    expect(screen.getByText(/could not be saved: offline/)).toBeInTheDocument();
  });

  it('a workout that never started is not saved', async () => {
    const f = await startRun();
    fireEvent.click(screen.getByRole('button', { name: /Back to my programme/ }));
    await flush();
    expect(f.rpc.mock.calls.some((c) => c[0] === 'portal_save_run')).toBe(false);
  });
});

describe('my workouts', () => {
  async function open(history: unknown[]) {
    const f = fakeClient(history);
    render(<App client={f.client} pathname="/portal" />);
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'My workouts' }));
    await flush();
    return f;
  }

  it('says so when there are none yet', async () => {
    await open([]);
    expect(screen.getByText('No workouts yet')).toBeInTheDocument();
  });

  it('lists the client’s own workouts and the trainer’s records, labelled', async () => {
    await open([workout(), workout({ id: 'w2', title: 'Trainer session', by_client: false })]);
    const list = screen.getByRole('list', { name: 'Workouts' });
    expect(within(list).getByText(/done by you/)).toBeInTheDocument();
    expect(within(list).getByText(/recorded by Alice Fitness/)).toBeInTheDocument();
    expect(within(list).getAllByText(/02:05/)).not.toHaveLength(0);
  });

  it('only the client’s own can be deleted, with two taps', async () => {
    const f = await open([workout(), workout({ id: 'w2', title: 'Trainer session', by_client: false })]);
    expect(screen.queryByRole('button', { name: 'Delete workout Trainer session' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete workout Starter' }));
    expect(f.rpc.mock.calls.some((c) => c[0] === 'portal_delete_run')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await flush();
    expect(f.rpc).toHaveBeenCalledWith('portal_delete_run', { p_run_id: 'w1' });
    await flush();
    expect(screen.queryByText(/done by you/)).toBeNull();
  });
});
