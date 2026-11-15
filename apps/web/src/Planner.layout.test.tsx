import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { layoutSavePayload, type GymSummary, type Layout } from '@pt/core';
import { Planner } from './Planner.tsx';
import type { LayoutApi } from './data/layoutApi.ts';
import { bedfordviewData } from './test-utils.ts';

const data = bedfordviewData();
const loadGym = () => Promise.resolve(data);
const gym: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
};
const zone = data.layout.zones[0]!;
const machine = data.layout.equipment.find((e) => e.zone === zone.id) ?? data.layout.equipment[0]!;

function fakeApi() {
  const saved: Layout[] = [];
  const api: LayoutApi = {
    save: vi.fn(async (_id: string, l: Layout) => {
      saved.push(l);
    }),
    setLink: vi.fn(async () => {}),
  };
  return { api, saved };
}

async function openEditor(layoutApi: LayoutApi) {
  render(
    <Planner
      gyms={[gym]}
      loadGym={loadGym}
      templates={null}
      history={null}
      layoutApi={layoutApi}
      onSignOut={() => {}}
    />,
  );
  await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
}

beforeEach(() => localStorage.clear());

describe('layout editor', () => {
  it('starts with nothing to save, and a new zone makes the layout unsaved', async () => {
    const { api } = fakeApi();
    await openEditor(api);
    expect(screen.getByText('Layout saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save layout' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    expect(screen.getByText('Unsaved layout changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeInTheDocument();
  });

  it('renaming a zone and saving sends the whole layout in one call', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Stretch corner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith('g1', expect.anything());
    expect(saved[0]!.zones.some((z) => z.name === 'Stretch corner')).toBe(true);
    expect(saved[0]!.zones).toHaveLength(data.layout.zones.length + 1);
    expect(() => layoutSavePayload(saved[0]!)).not.toThrow();
    await waitFor(() => expect(screen.getByText('Layout saved')).toBeInTheDocument());
  });

  it('discard drops the changes', async () => {
    const { api } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('Layout saved')).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('will not leave edit mode with unsaved changes', async () => {
    const { api } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan session' }));
    expect(screen.getByText('Save or discard your layout changes first.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });

  it('deleting a zone takes two taps and says how many machines go with it', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    const count = data.layout.equipment.filter((e) => e.zone === zone.id).length;
    const g = document.querySelector(`g.zone[data-zone="${zone.id}"]`);
    expect(g).not.toBeNull();
    fireEvent.click(g!);
    const del = await screen.findByRole('button', {
      name: 'Delete zone',
    });
    expect(del.textContent).toContain(`${count} machine`);
    fireEvent.click(del);
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.zones.some((z) => z.id === zone.id)).toBe(false);
    expect(saved[0]!.equipment.some((e) => e.zone === zone.id)).toBe(false);
  });

  it('adds a machine to the selected zone and can rename and delete it', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(document.querySelector(`g.zone[data-zone="${zone.id}"]`)!);
    fireEvent.change(await screen.findByLabelText('Machine name'), { target: { value: 'Test sled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }));
    const card = await screen.findByRole('region', { name: 'Selected machine' });
    expect(within(card).getByText(/Save the layout first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const added = saved[0]!.equipment.find((e) => e.name === 'Test sled')!;
    expect(added.zone).toBe(zone.id);
    expect(machine).toBeDefined();
  });

  it('a machine that is already saved lets you link exercises', async () => {
    const { api } = fakeApi();
    await openEditor(api);
    fireEvent.click(document.querySelector(`g.mk[data-eq="${machine.id}"]`)!);
    const card = await screen.findByRole('region', { name: 'Selected machine' });
    const boxes = within(card).getAllByRole('checkbox');
    fireEvent.click(boxes[0]!);
    await waitFor(() => expect(api.setLink).toHaveBeenCalledTimes(1));
  });

  it('adds a wall, a floor, and saves both in one call', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add wall' }));
    expect(await screen.findByRole('region', { name: 'Selected architecture' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a floor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.structs.some((q) => q.type === 'wall')).toBe(true);
    expect(saved[0]!.floors).toHaveLength(data.layout.floors.length + 1);
  });

  it('rotates a structure a quarter turn', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add staircase' }));
    const card = await screen.findByRole('region', { name: 'Selected architecture' });
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate 90°' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const st = saved[0]!.structs.find(
      (q) => q.id && q.type === 'stairs' && q.label === 'STAIRS' && q.h === 80,
    );
    expect(st).toBeDefined();
  });

  it('joins two touching zones into one and the machines come along', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.change(screen.getByLabelText('Name', { exact: true }), { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    fireEvent.change(screen.getByLabelText('Name', { exact: true }), { target: { value: 'Second' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Join “First”' }));
    expect(screen.getByRole('button', { name: 'Part 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const second = saved[0]!.zones.find((z) => z.name === 'Second')!;
    expect(second.parts).toHaveLength(1);
    expect(saved[0]!.zones.some((z) => z.name === 'First')).toBe(false);
  });

  it('duplicating a zone copies its machines, and their exercise links are copied on save', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    const withLinks = data.library.find((x) => x.equipmentIds.length > 0)!;
    const eqId = withLinks.equipmentIds[0]!;
    const z = data.layout.zones.find((q) => q.id === data.layout.equipment.find((e) => e.id === eqId)!.zone)!;
    fireEvent.click(document.querySelector(`g.zone[data-zone="${z.id}"]`)!);
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const copy = saved[0]!.zones.find((q) => q.name.endsWith(' copy'))!;
    expect(copy).toBeDefined();
    const copied = saved[0]!.equipment.filter((e) => e.zone === copy.id);
    expect(copied.length).toBe(data.layout.equipment.filter((e) => e.zone === z.id).length);
    await waitFor(() => expect(api.setLink).toHaveBeenCalled());
    const newIds = new Set(copied.map((e) => e.id));
    expect(vi.mocked(api.setLink).mock.calls.every((c) => newIds.has(c[1]))).toBe(true);
  });

  it('deleting a floor takes two taps, says what goes, and removes it on save', async () => {
    const { api, saved } = fakeApi();
    await openEditor(api);
    fireEvent.click(screen.getByRole('button', { name: /^Delete this floor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.floors).toHaveLength(data.layout.floors.length - 1);
  });
});
