import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  catalogueFromRows,
  exercisesFor,
  type Catalogue,
  type GymData,
  type Layout,
  type ModelInput,
} from '@pt/core';
import { Planner } from './Planner.tsx';
import type { CatalogueApi } from './data/catalogueApi.ts';
import type { LayoutApi } from './data/layoutApi.ts';
import { bedfordviewData } from './test-utils.ts';

const base = bedfordviewData();
const machine = base.layout.equipment.find((e) => exercisesFor(base.library, e.id).length > 0)!;
const gym = { id: 'g1', name: 'Virgin Active', branch: 'Bedfordview', address: '', phone: '', notes: '' };

const rows = [
  {
    id: 'mk1',
    trainer_id: 't',
    name: 'Technogym',
    catalogue_items: [
      {
        id: 'it1',
        trainer_id: 't',
        model_name: 'Selection Chest Press',
        code: 'MPY01',
        kind: 'machine',
        muscles: ['chest', 'arms'],
        specs: [{ label: 'Weight stack', value: '100 kg' }],
        notes: '',
      },
    ],
  },
  { id: 'mk2', trainer_id: null, name: 'Eleiko', catalogue_items: [] },
];

function fakeCatalogue(initial: unknown[] = rows) {
  let current: Catalogue = catalogueFromRows(initial);
  const api: CatalogueApi = {
    load: vi.fn(async () => current),
    addManufacturer: vi.fn(async (name: string) => {
      const id = `mk-${current.manufacturers.length + 1}`;
      current = { ...current, manufacturers: [...current.manufacturers, { id, name, shared: false }] };
      return id;
    }),
    renameManufacturer: vi.fn(async () => {}),
    removeManufacturer: vi.fn(async () => {}),
    addModel: vi.fn(async (manufacturerId: string, input: ModelInput) => {
      const id = `it-${current.items.length + 1}`;
      current = { ...current, items: [...current.items, { ...input, id, manufacturerId, shared: false }] };
      return id;
    }),
    updateModel: vi.fn(async () => {}),
    removeModel: vi.fn(async () => {}),
    usage: vi.fn(async () => ({ it1: 3 })),
  };
  return api;
}

function mount(opts: { catalogueApi?: CatalogueApi; data?: GymData; layoutApi?: LayoutApi } = {}) {
  const layoutApi: LayoutApi = opts.layoutApi ?? {
    save: vi.fn(async () => {}),
    setLink: vi.fn(async () => {}),
  };
  const data = opts.data ?? base;
  const view = render(
    <Planner
      gyms={[gym]}
      loadGym={() => Promise.resolve(data)}
      templates={null}
      history={null}
      layoutApi={layoutApi}
      catalogueApi={opts.catalogueApi ?? fakeCatalogue()}
      onSignOut={() => {}}
    />,
  );
  return { ...view, layoutApi };
}
async function ready() {
  await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
}

beforeEach(() => localStorage.clear());

describe('the Catalogue tab', () => {
  async function open(api = fakeCatalogue()) {
    mount({ catalogueApi: api });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Catalogue' }));
    await screen.findByRole('heading', { name: 'Equipment catalogue' });
    fireEvent.click(screen.getByRole('button', { name: 'Technogym' }));
    return api;
  }

  it('lists manufacturers and their models with codes, and how many machines use each', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Technogym' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eleiko' })).toBeInTheDocument();
    expect(screen.getByText('Selection Chest Press')).toBeInTheDocument();
    expect(screen.getByText('MPY01')).toBeInTheDocument();
    expect(await screen.findByText(/3 on your plans/)).toBeInTheDocument();
  });

  it('adds a manufacturer by typing it, or from the common ones', async () => {
    const api = await open();
    fireEvent.change(screen.getByLabelText('Add a manufacturer'), { target: { value: 'Hoist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add manufacturer' }));
    await waitFor(() => expect(api.addManufacturer).toHaveBeenCalledWith('Hoist'));
    fireEvent.click(screen.getByRole('button', { name: '+ Matrix' }));
    await waitFor(() => expect(api.addManufacturer).toHaveBeenCalledWith('Matrix'));
    expect(screen.queryByRole('button', { name: '+ Technogym' })).toBeNull();
  });

  it('adds a model with a code, kind, muscles and specifications', async () => {
    const api = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    expect(screen.getByText('Give the model a name first.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Leg Press 45' } });
    fireEvent.change(screen.getByLabelText('Item code'), { target: { value: 'LP45' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Muscles it trains' })).getByRole('button', { name: 'legs' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a specification' }));
    fireEvent.change(screen.getByLabelText('Specification 1 name'), { target: { value: 'Max load' } });
    fireEvent.change(screen.getByLabelText('Specification 1 value'), { target: { value: '300 kg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a specification' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    await waitFor(() => expect(api.addModel).toHaveBeenCalledTimes(1));
    const [maker, input] = vi.mocked(api.addModel).mock.calls[0]!;
    expect(maker).toBe('mk1');
    expect(input).toMatchObject({
      model: 'Leg Press 45',
      code: 'LP45',
      muscles: ['legs'],
      specs: [{ label: 'Max load', value: '300 kg' }],
    });
    expect(await screen.findByText('Leg Press 45')).toBeInTheDocument();
  });

  it('edits a model, and deleting it takes two taps and says how many machines use it', async () => {
    const api = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Selection Chest Press' }));
    fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Selection Chest Press 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    await waitFor(() =>
      expect(api.updateModel).toHaveBeenCalledWith(
        'it1',
        expect.objectContaining({ model: 'Selection Chest Press 2' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Selection Chest Press' }));
    const del = await screen.findByRole('button', { name: 'Delete model' });
    expect(del.textContent).toMatch(/3 machines use it/);
    fireEvent.click(del);
    expect(api.removeModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() => expect(api.removeModel).toHaveBeenCalledWith('it1'));
  });

  it('a shared manufacturer cannot be changed, but you can add your own model to it', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Eleiko' }));
    expect(screen.getByText(/A shared manufacturer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete Eleiko/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a model' })).toBeInTheDocument();
  });

  it('with nothing in the catalogue yet it offers the common manufacturers', async () => {
    mount({ catalogueApi: fakeCatalogue([]) });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Catalogue' }));
    expect(await screen.findByRole('button', { name: '+ Technogym' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Eleiko' })).toBeInTheDocument();
  });
});

describe('tagging machines with their real model', () => {
  it('a machine tagged with a model shows it when planning: in the pop-up and the Zones tab', async () => {
    const tagged: GymData = {
      ...base,
      layout: {
        ...base.layout,
        equipment: base.layout.equipment.map((e) => (e.id === machine.id ? { ...e, catalogueId: 'it1' } : e)),
      },
    };
    const { container } = mount({ data: tagged });
    await ready();
    await waitFor(() =>
      expect(fireEvent.click(container.querySelector(`g.mk[data-eq="${machine.id}"]`)!)).toBeDefined(),
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Technogym Selection Chest Press (MPY01)')).toBeInTheDocument();
  });

  it('assigning a model in Edit layout sets the link, name, kind and muscles, and saves it', async () => {
    const saved: Layout[] = [];
    const layoutApi: LayoutApi = {
      save: vi.fn(async (_g: string, l: Layout) => {
        saved.push(l);
      }),
      setLink: vi.fn(async () => {}),
    };
    const { container } = mount({ layoutApi });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument());
    fireEvent.click(container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const card = await screen.findByRole('region', { name: 'Selected machine' });
    fireEvent.change(within(card).getByLabelText('Manufacturer'), { target: { value: 'mk1' } });
    fireEvent.change(within(card).getByLabelText('Model'), { target: { value: 'it1' } });
    expect(within(card).getByText('Technogym Selection Chest Press')).toBeInTheDocument();
    expect(within(card).getByText('100 kg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const e = saved[0]!.equipment.find((x) => x.id === machine.id)!;
    expect(e.catalogueId).toBe('it1');
    expect(e.name).toBe('Selection Chest Press');
    expect(e.muscles).toEqual(['chest', 'arms']);
    expect(e.type).toBe('machine');
  });

  it('keeping the machine’s own name and details is a choice', async () => {
    const saved: Layout[] = [];
    const layoutApi: LayoutApi = {
      save: vi.fn(async (_g: string, l: Layout) => {
        saved.push(l);
      }),
      setLink: vi.fn(async () => {}),
    };
    const { container } = mount({ layoutApi });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const card = await screen.findByRole('region', { name: 'Selected machine' });
    fireEvent.click(within(card).getByLabelText('Use the model name as this machine’s name'));
    fireEvent.click(within(card).getByLabelText('Use the model’s kind and muscles'));
    fireEvent.change(within(card).getByLabelText('Manufacturer'), { target: { value: 'mk1' } });
    fireEvent.change(within(card).getByLabelText('Model'), { target: { value: 'it1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const e = saved[0]!.equipment.find((x) => x.id === machine.id)!;
    expect(e.catalogueId).toBe('it1');
    expect(e.name).toBe(machine.name);
    expect(e.muscles).toEqual(machine.muscles);
  });

  it('a new machine can be picked straight from the catalogue', async () => {
    const saved: Layout[] = [];
    const layoutApi: LayoutApi = {
      save: vi.fn(async (_g: string, l: Layout) => {
        saved.push(l);
      }),
      setLink: vi.fn(async () => {}),
    };
    const { container } = mount({ layoutApi });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(document.querySelector('g.zone')!);
    fireEvent.change(await screen.findByLabelText('Real machine (optional)'), { target: { value: 'it1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const added = saved[0]!.equipment.find((x) => x.catalogueId === 'it1')!;
    expect(added.name).toBe('Selection Chest Press');
    expect(added.type).toBe('machine');
    expect(container).toBeTruthy();
  });

  it('with an empty catalogue the machine card points to the Catalogue tab', async () => {
    const { container } = mount({ catalogueApi: fakeCatalogue([]) });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    fireEvent.click(container.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const card = await screen.findByRole('region', { name: 'Selected machine' });
    fireEvent.click(within(card).getByRole('button', { name: 'Catalogue' }));
    expect(await screen.findByRole('heading', { name: 'Equipment catalogue' })).toBeInTheDocument();
  });
});
