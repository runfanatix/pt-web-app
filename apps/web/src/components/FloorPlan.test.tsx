import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Layout } from '@pt/core';
import { FloorPlan } from './FloorPlan.tsx';
import { FloorTabs, MuscleChips } from './PlanControls.tsx';
import { bedfordviewLayout } from '../test-utils.ts';

const layout = bedfordviewLayout();
const ground = layout.floors[0]!;
const first = layout.floors[1]!;

function plan(over: Partial<Parameters<typeof FloorPlan>[0]> = {}) {
  return render(
    <FloorPlan
      layout={layout}
      floorId={ground.id}
      filter="all"
      selZone={null}
      selEq={null}
      onSelectZone={() => {}}
      onSelectEq={() => {}}
      {...over}
    />,
  );
}

describe('FloorPlan (Bedfordview)', () => {
  it('draws the zones and machines of each floor', () => {
    const a = plan();
    const expectedZones = layout.zones.filter((z) => z.floor === ground.id).length;
    const expectedEquip = layout.equipment.filter((e) => e.floor === ground.id).length;
    expect(a.container.querySelectorAll('g.zone')).toHaveLength(expectedZones);
    expect(a.container.querySelectorAll('g.mk')).toHaveLength(expectedEquip);
    a.unmount();
    const b = plan({ floorId: first.id });
    expect(b.container.querySelectorAll('g.zone')).toHaveLength(
      layout.zones.filter((z) => z.floor === first.id).length,
    );
    expect(layout.zones.length).toBe(14);
    expect(layout.equipment.length).toBe(41);
  });

  it("sizes the drawing to the floor's canvas", () => {
    const { container } = plan();
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', `0 0 ${ground.w} ${ground.h}`);
  });

  it('shows the shared stairs and lift on every floor', () => {
    const sharedTypes = layout.structs.filter((s) => s.shared).map((s) => s.type);
    expect(sharedTypes.length).toBeGreaterThan(0);
    for (const f of [ground, first]) {
      const { container, unmount } = plan({ floorId: f.id });
      const drawn = container.querySelectorAll('g.st').length;
      const expected = layout.structs.filter(
        (s) => s.floor === f.id || (s.shared && ['stairs', 'lift'].includes(s.type)),
      ).length;
      expect(drawn).toBe(expected);
      unmount();
    }
  });

  it('dims machines that do not train the chosen muscle', () => {
    const { container } = plan({ filter: 'chest' });
    const onFloor = layout.equipment.filter((e) => e.floor === ground.id);
    const dimmed = container.querySelectorAll('g.mk.dim').length;
    expect(dimmed).toBe(onFloor.filter((e) => !(e.muscles as string[]).includes('chest')).length);
    expect(dimmed).toBeGreaterThan(0);
    expect(dimmed).toBeLessThan(onFloor.length);
  });

  it('labels every machine in a selected zone and reports selections', () => {
    const onSelectZone = vi.fn();
    const zone = layout.zones.find(
      (z) => z.floor === ground.id && layout.equipment.some((e) => e.zone === z.id),
    )!;
    const { container } = plan({ selZone: zone.id, onSelectZone });
    expect(container.querySelectorAll('g.mk.lab')).toHaveLength(
      layout.equipment.filter((e) => e.zone === zone.id).length,
    );
    fireEvent.click(container.querySelector(`g.zone[data-zone="${zone.id}"]`)!);
    expect(onSelectZone).toHaveBeenCalledWith(null); // clicking the selected zone deselects it
  });

  it('machines are keyboard-operable buttons named after the machine and its zone', () => {
    const onSelectEq = vi.fn();
    const { container } = plan({ onSelectEq });
    const eq = layout.equipment.find((e) => e.floor === ground.id)!;
    const marker = container.querySelector(`g.mk[data-eq="${eq.id}"]`)!;
    expect(marker).toHaveAttribute('role', 'button');
    expect(marker.getAttribute('aria-label')).toContain(eq.name);
    fireEvent.keyDown(marker, { key: 'Enter' });
    expect(onSelectEq).toHaveBeenCalledWith(eq.id);
  });

  it('draws a joined zone as one outline path', () => {
    const joined: Layout = {
      floors: [{ id: 'f', name: 'F', w: 1000, h: 620 }],
      zones: [
        {
          id: 'z',
          name: 'Joined',
          cat: 'cardio',
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          floor: 'f',
          parts: [{ x: 100, y: 0, w: 100, h: 50 }],
        },
      ],
      structs: [],
      equipment: [],
    };
    const { container } = render(
      <FloorPlan
        layout={joined}
        floorId="f"
        filter="all"
        selZone={null}
        selEq={null}
        onSelectZone={() => {}}
        onSelectEq={() => {}}
      />,
    );
    const path = container.querySelector('g.zone path.zp');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')!.match(/M/g)).toHaveLength(1);
    expect(container.querySelector('g.zone rect')).toBeNull();
  });

  it('says so when a floor is empty', () => {
    const empty: Layout = {
      floors: [{ id: 'f', name: 'F', w: 1000, h: 620 }],
      zones: [],
      structs: [],
      equipment: [],
    };
    render(
      <FloorPlan
        layout={empty}
        floorId="f"
        filter="all"
        selZone={null}
        selEq={null}
        onSelectZone={() => {}}
        onSelectEq={() => {}}
      />,
    );
    expect(screen.getByText('Nothing on this floor yet.')).toBeInTheDocument();
  });
});

describe('floor tabs and muscle chips', () => {
  it('floor tabs show only for gyms with two or more floors, and switch floor', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <FloorTabs floors={layout.floors} floorId={ground.id} onChange={onChange} />,
    );
    const group = within(container).getByRole('group', { name: 'Floors' });
    fireEvent.click(within(group).getByRole('button', { name: first.name }));
    expect(onChange).toHaveBeenCalledWith(first.id);
    rerender(<FloorTabs floors={[ground]} floorId={ground.id} onChange={onChange} />);
    expect(container.querySelector('.floorbar')).toBeNull();
  });

  it('muscle chips list All plus the ten muscles and report the choice', () => {
    const onChange = vi.fn();
    render(<MuscleChips filter="all" onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'glutes' }));
    expect(onChange).toHaveBeenCalledWith('glutes');
  });
});
