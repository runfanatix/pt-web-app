import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { PRIVACY_NOTICE_VERSION } from '@pt/core';
import { App } from './App.tsx';
import { bedfordviewFloorRows } from './test-utils.ts';

interface FakeOptions {
  session?: Session | null;
  gyms?: unknown[];
  gymsError?: string;
  floors?: unknown[];
  floorsError?: string;
}

/** Minimal stand-in for the Supabase client: just the calls the app makes. */
function fakeClient(opts: FakeOptions = {}) {
  const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const order = vi
    .fn()
    .mockResolvedValue(
      opts.gymsError
        ? { data: null, error: { message: opts.gymsError } }
        : { data: opts.gyms ?? [], error: null },
    );
  const floorsOrder = vi
    .fn()
    .mockResolvedValue(
      opts.floorsError
        ? { data: null, error: { message: opts.floorsError } }
        : { data: opts.floors ?? [], error: null },
    );
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: opts.session ?? null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signUp,
      signInWithPassword,
      signOut,
    },
    from: vi.fn((table: string) =>
      table === 'gyms'
        ? { select: vi.fn().mockReturnValue({ order }) }
        : { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: floorsOrder }) }) },
    ),
  };
  return { client: client as unknown as SupabaseClient, signUp, signInWithPassword, signOut };
}

const session = { user: { id: 'u1' } } as unknown as Session;
const gym = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
  updated_at: '2026-11-15T00:00:00Z',
};

describe('App', () => {
  it('asks for configuration when there is no Supabase client', () => {
    render(<App client={null} />);
    expect(screen.getByRole('heading', { name: 'Connect your database' })).toBeInTheDocument();
  });

  it('shows the sign-in screen when signed out', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in with email and password', async () => {
    const { client, signInWithPassword } = fakeClient();
    render(<App client={client} />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pt@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({ email: 'pt@example.com', password: 'correct horse' }),
    );
  });

  it('will not create an account until the privacy notice is accepted, then records the notice version', async () => {
    const { client, signUp } = fakeClient();
    render(<App client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create a trainer account' }));
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat Trainer' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: 'pat@example.com',
        password: 'longenough1',
        options: { data: { display_name: 'Pat Trainer', privacy_notice_version: PRIVACY_NOTICE_VERSION } },
      }),
    );
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument();
  });

  it('shows a sign-in error from Supabase', async () => {
    const { client, signInWithPassword } = fakeClient();
    signInWithPassword.mockResolvedValue({ data: {}, error: new Error('Invalid login credentials') });
    render(<App client={client} />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pt@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongwrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });

  it("loads the signed-in trainer's gym from the database into the planner", async () => {
    const { client } = fakeClient({ session, gyms: [gym] });
    render(<App client={client} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' }),
    ).toBeInTheDocument();
    expect(client.from).toHaveBeenCalledWith('gyms');
  });

  it('reports a database error instead of crashing', async () => {
    const { client } = fakeClient({ session, gymsError: 'permission denied' });
    render(<App client={client} />);
    expect(await screen.findByText(/Could not load your gyms: permission denied/)).toBeInTheDocument();
  });

  it('rejects malformed gym rows (validated with Zod)', async () => {
    const { client } = fakeClient({ session, gyms: [{ id: 'g1' }] });
    render(<App client={client} />);
    expect(await screen.findByText(/Could not load your gyms/)).toBeInTheDocument();
  });

  it('draws the floor plan read from the database (one nested query, validated)', async () => {
    const { client } = fakeClient({ session, gyms: [gym], floors: bedfordviewFloorRows() });
    const { container } = render(<App client={client} />);
    expect(
      await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' }),
    ).toBeInTheDocument();
    expect(client.from).toHaveBeenCalledWith('floors');
    expect(container.querySelectorAll('g.zone').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Floors' })).toBeInTheDocument();
  });

  it('reports a floor-plan error without losing the rest of the page', async () => {
    const { client } = fakeClient({
      session,
      gyms: [gym],
      floorsError: 'permission denied for table floors',
    });
    render(<App client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the floor plan: permission denied',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeInTheDocument();
  });

  it('signs out', async () => {
    const { client, signOut } = fakeClient({ session, gyms: [gym] });
    render(<App client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
