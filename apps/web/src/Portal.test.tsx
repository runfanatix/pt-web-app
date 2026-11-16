import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { exercisesFor } from '@pt/core';
import { App } from './App.tsx';
import { PortalAccess } from './components/clients/PortalAccess.tsx';
import type { InviteApi, PortalAccount, PortalInvite } from './data/invites.ts';
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
        address: '1 Main Rd',
        contact_email: 'alice@fit.example',
        contact_phone: '082 111 2222',
        information_officer_name: 'Alice Smith',
        information_officer_email: 'io@fit.example',
      },
      programmes: [
        {
          id: 'p1',
          title: 'Starter',
          assigned_at: '2026-11-10T08:00:00Z',
          gym: 'Virgin Active Bedfordview',
          exercises: 2,
        },
      ],
      consents: [
        {
          purpose: 'privacy-notice',
          detail: '',
          granted: true,
          at: '2026-11-01T00:00:00Z',
          notice_version: '1.0',
        },
        {
          purpose: 'marketing',
          detail: '',
          granted: true,
          at: '2026-11-01T00:00:00Z',
          notice_version: '1.0',
        },
        {
          purpose: 'sharing',
          detail: 'Dr Smith',
          granted: false,
          at: '2026-11-02T00:00:00Z',
          notice_version: '1.0',
        },
      ],
    },
    {
      client_id: 'c2',
      client_name: 'Daniel D',
      trainer: {
        business_name: 'Bob Strength',
        display_name: 'bob',
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

const programme = {
  title: 'Starter',
  notes: 'Take it easy',
  assigned_at: '2026-11-10T08:00:00Z',
  trainer: 'Alice Fitness',
  gym: { name: 'Virgin Active', branch: 'Bedfordview', address: '101 Van Buuren Rd' },
  items: [
    {
      position: 0,
      equipment_id: machine.id,
      exercise_name: 'Squat',
      sets: 3,
      reps: '10',
      rest: 60,
      note: '',
      cue: '',
    },
  ],
  floors: bedfordviewFloorRows(),
};

function fakeClient(opts: { session?: Session | null; overview?: unknown } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'portal_overview') return { data: opts.overview ?? overview, error: null };
    if (name === 'portal_programme') return { data: programme, error: null };
    return { data: true, error: null };
  });
  const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: opts.session === undefined ? SESSION : opts.session } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOtp,
      signOut,
    },
    rpc,
  } as unknown as SupabaseClient;
  return { client, rpc, signInWithOtp, signOut };
}

const open = (f: ReturnType<typeof fakeClient>) => render(<App client={f.client} pathname="/portal" />);

beforeEach(() => localStorage.clear());

describe('the portal sign-in', () => {
  it('asks for an email, sends a sign-in link as a client, and says to check the inbox', async () => {
    const f = fakeClient({ session: null });
    open(f);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email address.');
    fireEvent.change(screen.getByLabelText('Your email address'), { target: { value: ' Dan@Example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    await waitFor(() => expect(f.signInWithOtp).toHaveBeenCalledTimes(1));
    const arg = f.signInWithOtp.mock.calls[0]![0];
    expect(arg.email).toBe('dan@example.com');
    expect(arg.options.data).toEqual({ role: 'client' });
    expect(arg.options.emailRedirectTo).toMatch(/\/portal$/);
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('shows the error if the link could not be sent', async () => {
    const f = fakeClient({ session: null });
    f.signInWithOtp.mockResolvedValueOnce({ data: {}, error: { message: 'Rate limit' } });
    open(f);
    fireEvent.change(await screen.findByLabelText('Your email address'), {
      target: { value: 'dan@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limit');
  });
});

describe('the portal home', () => {
  it('lists the programmes from each trainer separately, with no trainer app around it', async () => {
    open(fakeClient());
    expect(await screen.findByRole('heading', { name: 'My training' })).toBeInTheDocument();
    expect(screen.getByText('Alice Fitness')).toBeInTheDocument();
    expect(screen.getByText('Bob Strength')).toBeInTheDocument();
    expect(screen.getByText(/2 exercises · Virgin Active Bedfordview/)).toBeInTheDocument();
    expect(screen.getByText(/has not given you a programme yet/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Zones' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });

  it('opens a programme with the plan and exercises, and goes back', async () => {
    const f = fakeClient();
    const { container } = open(f);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Starter' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Starter' })).toBeInTheDocument();
    expect(f.rpc).toHaveBeenCalledWith('portal_programme', { p_programme_id: 'p1' });
    expect(container.querySelector('g.zone')).not.toBeNull();
    expect(screen.getByRole('list', { name: 'Exercises' })).toHaveTextContent('Squat');
    fireEvent.click(screen.getByRole('button', { name: /Back to my programmes/ }));
    expect(await screen.findByRole('heading', { name: 'My training' })).toBeInTheDocument();
  });

  it('says so when no trainer has invited this email yet', async () => {
    open(fakeClient({ overview: { email: 'dan@example.com', memberships: [] } }));
    expect(await screen.findByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
    expect(screen.getByText(/No trainer has invited/)).toHaveTextContent('dan@example.com');
  });

  it('signing out calls Supabase', async () => {
    const f = fakeClient();
    open(f);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(f.signOut).toHaveBeenCalled());
  });
});

describe('the portal privacy page', () => {
  async function openPrivacy(f = fakeClient()) {
    open(f);
    fireEvent.click(await screen.findByRole('tab', { name: 'My privacy' }));
    return f;
  }

  it('shows what was agreed, in plain words, and what was withdrawn', async () => {
    await openPrivacy();
    const card = screen.getByRole('region', { name: 'Privacy at Alice Fitness' });
    expect(within(card).getByText('My trainer keeping my details and training records')).toBeInTheDocument();
    expect(within(card).getByText('News and offers from my trainer')).toBeInTheDocument();
    expect(within(card).getByText('Sharing my information with Dr Smith')).toBeInTheDocument();
    expect(
      within(card).getByText(/If you withdraw this, your trainer can no longer keep/),
    ).toBeInTheDocument();
  });

  it('withdrawing takes two taps and tells the trainer', async () => {
    const f = await openPrivacy();
    const btn = screen.getByRole('button', { name: 'Withdraw: News and offers from my trainer' });
    fireEvent.click(btn);
    expect(f.rpc).not.toHaveBeenCalledWith('portal_withdraw_consent', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() =>
      expect(f.rpc).toHaveBeenCalledWith('portal_withdraw_consent', {
        p_client_id: 'c1',
        p_purpose: 'marketing',
        p_detail: '',
      }),
    );
    expect(await screen.findByText('Withdrawn. Your trainer has been told.')).toBeInTheDocument();
  });

  it('a request goes to the right trainer with the note', async () => {
    const f = await openPrivacy();
    const card = screen.getByRole('region', { name: 'Privacy at Alice Fitness' });
    fireEvent.change(within(card).getByLabelText(/Anything your trainer should know/), {
      target: { value: 'Please be quick' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Send me a copy of my information' }));
    await waitFor(() =>
      expect(f.rpc).toHaveBeenCalledWith('portal_request', {
        p_client_id: 'c1',
        p_kind: 'access',
        p_note: 'Please be quick',
      }),
    );
    expect(await screen.findByText('Sent. Your trainer will follow up.')).toBeInTheDocument();
  });

  it('shows the Information Officer', async () => {
    await openPrivacy();
    expect(screen.getByText(/Alice Smith \(io@fit.example\)/)).toBeInTheDocument();
  });
});

describe('inviting a client (the trainer’s side)', () => {
  function fakeInviteApi(initial: { invites?: PortalInvite[]; accounts?: PortalAccount[] } = {}) {
    let state = { invites: initial.invites ?? [], accounts: initial.accounts ?? [] };
    const api: InviteApi = {
      status: vi.fn(async () => state),
      create: vi.fn(async (_c: string, email: string) => {
        const id = `i${state.invites.length + 1}`;
        state = {
          ...state,
          invites: [
            {
              id,
              email,
              createdAt: '2026-11-20T00:00:00Z',
              expiresAt: '2099-01-01T00:00:00Z',
              emailedAt: null,
              acceptedAt: null,
              revokedAt: null,
            },
            ...state.invites,
          ],
        };
        return id;
      }),
      send: vi.fn(async () => true),
      cancel: vi.fn(async () => {}),
      switchOff: vi.fn(async () => {}),
    };
    return api;
  }
  const mount = (api: InviteApi, say = vi.fn()) => {
    render(
      <PortalAccess api={api} clientId="c1" clientName="Dan Dillon" email="dan@example.com" say={say} />,
    );
    return say;
  };

  it('starts as not invited, prefilled with the client’s email, and an invite is made and emailed', async () => {
    const api = fakeInviteApi();
    const say = mount(api);
    expect(await screen.findByText('Not invited')).toBeInTheDocument();
    expect(screen.getByLabelText('Their email address')).toHaveValue('dan@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Invite to the portal' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('c1', 'dan@example.com'));
    expect(api.send).toHaveBeenCalledWith('i1');
    await waitFor(() => expect(say).toHaveBeenCalledWith('Invitation emailed to dan@example.com.'));
    expect(await screen.findByText(/Invited: waiting/)).toBeInTheDocument();
  });

  it('when the email cannot be sent, the invite is kept and the trainer is told to send the link', async () => {
    const api = fakeInviteApi();
    vi.mocked(api.send).mockResolvedValueOnce(false);
    const say = mount(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite to the portal' }));
    await waitFor(() => expect(say).toHaveBeenCalled());
    expect(say.mock.calls[0]![0]).toMatch(/Invitation saved, but the email could not be sent/);
    expect(await screen.findByText(/Invited: waiting/)).toBeInTheDocument();
  });

  it('a bad email is refused with a message', async () => {
    const api = fakeInviteApi();
    vi.mocked(api.create).mockRejectedValueOnce(new Error('Enter a valid email address.'));
    mount(api);
    fireEvent.change(await screen.findByLabelText('Their email address'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite to the portal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
  });

  it('an invited client’s invitation can be sent again or cancelled with two taps', async () => {
    const api = fakeInviteApi({
      invites: [
        {
          id: 'i9',
          email: 'dan@example.com',
          createdAt: '2026-11-20T00:00:00Z',
          expiresAt: '2099-01-01T00:00:00Z',
          emailedAt: null,
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    });
    mount(api);
    expect(await screen.findByRole('button', { name: 'Send the invitation again' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the invitation' }));
    expect(api.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('i9'));
  });

  it('an active client shows as active and can be switched off with two taps', async () => {
    const api = fakeInviteApi({
      invites: [
        {
          id: 'i1',
          email: 'dan@example.com',
          createdAt: '2026-11-01T00:00:00Z',
          expiresAt: '2099-01-01T00:00:00Z',
          emailedAt: null,
          acceptedAt: '2026-11-02T00:00:00Z',
          revokedAt: null,
        },
      ],
      accounts: [{ id: 'a1', createdAt: '2026-11-02T00:00:00Z', revokedAt: null }],
    });
    mount(api);
    expect(await screen.findByText(/Active: they can sign in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite to the portal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch off portal access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(api.switchOff).toHaveBeenCalledWith('a1'));
  });
});
