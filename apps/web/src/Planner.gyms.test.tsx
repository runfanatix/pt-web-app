import { useState } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exercisesFor, type GymData, type GymSummary, type Layout } from '@pt/core';
import { Planner } from './Planner.tsx';
import type { GymMeta, GymsApi } from './data/gymsApi.ts';
import type { LayoutApi } from './data/layoutApi.ts';
import { bedfordviewData } from './test-utils.ts';

const data = bedfordviewData();
const empty: GymData = {
  layout: {
    floors: [{ id: 'ef', name: 'Ground floor', w: 1000, h: 620 }],
    zones: [],
    structs: [],
    equipment: [],
  },
  library: data.library.map((x) => ({ ...x, equipmentIds: [] })),
};
const g1: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
};
const g2: GymSummary = { ...g1, id: 'g2', name: 'Planet Fitness', branch: 'Sandton', address: '1 Main St' };
const machine = data.layout.equipment.find((e) => exercisesFor(data.library, e.id).length > 0)!;

function fakes() {
  const saved: { gymId: string; layout: Layout }[] = [];
  const layoutApi: LayoutApi = {
    save: vi.fn(async (gymId: string, layout: Layout) => {
      saved.push({ gymId, layout });
    }),
    setLink: vi.fn(async () => {}),
  };
  const created: GymMeta[] = [];
  const gymsApi: GymsApi = {
    create: vi.fn(async (m: GymMeta) => {
      created.push(m);
      return `new${created.length}`;
    }),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    copyLinks: vi.fn(async () => {}),
    counts: vi.fn(async () => ({ g1: { floors: 2, zones: 14, equipment: 41 } })),
  };
  return { saved, layoutApi, gymsApi, created };
}

function Harness({
  f,
  load,
  start = [g1, g2],
}: {
  f: ReturnType<typeof fakes>;
  load: (id: string) => Promise<GymData>;
  start?: GymSummary[];
}) {
  const [gyms, setGyms] = useState(start);
  return (
    <Planner
      gyms={gyms}
      loadGym={load}
      templates={null}
      history={null}
      layoutApi={f.layoutApi}
      gymsApi={f.gymsApi}
      onGymsChanged={async () => {
        setGyms((cur) => [
          ...cur.filter((g) => !g.id.startsWith('new')),
          ...f.created.map((m, i) => ({ id: `new${i + 1}`, ...m })),
        ]);
      }}
      onSignOut={() => {}}
    />
  );
}

const sameEverywhere = (id: string) => Promise.resolve(id === 'g3' ? empty : data);
const g2IsEmpty = (id: string) => Promise.resolve(id === 'g2' ? empty : data);

async function ready() {
  await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
}
async function addOne(container: HTMLElement) {
  fireEvent.click(container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog)
      .getAllByRole('button')
      .find((b) => b.textContent?.includes(exercisesFor(data.library, machine.id)[0]!.name))!,
  );
}
const pick = (id: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: id } });

beforeEach(() => localStorage.clear());

describe('switching gym', () => {
  it('takes the routine along when every machine has a match, with no question', async () => {
    const f = fakes();
    const { container } = render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    await addOne(container);
    pick('g2');
    await waitFor(() => expect(screen.getByText(/^Opened Planet Fitness Sandton/)).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before removing exercises that have no matching machine, and Cancel changes nothing', async () => {
    const f = fakes();
    const { container } = render(<Harness f={f} load={g2IsEmpty} />);
    await ready();
    await addOne(container);
    pick('g2');
    const ask = await screen.findByRole('alert');
    expect(ask.textContent).toMatch(/1 exercise has no matching machine there and will be removed/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    pick('g2');
    fireEvent.click(await screen.findByRole('button', { name: 'Switch' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Session (0)' })).toBeInTheDocument());
  });

  it('with unsaved layout changes it offers Save and switch, Discard and switch, or Cancel', async () => {
    const f = fakes();
    render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    pick('g2');
    const ask = await screen.findByRole('alert');
    expect(ask.textContent).toMatch(/unsaved layout changes to “Virgin Active Bedfordview”/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Save layout and switch' }));
    await waitFor(() => expect(f.layoutApi.save).toHaveBeenCalledTimes(1));
    expect(f.saved[0]!.gymId).toBe('g1');
    await waitFor(() => expect(screen.getByText(/^Opened Planet Fitness/)).toBeInTheDocument());
  });

  it('Discard and switch drops the edits without saving', async () => {
    const f = fakes();
    render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    pick('g2');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes and switch' }));
    await waitFor(() => expect(screen.getByText(/^Opened Planet Fitness/)).toBeInTheDocument());
    expect(f.layoutApi.save).not.toHaveBeenCalled();
  });

  it('the picker offers Add or manage gyms, which opens the Gyms tab', async () => {
    render(<Harness f={fakes()} load={sameEverywhere} />);
    await ready();
    pick('__manage');
    expect(await screen.findByRole('heading', { name: 'Gym locations' })).toBeInTheDocument();
  });
});

describe('the Gyms tab', () => {
  async function openTab() {
    const f = fakes();
    const view = render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Gyms' }));
    await screen.findByRole('heading', { name: 'Gym locations' });
    return { f, ...view };
  }

  it('lists the gyms with the open one marked and what each holds', async () => {
    await openTab();
    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(await screen.findByText(/2 floors · 14 zones · 41 equipment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Planet Fitness Sandton' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Virgin Active Bedfordview' })).toBeNull();
  });

  it('a gym cannot be deleted while open, nor the last one; others take two taps', async () => {
    const { f } = await openTab();
    expect(screen.queryByRole('button', { name: 'Delete this gym' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details for Planet Fitness Sandton' }));
    const del = screen.getByRole('button', { name: 'Delete this gym' });
    fireEvent.click(del);
    expect(f.gymsApi.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(f.gymsApi.remove).toHaveBeenCalledWith('g2'));
  });

  it('editing the details saves when you leave the field', async () => {
    const { f } = await openTab();
    const address = screen.getByDisplayValue('101 Van Buuren Rd');
    fireEvent.change(address, { target: { value: '5 New Rd' } });
    fireEvent.blur(address);
    await waitFor(() => expect(f.gymsApi.update).toHaveBeenCalledWith('g1', { address: '5 New Rd' }));
  });

  it('a new gym needs a name, then starts as one empty floor and opens', async () => {
    const { f } = await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    expect(screen.getByText('Give the gym a name first.')).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText('Gym name', { selector: 'section[aria-label="Add a gym"] input' }),
      {
        target: { value: 'Anytime' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    await waitFor(() => expect(f.layoutApi.save).toHaveBeenCalledTimes(1));
    const lay = f.saved[0]!.layout;
    expect(f.saved[0]!.gymId).toBe('new1');
    expect(lay.floors).toHaveLength(1);
    expect(lay.zones).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/^Opened Anytime/)).toBeInTheDocument());
  });

  it('a name already in use gets a number', async () => {
    const { f } = await openTab();
    const add = 'section[aria-label="Add a gym"] input';
    fireEvent.change(screen.getByLabelText('Gym name', { selector: add }), {
      target: { value: 'Virgin Active' },
    });
    fireEvent.change(screen.getByLabelText('Branch or location', { selector: add }), {
      target: { value: 'Bedfordview' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    await waitFor(() => expect(f.created).toHaveLength(1));
    expect(f.created[0]!.name).toBe('Virgin Active 2');
  });

  it('a copy of the plan on screen includes unsaved edits, with all-new ids and the links copied', async () => {
    const f = fakes();
    render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Gyms' }));
    const add = 'section[aria-label="Add a gym"]';
    fireEvent.change(screen.getByLabelText('Gym name', { selector: `${add} input` }), {
      target: { value: 'Copy gym' },
    });
    fireEvent.change(screen.getByLabelText(/Start the floor plan from/), { target: { value: 'copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    await waitFor(() => expect(f.layoutApi.save).toHaveBeenCalledTimes(1));
    const lay = f.saved[0]!.layout;
    expect(lay.zones).toHaveLength(data.layout.zones.length + 1);
    const old = new Set(
      [...data.layout.equipment, ...data.layout.zones, ...data.layout.floors].map((x) => x.id),
    );
    expect([...lay.equipment, ...lay.zones, ...lay.floors].some((x) => old.has(x.id))).toBe(false);
    await waitFor(() => expect(f.gymsApi.copyLinks).toHaveBeenCalled());
    const links = vi.mocked(f.gymsApi.copyLinks).mock.calls[0]![0];
    expect(links).toHaveLength(data.layout.equipment.length);
    // The gym it came from goes back to as saved: no unsaved edits left behind.
    await waitFor(() => expect(screen.getByText(/^Opened Copy gym/)).toBeInTheDocument());
  });

  it('duplicating a gym makes a copy with new ids and does not open it', async () => {
    const { f } = await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate this gym' }));
    await waitFor(() => expect(f.layoutApi.save).toHaveBeenCalledTimes(1));
    expect(f.created[0]!.branch).toBe('Bedfordview copy');
    expect(f.saved[0]!.layout.equipment).toHaveLength(data.layout.equipment.length);
    expect(f.saved[0]!.layout.equipment[0]!.id).not.toBe(data.layout.equipment[0]!.id);
    await waitFor(() => expect(screen.getByText(/^Duplicated as/)).toBeInTheDocument());
    expect(screen.getByText('Open now').closest('li')!.textContent).toContain('Virgin Active Bedfordview');
  });

  it('if saving the new gym fails, the half-made gym is removed again', async () => {
    const { f } = await openTab();
    vi.mocked(f.layoutApi.save).mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate this gym' }));
    await waitFor(() => expect(f.gymsApi.remove).toHaveBeenCalledWith('new1'));
    expect(await screen.findByText(/Could not duplicate: boom/)).toBeInTheDocument();
  });
});

describe('a live run', () => {
  it('blocks switching gym', async () => {
    const f = fakes();
    const { container } = render(<Harness f={f} load={sameEverywhere} />);
    await ready();
    await addOne(container);
    fireEvent.click(screen.getByRole('tab', { name: /^Run/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Start workout/ })[0]!);
    await act(async () => {});
    expect(screen.getByRole('combobox', { name: 'Select gym' })).toBeDisabled();
  });
});
