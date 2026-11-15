import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exercisesFor, type GymSummary, type HistoryEntry } from '@pt/core';
import { Planner } from './Planner.tsx';
import type { HistoryApi } from './data/history.ts';
import type { Template, TemplateApi } from './data/templates.ts';
import { bedfordviewData } from './test-utils.ts';

const data = bedfordviewData();
const library = data.library;
const loadGym = () => Promise.resolve(data);

const bedfordview: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
};
const second: GymSummary = { ...bedfordview, id: 'g2', name: 'Second Gym', branch: '', address: '1 Main St' };

/** In-memory stand-in for the templates tables. */
function fakeTemplates(initial: Template[] = []) {
  const store = [...initial];
  const api: TemplateApi = {
    list: vi.fn(async () => store.map((t) => ({ ...t }))),
    save: vi.fn(async ({ gymId, name, notes, items }) => {
      const i = store.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      const t = { id: i >= 0 ? store[i]!.id : `t${store.length + 1}`, name, notes, gymId, items };
      if (i >= 0) store[i] = t;
      else store.push(t);
      return { updated: i >= 0 };
    }),
    remove: vi.fn(async (id: string) => {
      store.splice(
        store.findIndex((t) => t.id === id),
        1,
      );
    }),
    equipmentInfo: vi.fn(async () => new Map()),
  };
  return { api, store };
}

/** In-memory stand-in for the runs tables; share one between mounts to simulate a reload. */
function fakeHistory(initial: HistoryEntry[] = []) {
  const store = [...initial];
  const api: HistoryApi = {
    list: vi.fn(async () => store.slice().sort((a, b) => b.startedAt - a.startedAt)),
    save: vi.fn(async (e: HistoryEntry) => {
      const i = store.findIndex((x) => x.id === e.id);
      if (i >= 0) store[i] = e;
      else store.push(e);
    }),
    remove: vi.fn(async (id: string) => {
      store.splice(
        store.findIndex((x) => x.id === id),
        1,
      );
    }),
  };
  return { api, store };
}

const ground = data.layout.floors[0]!;
const upper = data.layout.floors[1]!;
/** Machines on the ground floor that have linked exercises. */
const machines = data.layout.equipment.filter(
  (e) => e.floor === ground.id && exercisesFor(library, e.id).length > 0,
);
const machineA = machines[0]!;
const machineB = machines[machines.length - 1]!;
const firstOf = (eid: string) => exercisesFor(library, eid)[0]!;

function mount(over: Partial<Parameters<typeof Planner>[0]> = {}, h = fakeHistory()) {
  const t = fakeTemplates();
  const view = render(
    <Planner
      gyms={[bedfordview]}
      loadGym={loadGym}
      templates={t.api}
      history={h.api}
      onSignOut={() => {}}
      {...over}
    />,
  );
  return { ...view, templates: t, history: h };
}

async function ready() {
  return screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
}
function marker(container: HTMLElement, eid: string) {
  return container.querySelector(`g.mk[data-eq="${eid}"]`)!;
}
/** Click a machine on the plan, then add one of its exercises from the pop-up. */
async function addFrom(container: HTMLElement, eid: string, index = 0) {
  fireEvent.click(marker(container, eid));
  const dialog = await screen.findByRole('dialog');
  const x = exercisesFor(library, eid)[index]!;
  const buttons = within(dialog).getAllByRole('button');
  fireEvent.click(buttons.find((b) => b.textContent?.includes(x.name))!);
  return x;
}

beforeEach(() => localStorage.clear());

describe('Planner shell', () => {
  it('shows the title from the gym, the gym bar and all seven tabs', async () => {
    mount();
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeInTheDocument();
    expect(screen.getByText('Virgin Active Bedfordview · 101 Van Buuren Rd')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Gym location' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tab', { name: 'Session (0)' })).toBeInTheDocument();
  });

  it('switches mode and the first tab becomes Layout', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });

  it('explains how to import a gym when the account has none, and can sign out', () => {
    const onSignOut = vi.fn();
    mount({ gyms: [], onSignOut });
    expect(screen.getByRole('heading', { name: 'No gym yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('loads the plan for the open gym and reloads when the gym changes', async () => {
    const load = vi.fn(() => Promise.resolve(data));
    mount({ gyms: [bedfordview, second], loadGym: load });
    await ready();
    expect(load).toHaveBeenLastCalledWith('g1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g2' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('g2'));
    expect(screen.getByRole('heading', { level: 1, name: 'Second Gym Zone Planner' })).toBeInTheDocument();
  });

  it('shows an error if the plan cannot be loaded', async () => {
    mount({ loadGym: () => Promise.reject(new Error('boom')) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the floor plan: boom');
  });

  it('switching floors changes what is drawn and clears the selection', async () => {
    mount();
    const map = await ready();
    const before = map.querySelectorAll('g.zone').length;
    fireEvent.click(screen.getByRole('button', { name: upper.name }));
    const after = screen
      .getByRole('group', { name: 'Floor plan with training zones and equipment' })
      .querySelectorAll('g.zone').length;
    expect(after).not.toBe(before);
    expect(screen.getByRole('button', { name: upper.name })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('building a session from the plan', () => {
  it('tapping a machine opens a pop-up of its linked exercises', async () => {
    const { container } = mount();
    await ready();
    fireEvent.click(marker(container, machineA.id));
    const dialog = await screen.findByRole('dialog', { name: `Exercises on ${machineA.name}` });
    const linked = exercisesFor(library, machineA.id);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(linked.length);
    expect(within(dialog).getByText(new RegExp(`${linked.length} exercise`))).toBeInTheDocument();
  });

  it('Escape or the close button closes the pop-up', async () => {
    const { container } = mount();
    await ready();
    fireEvent.click(marker(container, machineA.id));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(marker(container, machineA.id));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adding an exercise lands in the session, numbers the machine and shows a toast', async () => {
    const { container } = mount();
    await ready();
    const x = await addFrom(container, machineA.id);
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    expect(await screen.findByText(`Added ${x.name} (1 in session)`)).toBeInTheDocument();
    expect(marker(container, machineA.id).querySelector('.bdt')).toHaveTextContent('1');
    // the pop-up now says it is in the session
    expect(within(screen.getByRole('dialog')).getByText('In session')).toBeInTheDocument();
  });

  it('draws a route line between machines in order, and repeats of one machine add no leg', async () => {
    const { container } = mount();
    await ready();
    await addFrom(container, machineA.id);
    expect(container.querySelectorAll('polyline.route')).toHaveLength(0);
    await addFrom(container, machineB.id);
    expect(container.querySelectorAll('polyline.route')).toHaveLength(1);
    expect(marker(container, machineB.id).querySelector('.bdt')).toHaveTextContent('2');
    // the pop-up for machine B is still open: add a second exercise from it (same machine, so no new leg)
    const second = exercisesFor(library, machineB.id)[exercisesFor(library, machineB.id).length > 1 ? 1 : 0]!;
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button');
    fireEvent.click(buttons.find((b) => b.textContent?.includes(second.name))!);
    expect(screen.getByRole('tab', { name: 'Session (3)' })).toBeInTheDocument();
    expect(marker(container, machineB.id).querySelector('.bdt')).toHaveTextContent('2+');
    expect(container.querySelectorAll('polyline.route')).toHaveLength(1);
  });

  it('the Zones tab lets you add exercises without the map pop-up', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: machineA.name, pressed: false }));
    const x = firstOf(machineA.id);
    fireEvent.click(screen.getByRole('button', { name: `Add ${x.name} to session` }));
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
  });
});

describe('the Session tab', () => {
  async function withTwoItems() {
    const view = mount();
    await ready();
    const x1 = await addFrom(view.container, machineA.id);
    const x2 = await addFrom(view.container, machineB.id);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('tab', { name: 'Session (2)' }));
    return { ...view, x1, x2 };
  }
  const list = () => screen.getByRole('list', { name: 'Exercises in this session' });

  it('lists items in order with their prescription, and a summary with the route', async () => {
    const { x1, x2 } = await withTwoItems();
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByLabelText('Exercise')).toHaveValue(x1.name);
    expect(within(items[1]!).getByLabelText('Exercise')).toHaveValue(x2.name);
    expect(within(items[0]!).getByLabelText('Sets')).toHaveValue(x1.sets);
    const summary = screen.getByLabelText('Session summary');
    expect(within(summary).getByText(/Floor route:/)).toBeInTheDocument();
    expect(within(summary).getByText('exercises')).toBeInTheDocument();
  });

  it('edits sets, reps, rest and a coach note', async () => {
    await withTwoItems();
    const first = within(list()).getAllByRole('listitem')[0]!;
    fireEvent.change(within(first).getByLabelText('Sets'), { target: { value: '5' } });
    fireEvent.change(within(first).getByLabelText('Reps or time'), { target: { value: '8-10' } });
    fireEvent.change(within(first).getByLabelText('Rest (s)'), { target: { value: '90' } });
    fireEvent.change(within(first).getByLabelText('Coach note (optional)'), {
      target: { value: 'Slow tempo' },
    });
    expect(within(first).getByLabelText('Sets')).toHaveValue(5);
    expect(within(first).getByLabelText('Reps or time')).toHaveValue('8-10');
    expect(within(first).getByLabelText('Rest (s)')).toHaveValue(90);
    expect(within(first).getByLabelText('Coach note (optional)')).toHaveValue('Slow tempo');
  });

  it('never lets sets drop below 1 or rest below 0', async () => {
    await withTwoItems();
    const first = within(list()).getAllByRole('listitem')[0]!;
    fireEvent.change(within(first).getByLabelText('Sets'), { target: { value: '0' } });
    fireEvent.change(within(first).getByLabelText('Rest (s)'), { target: { value: '-20' } });
    expect(within(first).getByLabelText('Sets')).toHaveValue(1);
    expect(within(first).getByLabelText('Rest (s)')).toHaveValue(0);
  });

  it('reorders with the arrows and the grip keys, and the numbers follow', async () => {
    const { x1, x2, container } = await withTwoItems();
    const names = () =>
      within(list())
        .getAllByRole('listitem')
        .map((li) => (within(li).getByLabelText('Exercise') as HTMLInputElement).value);
    expect(names()).toEqual([x1.name, x2.name]);
    fireEvent.click(screen.getByRole('button', { name: `Move ${x2.name} up` }));
    expect(names()).toEqual([x2.name, x1.name]);
    expect(marker(container, machineB.id).querySelector('.bdt')).toHaveTextContent('1');
    fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`Reorder ${x2.name}`) }), {
      key: 'ArrowDown',
    });
    expect(names()).toEqual([x1.name, x2.name]);
    expect(screen.getByRole('button', { name: `Move ${x1.name} up` })).toBeDisabled();
  });

  it('removes an item, and clearing the session needs a second tap', async () => {
    const { x1 } = await withTwoItems();
    fireEvent.click(screen.getByRole('button', { name: `Remove ${x1.name}` }));
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }));
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument(); // armed, not cleared
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(screen.getByRole('tab', { name: 'Session (0)' })).toBeInTheDocument();
    expect(screen.getByText(/No exercises yet/)).toBeInTheDocument();
  });

  it('keeps the unsent routine on this device across a reload', async () => {
    const first = mount();
    await ready();
    const x = await addFrom(first.container, machineA.id);
    first.unmount();
    mount();
    await ready();
    expect(await screen.findByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Session (1)' }));
    expect(screen.getByLabelText('Exercise')).toHaveValue(x.name);
  });

  it('takes the routine to the other gym and back (the machines are the same here)', async () => {
    const first = mount({ gyms: [bedfordview, second] });
    await ready();
    await addFrom(first.container, machineA.id);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g2' } });
    await waitFor(() => expect(screen.getByText(/^Opened /)).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g1' } });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument());
  });
});

describe('templates', () => {
  async function sessionWithItems(templates?: ReturnType<typeof fakeTemplates>) {
    const t = templates ?? fakeTemplates();
    const view = render(
      <Planner
        gyms={[bedfordview]}
        loadGym={loadGym}
        templates={t.api}
        history={null}
        onSignOut={() => {}}
      />,
    );
    await ready();
    const x1 = await addFrom(view.container, machineA.id);
    const x2 = await addFrom(view.container, machineB.id);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('tab', { name: 'Session (2)' }));
    return { ...view, t, x1, x2 };
  }

  it('saves the session as a template, listing it with its exercise count', async () => {
    const { t } = await sessionWithItems();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Beginner full body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(await screen.findByText('Saved template "Beginner full body".')).toBeInTheDocument();
    expect(t.api.save).toHaveBeenCalledWith(
      expect.objectContaining({ gymId: 'g1', name: 'Beginner full body' }),
    );
    expect(t.store[0]!.items).toHaveLength(2);
    expect(await screen.findByText('2 exercises')).toBeInTheDocument();
  });

  it('saving again under the same name updates it; a missing name is refused', async () => {
    const { t } = await sessionWithItems();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    await screen.findByText('Saved template "Legs".');
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(await screen.findByText('Updated template "Legs".')).toBeInTheDocument();
    expect(t.store).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(await screen.findByText('Give the template a name.')).toBeInTheDocument();
  });

  it('loads a template, replacing the session, and adds one to the end', async () => {
    const x = firstOf(machineA.id);
    const stored: Template = {
      id: 't1',
      name: 'Warm up',
      notes: 'Easy does it',
      gymId: 'g1',
      items: [{ eid: machineA.id, xid: x.id, exercise: x.name, sets: 2, reps: '10', rest: 30, note: '' }],
    };
    const { t } = await sessionWithItems(fakeTemplates([stored]));
    fireEvent.click(await screen.findByRole('button', { name: 'Load Warm up' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument());
    expect(screen.getByLabelText('Session name')).toHaveValue('Warm up');
    expect(screen.getByLabelText('Notes for the client')).toHaveValue('Easy does it');
    fireEvent.click(screen.getByRole('button', { name: 'Add Warm up to session' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Session (2)' })).toBeInTheDocument());
    expect(t.api.equipmentInfo).not.toHaveBeenCalled(); // same machine ids: nothing to look up
  });

  it('remaps a template from another gym onto matching machines and says what was skipped', async () => {
    const x = firstOf(machineA.id);
    const stored: Template = {
      id: 't2',
      name: 'From elsewhere',
      notes: '',
      gymId: 'other-gym',
      items: [
        { eid: 'old-A', xid: x.id, exercise: x.name, sets: 3, reps: '10', rest: 60, note: '' }, // exercise link: moves
        { eid: 'old-B', xid: null, exercise: 'Mystery move', sets: 3, reps: '10', rest: 60, note: '' }, // skipped
        { eid: '', xid: null, exercise: 'Deleted machine', sets: 3, reps: '10', rest: 60, note: '' }, // skipped
      ],
    };
    const t = fakeTemplates([stored]);
    render(
      <Planner
        gyms={[bedfordview]}
        loadGym={loadGym}
        templates={t.api}
        history={null}
        onSignOut={() => {}}
      />,
    );
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Session (0)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load From elsewhere' }));
    expect(await screen.findByText(/1 moved to matching equipment/)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped: no matching equipment here/)).toBeInTheDocument();
    expect(t.api.equipmentInfo).toHaveBeenCalledWith(['old-A', 'old-B']);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Session (1)' })).toBeInTheDocument());
  });

  it('deleting a template needs a second tap', async () => {
    const stored: Template = { id: 't3', name: 'Old', notes: '', gymId: 'g1', items: [] };
    const { t } = await sessionWithItems(fakeTemplates([stored]));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Old' }));
    expect(t.store).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(t.store).toHaveLength(0));
    expect(await screen.findByText('Deleted template "Old".')).toBeInTheDocument();
  });
});
