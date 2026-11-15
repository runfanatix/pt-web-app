import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exercisesFor } from '@pt/core';
import { App } from './App.tsx';
import { PublicProgramme } from './components/PublicProgramme.tsx';
import { SendActions } from './components/SendActions.tsx';
import { SharePanel } from './components/clients/SharePanel.tsx';
import type { ShareApi, ShareLink } from './data/share.ts';
import { savePdf } from './lib/pdf.ts';
import { buildShare } from './lib/shareModel.ts';
import { bedfordviewData, bedfordviewFloorRows } from './test-utils.ts';

// Saving a file needs a browser download; the tests check what would be saved instead.
vi.mock('./lib/pdf.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/pdf.ts')>()),
  savePdf: vi.fn(),
}));

const data = bedfordviewData();
const layout = data.layout;
const machine = layout.equipment.find((e) => exercisesFor(data.library, e.id).length > 0)!;
const exercise = exercisesFor(data.library, machine.id)[0]!;
const TOKEN = 'a'.repeat(64);

/** What the database function returns for a programme in the Bedfordview gym. */
function sharedJson(over: Record<string, unknown> = {}) {
  return {
    title: 'Starter',
    notes: 'Take it easy',
    assigned_at: '2026-11-09T08:00:00+00:00',
    trainer: 'Alice Fitness',
    gym: { name: 'Virgin Active', branch: 'Bedfordview', address: '101 Van Buuren Rd' },
    items: [
      {
        position: 1,
        equipment_id: null,
        exercise_name: 'Plank',
        sets: 3,
        reps: '30 s',
        rest: 45,
        note: '',
        cue: 'Brace your core',
      },
      {
        position: 0,
        equipment_id: machine.id,
        exercise_name: exercise.name,
        sets: 1,
        reps: '8 min',
        rest: 0,
        note: 'Easy pace',
        cue: '',
      },
    ],
    floors: bedfordviewFloorRows(),
    ...over,
  };
}

function fakeClient(result: { data: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: result.data, error: result.error ?? null }));
  const getSession = vi.fn(async () => ({ data: { session: null } }));
  const client = {
    rpc,
    auth: {
      getSession,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  };
  return { client: client as unknown as SupabaseClient, rpc, getSession };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the public client page', () => {
  it('shows the programme with no sign-in: trainer, gym, notes, ordered exercises with cues, and the plan with the route', async () => {
    const { client, rpc } = fakeClient({ data: sharedJson() });
    const { container } = render(<PublicProgramme client={client} token={TOKEN} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Starter' })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('get_shared_programme', { p_token: TOKEN });
    expect(
      screen.getByText(/Alice Fitness · Virgin Active Bedfordview, 101 Van Buuren Rd/),
    ).toBeInTheDocument();
    expect(screen.getByText('Take it easy')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Exercises' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(exercise.name);
    expect(rows[0]).toHaveTextContent('1 x 8 min');
    expect(rows[0]).toHaveTextContent('Easy pace');
    expect(rows[1]).toHaveTextContent('Plank');
    expect(rows[1]).toHaveTextContent('3 x 30 s · rest 45 s');
    expect(rows[1]).toHaveTextContent('Cue: Brace your core');
    // the plan is drawn with the first machine numbered
    expect(
      screen.getByRole('group', { name: 'Floor plan with training zones and equipment' }),
    ).toBeInTheDocument();
    expect(container.querySelector(`g.mk[data-eq="${machine.id}"] .bdt`)).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Save as PDF' })).toBeInTheDocument();
  });

  it('has no sign-in, no tabs and no way into the rest of the app', async () => {
    const { client } = fakeClient({ data: sharedJson() });
    render(<PublicProgramme client={client} token={TOKEN} />);
    await screen.findByRole('heading', { level: 1, name: 'Starter' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Clients|Session \(|Edit layout/);
  });

  it('tells the client when the link no longer works', async () => {
    const { client } = fakeClient({ data: null });
    render(<PublicProgramme client={client} token={TOKEN} />);
    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask your trainer for a new one/)).toBeInTheDocument();
  });

  it('reports an error, and copes with a programme that has no gym', async () => {
    const bad = fakeClient({ data: null, error: { message: 'network down' } });
    const first = render(<PublicProgramme client={bad.client} token={TOKEN} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    first.unmount();
    const { client } = fakeClient({ data: sharedJson({ gym: null, floors: [] }) });
    render(<PublicProgramme client={client} token={TOKEN} />);
    expect(await screen.findByText('There is no gym plan for this programme.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Exercises' })).toBeInTheDocument();
  });

  it('saves a PDF that has no client name on it', async () => {
    const { client } = fakeClient({ data: sharedJson() });
    render(<PublicProgramme client={client} token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as PDF' }));
    expect(savePdf).toHaveBeenCalledTimes(1);
    const [model, fileName] = vi.mocked(savePdf).mock.calls[0]!;
    expect(fileName).toBe('training-programme-2026-11-09.pdf');
    expect(model).toMatchObject({ title: 'Starter', client: '', coach: '', date: '2026-11-09' });
    expect(model.items.map((i) => i.exercise)).toEqual([exercise.name, 'Plank']);
    expect(JSON.stringify(model)).not.toMatch(/private|whatsapp|@/i);
  });
});

describe('opening a link', () => {
  it('/p/<token> shows the public page without ever asking who is signed in', async () => {
    const { client, getSession } = fakeClient({ data: sharedJson() });
    render(<App client={client} pathname={`/p/${TOKEN}`} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Starter' })).toBeInTheDocument();
    expect(getSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
  });

  it('any other path is the trainer’s app, which asks for a sign-in', async () => {
    const { client } = fakeClient({ data: null });
    render(<App client={client} pathname="/" />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    render(<App client={client} pathname={`/p/short`} />);
    expect((await screen.findAllByRole('heading', { name: 'Sign in' })).length).toBeGreaterThan(0);
  });
});

describe('send actions', () => {
  const programme = buildShare({
    title: 'Starter',
    client: 'Sam Smith',
    coach: 'Dee',
    date: '2026-11-15',
    notes: '',
    gym: 'Virgin Active Bedfordview, 101 Van Buuren Rd',
    items: [
      { eid: machine.id, xid: exercise.id, exercise: exercise.name, sets: 3, reps: '10', rest: 60, note: '' },
    ],
    layout,
    library: data.library,
  });

  it('opens WhatsApp with the client’s number and the message, and mail with the subject', () => {
    render(
      <SendActions
        pdf={programme.pdf}
        whatsapp="082 123 4567"
        email="sam@example.com"
        link="https://app.example/p/abc"
      />,
    );
    const wa = screen.getByRole('link', { name: '2. Open WhatsApp' }).getAttribute('href')!;
    expect(wa.startsWith('https://wa.me/27821234567?text=')).toBe(true);
    const message = decodeURIComponent(wa.split('?text=')[1]!);
    expect(message).toContain('Hi Sam,');
    expect(message).toContain(`1. ${exercise.name} (${machine.name}`);
    expect(message).toContain('See it on the gym plan: https://app.example/p/abc');
    const mail = screen.getByRole('link', { name: '2. Open email' }).getAttribute('href')!;
    expect(mail.startsWith('mailto:sam%40example.com?subject=Starter&body=')).toBe(true);
    expect(decodeURIComponent(mail)).not.toContain('*');
  });

  it('the number and address can be changed for this send', () => {
    render(<SendActions pdf={programme.pdf} />);
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '0116543210' } });
    expect(screen.getByRole('link', { name: '2. Open WhatsApp' }).getAttribute('href')).toContain(
      'wa.me/27116543210',
    );
  });

  it('copies the message and saves the PDF', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SendActions pdf={programme.pdf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Message copied.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1. Save PDF' }));
    expect(savePdf).toHaveBeenCalledWith(programme.pdf, 'training-programme-Sam-Smith-2026-11-15.pdf');
    expect(await screen.findByText(/PDF saved/)).toBeInTheDocument();
  });
});

/** In-memory stand-in for the share links table. */
function fakeShare(initial: ShareLink[] = []) {
  const store = [...initial];
  const api: ShareApi = {
    list: vi.fn(async () => store.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    create: vi.fn(async (_programmeId: string, days: number | null) => {
      const l: ShareLink = {
        token: `${store.length}`.padStart(64, 'b'),
        createdAt: new Date().toISOString(),
        expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
        revokedAt: null,
      };
      store.push(l);
      return l;
    }),
    revoke: vi.fn(async (token: string) => {
      const l = store.find((x) => x.token === token);
      if (l) l.revokedAt = new Date().toISOString();
    }),
  };
  return { api, store };
}

describe('share panel for a programme', () => {
  const pdf = buildShare({
    title: 'Starter',
    client: 'Sam Smith',
    coach: '',
    date: '2026-11-09',
    notes: '',
    gym: 'Virgin Active Bedfordview',
    items: [
      { eid: machine.id, xid: exercise.id, exercise: exercise.name, sets: 3, reps: '10', rest: 60, note: '' },
    ],
    layout,
    library: data.library,
  }).pdf;
  const say = vi.fn();
  const mount = (share = fakeShare()) => {
    render(
      <SharePanel
        programmeId="p1"
        title="Starter"
        api={share.api}
        pdf={pdf}
        whatsapp="082 111 2222"
        email="sam@example.com"
        say={say}
      />,
    );
    return share;
  };

  it('creates a link that lasts 90 days by default, shows it, and puts it in the message', async () => {
    const share = mount();
    expect(await screen.findByText('No links yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create a link' }));
    await waitFor(() => expect(share.api.create).toHaveBeenCalledWith('p1', 90));
    const url = await screen.findByRole('textbox', { name: 'Client link' });
    expect((url as HTMLInputElement).value).toBe(`${window.location.origin}/p/${share.store[0]!.token}`);
    const wa = screen.getByRole('link', { name: '2. Open WhatsApp' }).getAttribute('href')!;
    expect(decodeURIComponent(wa)).toContain(`See it on the gym plan: ${window.location.origin}/p/`);
  });

  it('can make a link that never expires, or lasts a week', async () => {
    const share = mount();
    await screen.findByText('No links yet.');
    fireEvent.change(screen.getByLabelText('Link lifetime'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a link' }));
    await waitFor(() => expect(share.api.create).toHaveBeenLastCalledWith('p1', null));
    fireEvent.change(screen.getByLabelText('Link lifetime'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a link' }));
    await waitFor(() => expect(share.api.create).toHaveBeenLastCalledWith('p1', 7));
    expect(await screen.findAllByText(/^Active/)).toHaveLength(2);
  });

  it('switching a link off takes two taps, and the link is then shown as switched off', async () => {
    const share = mount();
    await screen.findByText('No links yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Create a link' }));
    const off = await screen.findByRole('button', { name: /^Switch off link ending/ });
    fireEvent.click(off);
    expect(share.api.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(share.api.revoke).toHaveBeenCalledWith(share.store[0]!.token));
    expect(await screen.findByText(/^Switched off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy link ending/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Client link' })).toBeNull();
  });

  it('shows an expired link as expired with no copy button', async () => {
    const old: ShareLink = {
      token: 'c'.repeat(64),
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-02-01T00:00:00Z',
      revokedAt: null,
    };
    mount(fakeShare([old]));
    expect(await screen.findByText(/^Expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy link ending/ })).toBeNull();
  });

  it('states what the link shows and what it never shows', async () => {
    mount();
    expect(
      await screen.findByText(/never contact details, notes or anything else about the client/),
    ).toBeInTheDocument();
  });
});

describe('the routine message and PDF carry only the programme', () => {
  it('buildShare never includes anything it was not given', () => {
    const { model, pdf } = buildShare({
      title: 'Starter',
      client: 'Sam',
      coach: '',
      date: '2026-11-09',
      notes: '',
      gym: 'Gym',
      items: [
        {
          eid: machine.id,
          xid: exercise.id,
          exercise: exercise.name,
          sets: 3,
          reps: '10',
          rest: 60,
          note: '',
        },
      ],
      layout,
      library: data.library,
    });
    const text = JSON.stringify({ model, pdfItems: pdf.items });
    expect(text).not.toMatch(/private|whatsapp|@|goals|emergency/i);
    expect(model.items[0]!.machine).toBe(machine.name);
    // items from another gym keep their exercises but lose machine names and the map
    const away = buildShare({
      title: 'T',
      client: '',
      coach: '',
      date: '',
      notes: '',
      gym: '',
      items: [{ eid: machine.id, xid: null, exercise: 'X', sets: 1, reps: '1', rest: 0, note: '' }],
      layout: null,
    });
    expect(away.model.items[0]).toMatchObject({ exercise: 'X', machine: '', zone: '' });
    expect(away.pdf.layout).toBeNull();
  });
});
