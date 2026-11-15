import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  exercisesFor,
  type Client,
  type ClientRecord,
  type ConsentRecord,
  type GymSummary,
  type TrainerProfile,
} from '@pt/core';
import { Planner } from './Planner.tsx';
import type { ClientsApi, ConsentInput, DataRequest, ProfileApi, RequestKind } from './data/clients.ts';
import type { ShareApi, ShareLink } from './data/share.ts';
import { bedfordviewData } from './test-utils.ts';

const data = bedfordviewData();
const library = data.library;
const loadGym = () => Promise.resolve(data);
const gym: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '1 Rd',
  phone: '',
  notes: '',
};

const complete: TrainerProfile = {
  businessName: 'Alice Fitness',
  address: '1 Main Rd, Bedfordview',
  contactEmail: 'alice@example.com',
  contactPhone: '',
  informationOfficerName: 'Alice Smith',
  informationOfficerEmail: 'io@example.com',
  paymentProvider: '',
  messagingProvider: '',
  studioName: '',
};

const baseClient = (over: Partial<Client> = {}): Client => ({
  id: 'c1',
  name: 'Carla',
  whatsapp: '',
  email: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
  plan: '',
  subStatus: 'active',
  perWeek: 0,
  sessionsLeft: 0,
  renewal: null,
  goals: 'Run 10k',
  privateNotes: 'bad knee',
  dateOfBirth: '1990-01-01',
  guardianName: '',
  retentionUntil: '2031-11-01',
  ...over,
});
const consent = (
  purpose: string,
  granted = true,
  at = '2026-11-01T10:00:00Z',
  detail = '',
): ConsentRecord => ({
  purpose,
  detail,
  granted,
  grantedAt: at,
  noticeVersion: '1.0-draft',
  wording: '',
});
const fullConsents = (): ConsentRecord[] => [
  consent('privacy-notice'),
  consent('health-information', true, '2026-11-01T10:01:00Z'),
  consent('hosting-abroad', true, '2026-11-01T10:02:00Z'),
];
const record = (over: Partial<Client> = {}, consents: ConsentRecord[] = fullConsents()): ClientRecord => ({
  client: baseClient(over),
  consents: consents.map((c) => ({ ...c })),
  programmes: [],
  createdAt: '2026-11-01T08:00:00Z',
});

/** In-memory stand-in for the clients, consents, programmes and requests tables. */
function fakeClients(initial: ClientRecord[] = []) {
  const store = [...initial];
  const requests: (DataRequest & { kind: RequestKind })[] = [];
  const created: { client: Client; consents: ConsentInput[] }[] = [];
  const recorded: { clientId: string; consents: ConsentInput[] }[] = [];
  let n = 0;
  const api: ClientsApi = {
    list: vi.fn(async () => store.map((r) => ({ ...r }))),
    create: vi.fn(async (client: Client, consents: ConsentInput[]) => {
      const id = `new-${(n += 1)}`;
      created.push({ client, consents });
      store.push({
        client: { ...client, id },
        consents: consents.map((k) =>
          consent(k.purpose, k.granted, new Date().toISOString(), k.detail ?? ''),
        ),
        programmes: [],
        createdAt: new Date().toISOString(),
      });
      return id;
    }),
    update: vi.fn(async (client: Client) => {
      const i = store.findIndex((r) => r.client.id === client.id);
      if (i >= 0) store[i] = { ...store[i]!, client };
    }),
    recordConsents: vi.fn(async (clientId: string, consents: ConsentInput[]) => {
      recorded.push({ clientId, consents });
      const r = store.find((x) => x.client.id === clientId);
      let t = Date.now();
      consents.forEach((k) =>
        r?.consents.push(consent(k.purpose, k.granted, new Date((t += 1000)).toISOString(), k.detail ?? '')),
      );
    }),
    consentHistory: vi.fn(
      async (clientId: string) => store.find((r) => r.client.id === clientId)?.consents ?? [],
    ),
    assign: vi.fn(async ({ clientIds, gymId, title, notes, items }) => {
      clientIds.forEach((id: string) => {
        store
          .find((r) => r.client.id === id)
          ?.programmes.push({
            id: `p${Math.random()}`,
            title,
            notes,
            assignedAt: new Date().toISOString(),
            gymId,
            items,
          });
      });
      return clientIds.length;
    }),
    removeProgramme: vi.fn(async (programmeId: string) => {
      store.forEach((r) => (r.programmes = r.programmes.filter((p) => p.id !== programmeId)));
    }),
    clientRuns: vi.fn(async () => []),
    extendRetention: vi.fn(async () => {}),
    logRequest: vi.fn(async ({ clientId, clientName, kind, outcome }) => {
      requests.push({
        id: `r${requests.length}`,
        clientName,
        kind,
        receivedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        outcome,
        ...(clientId ? {} : {}),
      });
    }),
    requests: vi.fn(async () => requests.slice()),
    erase: vi.fn(async (client: Client) => {
      requests.push({
        id: `d${requests.length}`,
        clientName: client.name,
        kind: 'deletion',
        receivedAt: new Date().toISOString(),
        completedAt: null,
        outcome: 'erased',
      });
      store.splice(
        store.findIndex((r) => r.client.id === client.id),
        1,
      );
    }),
  };
  return { api, store, requests, created, recorded };
}

function fakeProfile(initial: TrainerProfile) {
  let current = initial;
  const api: ProfileApi = {
    get: vi.fn(async () => current),
    save: vi.fn(async (p) => {
      current = p;
    }),
  };
  return api;
}

const templates = {
  list: vi.fn(async () => []),
  save: vi.fn(async () => ({ updated: false })),
  remove: vi.fn(async () => {}),
  equipmentInfo: vi.fn(async () => new Map()),
};
const history = {
  list: vi.fn(async () => []),
  save: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
};

function mount(clients = fakeClients(), profile: TrainerProfile = complete) {
  const profileApi = fakeProfile(profile);
  const view = render(
    <Planner
      gyms={[gym]}
      loadGym={loadGym}
      templates={templates}
      history={history}
      clientsApi={clients.api}
      profileApi={profileApi}
      onSignOut={() => {}}
    />,
  );
  return { ...view, clients, profileApi };
}
async function openClients() {
  await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
  fireEvent.click(screen.getByRole('tab', { name: 'Clients' }));
}
/** Tick the box on the current consent screen (if asked) and move on. */
function pass(tick = true) {
  if (tick) fireEvent.click(screen.getByRole('checkbox'));
  const btn =
    screen.queryByRole('button', { name: 'Next' }) ?? screen.getByRole('button', { name: 'Finish' });
  fireEvent.click(btn);
}

beforeEach(() => localStorage.clear());

describe('business details and the privacy notice', () => {
  it('clients cannot be added until the details the notice needs are filled in', async () => {
    mount(fakeClients(), { ...complete, businessName: '', informationOfficerEmail: '' });
    await openClients();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Business or trainer name, Information Officer email',
    );
    expect(screen.getByRole('button', { name: 'Add client' })).toBeDisabled();
  });

  it('saving the details enables Add client and fills in the notice', async () => {
    const { profileApi } = mount(fakeClients(), { ...complete, businessName: '' });
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: 'Your business details' }));
    fireEvent.change(screen.getByLabelText('Business or trainer name'), {
      target: { value: 'Alice Fitness' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(profileApi.save).toHaveBeenCalledWith(
        expect.objectContaining({ businessName: 'Alice Fitness' }),
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add client' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'View the privacy notice' }));
    const notice = screen.getByRole('article', { name: 'Privacy notice' });
    expect(within(notice).getByText('Privacy notice for Alice Fitness')).toBeInTheDocument();
    expect(within(notice).getByText(/Draft wording/)).toBeInTheDocument();
    expect(within(notice).getAllByRole('heading', { level: 4 })).toHaveLength(11);
    expect(notice).toHaveTextContent('London, United Kingdom');
  });
});

describe('onboarding a client with consent', () => {
  async function startNewClient(name: string, dob: string) {
    fireEvent.click(await screen.findByRole('button', { name: 'Add client' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/^Date of birth/), { target: { value: dob } });
  }

  it('shows the consent screens in order, every box unticked, required ones needing a tick', async () => {
    const clients = fakeClients();
    mount(clients);
    await openClients();
    await startNewClient('Dan', '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));

    expect(screen.getByRole('heading', { name: 'Before we start' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    pass();
    expect(screen.getByRole('heading', { name: 'Your health information' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(/Giving this consent is voluntary/)).toBeInTheDocument();
    pass();
    expect(
      screen.getByRole('heading', { name: 'Storing your information outside South Africa' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /London, United Kingdom/ })).not.toBeChecked();
    pass();
    expect(screen.getByRole('heading', { name: 'News and offers from Alice Fitness' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled(); // marketing is optional
  });

  it('records each consent with the exact wording, and an unticked marketing box as a no', async () => {
    const clients = fakeClients();
    mount(clients);
    await openClients();
    await startNewClient('Dan', '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    pass();
    pass();
    pass();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(clients.created).toHaveLength(1));
    const { client, consents } = clients.created[0]!;
    expect(client.name).toBe('Dan');
    expect(consents.map((k) => [k.purpose, k.granted])).toEqual([
      ['privacy-notice', true],
      ['health-information', true],
      ['hosting-abroad', true],
      ['marketing', false],
    ]);
    expect(consents[0]!.wording).toContain('I have read the Privacy Notice.');
    expect(consents[0]!.wording).toContain('Privacy Notice for Alice Fitness'); // the full notice is kept as proof
    expect(consents[1]!.wording).toContain(
      'I consent to Alice Fitness collecting and using my health information',
    );
    expect(consents[3]!.wording).toContain('may send me news, tips and offers');
    // lands on the new client's page
    expect(await screen.findByRole('heading', { name: 'Dan' })).toBeInTheDocument();
  });

  it('a client who ticks marketing is recorded as opted in', async () => {
    const clients = fakeClients();
    mount(clients);
    await openClients();
    await startNewClient('Eve', '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    pass();
    pass();
    pass();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(clients.created).toHaveLength(1));
    expect(clients.created[0]!.consents.find((k) => k.purpose === 'marketing')!.granted).toBe(true);
  });

  it('a client under 18 needs a guardian named, and the guardian consent screen', async () => {
    const clients = fakeClients();
    mount(clients);
    await openClients();
    await startNewClient('Sam', '2015-06-01');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A parent or guardian name is needed');
    fireEvent.change(screen.getByLabelText('Parent or legal guardian (name)'), { target: { value: 'Mum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    pass();
    pass();
    pass();
    expect(screen.getByRole('heading', { name: 'Under 18' })).toBeInTheDocument();
    expect(screen.getByText(/guardian of Sam/)).toBeInTheDocument();
    pass();
    pass(false);
    await waitFor(() => expect(clients.created).toHaveLength(1));
    expect(clients.created[0]!.client.guardianName).toBe('Mum');
    expect(clients.created[0]!.consents.map((k) => k.purpose)).toContain('guardian');
  });

  it('Cancel on the first screen goes back without creating anyone', async () => {
    const clients = fakeClients();
    mount(clients);
    await openClients();
    await startNewClient('Dan', '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Add a client' })).toBeInTheDocument();
    expect(clients.created).toHaveLength(0);
  });

  it('needs a name', async () => {
    mount();
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: 'Add client' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to consent' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before we start' })).toBeNull();
  });
});

describe("a client's profile and health records", () => {
  const open = async (r: ClientRecord) => {
    const clients = fakeClients([r]);
    const view = mount(clients);
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(r.client.name) }));
    return { ...view, clients };
  };

  it('with health consent, goals and private notes are available, with the questionnaire notice above them', async () => {
    await open(record());
    expect(await screen.findByLabelText('Goals')).toHaveValue('Run 10k');
    expect(screen.getByLabelText(/^Private notes/)).toHaveValue('bad knee');
    expect(screen.getByText(/We ask these questions only to train you safely/)).toBeInTheDocument();
    expect(screen.getByText(/seen only by Alice Fitness/)).toBeInTheDocument();
  });

  it('before health consent, health questions are blocked and consent can be recorded from the banner', async () => {
    const { clients } = await open(record({}, []));
    expect(await screen.findByText(/Health questions are blocked until/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Goals')).toBeNull();
    expect(screen.getByRole('alert', { name: '' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record consent now' }));
    pass();
    pass();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(clients.recorded).toHaveLength(1));
    expect(clients.recorded[0]!.consents.map((k) => k.purpose)).toEqual([
      'privacy-notice',
      'health-information',
      'hosting-abroad',
    ]);
    expect(await screen.findByLabelText('Goals')).toBeInTheDocument();
  });

  it('after health consent is withdrawn the records are locked and never overwritten by a save', async () => {
    const withdrawn = [...fullConsents(), consent('health-information', false, '2026-11-05T09:00:00Z')];
    const { clients } = await open(record({}, withdrawn));
    expect(await screen.findByText('Locked: health consent was withdrawn.')).toBeInTheDocument();
    expect(screen.getByText(/Health consent was withdrawn. Health records are locked/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Goals')).toBeNull();
    expect(screen.queryByText('bad knee')).toBeNull();
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Gold' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(clients.api.update).toHaveBeenCalled());
    const saved = (clients.api.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Client;
    expect(saved).toMatchObject({ plan: 'Gold', goals: 'Run 10k', privateNotes: 'bad knee' }); // locked fields untouched
  });

  it('saves an edited profile and rejects a bad email', async () => {
    const { clients } = await open(record());
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(within(await screen.findByRole('alert')).getByText(/email/i)).toBeInTheDocument();
    expect(clients.api.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'carla@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Private notes/), { target: { value: 'knee better' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(clients.api.update).toHaveBeenCalled());
    expect((clients.api.update as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      email: 'carla@example.com',
      privateNotes: 'knee better',
    });
  });

  it('flags a client who is under 18 until the guardian has consented, and one past their keep-until date', async () => {
    await open(record({ dateOfBirth: '2015-06-01', guardianName: 'Mum', retentionUntil: '2020-01-01' }));
    expect(await screen.findByText(/Consent not complete: Parent or guardian consent/)).toBeInTheDocument();
    expect(screen.getByText(/past its keep-until date \(2020-01-01\)/)).toBeInTheDocument();
  });
});

describe('privacy and consent page', () => {
  const open = async (r: ClientRecord) => {
    const clients = fakeClients([r]);
    mount(clients);
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(r.client.name) }));
    await screen.findByRole('heading', { name: 'Privacy and consent' });
    return clients;
  };

  it('lists current consents; withdrawing needs two taps, adds a new record and logs the request', async () => {
    const clients = await open(record());
    const list = screen.getByRole('list', { name: 'Consents' });
    expect(within(list).getByText('Health information')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw Health information' }));
    expect(clients.recorded).toHaveLength(0);
    fireEvent.click(within(list).getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(clients.recorded).toHaveLength(1));
    expect(clients.recorded[0]!.consents[0]).toMatchObject({ purpose: 'health-information', granted: false });
    expect(clients.api.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'consent-withdrawal', clientName: 'Carla' }),
    );
    // the page now shows health locked
    expect(await screen.findByText('Locked: health consent was withdrawn.')).toBeInTheDocument();
  });

  it('marketing opt-in needs a tick and shows the exact wording', async () => {
    const clients = await open(record());
    const optIn = screen.getByRole('button', { name: 'Record opt-in' });
    expect(optIn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /may send me news, tips and offers/ }));
    fireEvent.click(optIn);
    await waitFor(() => expect(clients.recorded).toHaveLength(1));
    expect(clients.recorded[0]!.consents[0]).toMatchObject({ purpose: 'marketing', granted: true });
    expect(clients.recorded[0]!.consents[0]!.wording).toContain('Alice Fitness may send me news');
  });

  it('sharing health information is consented per person, with the purpose', async () => {
    const clients = await open(record());
    const record1 = screen.getByRole('button', { name: 'Record consent for this person' });
    expect(record1).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Doctor or biokineticist'), { target: { value: 'Dr Smith' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'medical clearance' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Dr Smith for the purpose of medical clearance/ }));
    fireEvent.click(record1);
    await waitFor(() => expect(clients.recorded).toHaveLength(1));
    expect(clients.recorded[0]!.consents[0]).toMatchObject({
      purpose: 'sharing',
      detail: 'Dr Smith',
      granted: true,
    });
    expect(
      await within(screen.getByRole('list', { name: 'Consents' })).findByText('Sharing with: Dr Smith'),
    ).toBeInTheDocument();
  });

  it('makes a readable copy including private notes, and logs the access request', async () => {
    const clients = await open(record());
    fireEvent.click(screen.getByRole('button', { name: 'Make a readable copy' }));
    const box = await screen.findByRole('textbox', { name: /Readable copy/ });
    expect((box as HTMLTextAreaElement).value).toContain('Information held about Carla by Alice Fitness');
    expect((box as HTMLTextAreaElement).value).toContain('Notes held about you: bad knee');
    expect(clients.api.logRequest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'access' }));
  });

  it('deleting a client and all their information needs two taps, is logged, and returns to the list', async () => {
    const clients = await open(record());
    fireEvent.click(screen.getByRole('button', { name: 'Delete Carla and all their information' }));
    expect(clients.api.erase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(clients.api.erase).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No clients yet/)).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Privacy requests' })).toHaveTextContent('deletion');
  });
});

describe('programmes and the session', () => {
  const ground = data.layout.floors[0]!;
  const machine = data.layout.equipment.find(
    (e) => e.floor === ground.id && exercisesFor(library, e.id).length > 0,
  )!;

  async function sessionWithOneExercise(clients: ReturnType<typeof fakeClients>) {
    const view = mount(clients);
    await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
    fireEvent.click(view.container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog)
        .getAllByRole('button')
        .find((b) => b.textContent?.includes(exercisesFor(library, machine.id)[0]!.name))!,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('tab', { name: 'Session (1)' }));
    return view;
  }

  it('picking a saved client puts their name on the session; a client without full consent gets a warning', async () => {
    const pending = record({ id: 'c2', name: 'Pending Pat' }, []);
    await sessionWithOneExercise(fakeClients([record(), pending]));
    fireEvent.change(await screen.findByLabelText('Client'), { target: { value: 'c1' } });
    expect(screen.queryByLabelText(/Guest name/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'c2' } });
    expect(await screen.findByText(/consent is not complete/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '' } });
    expect(screen.getByLabelText(/Guest name/)).toBeInTheDocument();
  });

  it('assigns the routine to the ticked clients as a programme', async () => {
    const clients = fakeClients([record(), record({ id: 'c2', name: 'Dan' })]);
    await sessionWithOneExercise(clients);
    fireEvent.change(await screen.findByLabelText('Session name'), { target: { value: 'Leg day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign to selected clients' }));
    expect(await screen.findByText('Tick at least one client.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Carla' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign to selected clients' }));
    expect(await screen.findByText('Assigned to 2 clients.')).toBeInTheDocument();
    expect(clients.api.assign).toHaveBeenCalledWith(
      expect.objectContaining({ clientIds: ['c1', 'c2'], title: 'Leg day', gymId: 'g1' }),
    );
    expect((clients.api.assign as ReturnType<typeof vi.fn>).mock.calls[0]![0].items).toHaveLength(1);
  });

  it("a client's programme can be opened in the session for that client, and deleted with two taps", async () => {
    const x = exercisesFor(library, machine.id)[0]!;
    const withProgramme = record();
    withProgramme.programmes.push({
      id: 'p1',
      title: 'Starter',
      notes: 'Easy',
      assignedAt: '2026-11-09T08:00:00Z',
      gymId: 'g1',
      items: [{ eid: machine.id, xid: x.id, exercise: x.name, sets: 3, reps: '10', rest: 60, note: '' }],
    });
    const clients = fakeClients([withProgramme]);
    mount(clients);
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: /Carla/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Starter in the session' }));
    expect(await screen.findByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Session name')).toHaveValue('Starter');
    expect(screen.getByLabelText('Client')).toHaveValue('c1');
    fireEvent.click(screen.getByRole('tab', { name: 'Clients' }));
    fireEvent.click(await screen.findByRole('button', { name: /Carla/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete programme Starter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(clients.api.removeProgramme).toHaveBeenCalledWith('p1'));
  });

  it('the client list shows consent status and has a search box once there are more than six clients', async () => {
    const many = Array.from({ length: 7 }, (_, i) => record({ id: `c${i}`, name: `Client ${i}` }));
    many.push(record({ id: 'pending', name: 'Zed' }, []));
    mount(fakeClients(many));
    await openClients();
    const list = await screen.findByRole('list', { name: 'Clients' });
    expect(within(list).getByText(/consent pending/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'zed' } });
    expect(within(screen.getByRole('list', { name: 'Clients' })).getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('sending and sharing from the app', () => {
  const ground = data.layout.floors[0]!;
  const machine = data.layout.equipment.find(
    (e) => e.floor === ground.id && exercisesFor(library, e.id).length > 0,
  )!;
  const x = exercisesFor(library, machine.id)[0]!;

  const programmeFor = (): ClientRecord => {
    const r = record({ whatsapp: '082 111 2222', email: 'carla@example.com' });
    r.programmes.push({
      id: 'p1',
      title: 'Starter',
      notes: 'Easy',
      assignedAt: '2026-11-09T08:00:00Z',
      gymId: 'g1',
      items: [{ eid: machine.id, xid: x.id, exercise: x.name, sets: 3, reps: '10', rest: 60, note: '' }],
    });
    return r;
  };

  it('a programme can be shared from the client’s profile: a link, WhatsApp to their saved number, and a PDF', async () => {
    const links: ShareLink[] = [];
    const share: ShareApi = {
      list: vi.fn(async () => links.slice()),
      create: vi.fn(async () => {
        const l = {
          token: 'd'.repeat(64),
          createdAt: new Date().toISOString(),
          expiresAt: null,
          revokedAt: null,
        };
        links.push(l);
        return l;
      }),
      revoke: vi.fn(async () => {}),
    };
    const clients = fakeClients([programmeFor()]);
    const profileApi = fakeProfile(complete);
    render(
      <Planner
        gyms={[gym]}
        loadGym={loadGym}
        templates={templates}
        history={history}
        clientsApi={clients.api}
        profileApi={profileApi}
        shareApi={share}
        onSignOut={() => {}}
      />,
    );
    await openClients();
    fireEvent.click(await screen.findByRole('button', { name: /Carla/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Share Starter' }));
    const panel = await screen.findByRole('region', { name: /^Share/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'Create a link' }));
    await waitFor(() => expect(share.create).toHaveBeenCalledWith('p1', 90));
    const wa = (await within(panel).findByRole('link', { name: '2. Open WhatsApp' })).getAttribute('href')!;
    expect(wa).toContain('wa.me/27821112222');
    const message = decodeURIComponent(wa.split('?text=')[1]!);
    expect(message).toContain('Hi Carla,');
    expect(message).toContain(`1. ${x.name} (${machine.name}`);
    expect(message).toContain(`/p/${'d'.repeat(64)}`);
    expect(message).not.toMatch(/bad knee|Run 10k/); // nothing from the private profile
    expect(within(panel).getByRole('button', { name: '1. Save PDF' })).toBeInTheDocument();
  });

  it('the Session tab offers Send to your client, filled in with the chosen client’s number and email', async () => {
    const clients = fakeClients([record({ whatsapp: '082 111 2222', email: 'carla@example.com' })]);
    const view = mount(clients);
    await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
    fireEvent.click(view.container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog)
        .getAllByRole('button')
        .find((b) => b.textContent?.includes(x.name))!,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('tab', { name: 'Session (1)' }));
    const send = await screen.findByRole('region', { name: 'Send to your client' });
    expect((within(send).getByLabelText('WhatsApp number') as HTMLInputElement).value).toBe('');
    fireEvent.change(await screen.findByRole('combobox', { name: /^Client/ }), { target: { value: 'c1' } });
    await waitFor(() =>
      expect(
        (
          within(screen.getByRole('region', { name: 'Send to your client' })).getByLabelText(
            'WhatsApp number',
          ) as HTMLInputElement
        ).value,
      ).toBe('082 111 2222'),
    );
    expect(
      (
        within(screen.getByRole('region', { name: 'Send to your client' })).getByLabelText(
          'Email',
        ) as HTMLInputElement
      ).value,
    ).toBe('carla@example.com');
  });

  it('there is nothing to send until the session has an exercise', async () => {
    mount(fakeClients([record()]));
    await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
    fireEvent.click(screen.getByRole('tab', { name: 'Session (0)' }));
    expect(screen.queryByRole('region', { name: 'Send to your client' })).toBeNull();
  });
});
