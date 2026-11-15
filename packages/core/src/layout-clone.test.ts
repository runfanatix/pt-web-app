import { describe, expect, it } from 'vitest';
import { LayoutSchema, blankLayout, cloneLayout, gymTitle, uniqueGymName } from './index.ts';
import type { Layout } from './schemas.ts';

const src: Layout = {
  floors: [
    { id: 'f1', name: 'Ground', w: 1000, h: 620 },
    { id: 'f2', name: 'First', w: 800, h: 500 },
  ],
  zones: [
    {
      id: 'a',
      name: 'A',
      cat: 'cardio',
      x: 10,
      y: 10,
      w: 100,
      h: 80,
      floor: 'f1',
      parts: [{ x: 110, y: 10, w: 50, h: 40 }],
    },
    { id: 'b', name: 'B', cat: 'strength', x: 10, y: 10, w: 100, h: 80, floor: 'f2' },
  ],
  structs: [
    { id: 's', type: 'lift', floor: 'f1', x: 5, y: 5, w: 36, h: 36, rot: 0, label: 'LIFT', shared: true },
  ],
  equipment: [
    {
      id: 'm1',
      name: 'Bike',
      zone: 'a',
      type: 'cardio',
      x: 30,
      y: 30,
      muscles: ['cardio'],
      notes: 'n',
      floor: 'f1',
    },
    {
      id: 'm2',
      name: 'Press',
      zone: 'b',
      type: 'machine',
      x: 30,
      y: 30,
      muscles: ['chest'],
      notes: '',
      floor: 'f2',
    },
  ],
};

describe('starting a gym', () => {
  it('a blank layout is one empty floor and is valid', () => {
    const l = blankLayout('f');
    expect(LayoutSchema.safeParse(l).success).toBe(true);
    expect(l.zones).toHaveLength(0);
  });

  it('a copy has new ids everywhere, the same shape, and stays valid', () => {
    let n = 0;
    const { layout, machines } = cloneLayout(src, () => `n${(n += 1)}`);
    expect(LayoutSchema.safeParse(layout).success).toBe(true);
    const ids = [...layout.floors, ...layout.zones, ...layout.structs, ...layout.equipment].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => ['f1', 'f2', 'a', 'b', 's', 'm1', 'm2'].includes(i))).toBe(false);
    expect(layout.zones[0]!.parts).toEqual(src.zones[0]!.parts);
    expect(layout.zones[0]!.floor).toBe(layout.floors[0]!.id);
    expect(layout.equipment[1]!.zone).toBe(layout.zones[1]!.id);
    expect(layout.structs[0]!.floor).toBe(layout.floors[0]!.id);
    expect(machines.map((m) => m.from)).toEqual(['m1', 'm2']);
    expect(machines[0]!.to).toBe(layout.equipment[0]!.id);
  });

  it('a copy does not share objects with the original', () => {
    const { layout } = cloneLayout(src, () => Math.random().toString(36));
    layout.equipment[0]!.muscles.push('legs');
    layout.zones[0]!.parts![0]!.x = 999;
    expect(src.equipment[0]!.muscles).toEqual(['cardio']);
    expect(src.zones[0]!.parts![0]!.x).toBe(110);
  });

  it('gym names stay unique by title', () => {
    const gyms = [{ name: 'Virgin Active', branch: 'Bedfordview' }];
    expect(gymTitle(gyms[0]!)).toBe('Virgin Active Bedfordview');
    expect(uniqueGymName(gyms, 'Virgin Active', 'Bedfordview')).toBe('Virgin Active 2');
    expect(uniqueGymName(gyms, 'Virgin active', 'sandton')).toBe('Virgin active');
    expect(
      uniqueGymName(
        [...gyms, { name: 'Virgin Active 2', branch: 'Bedfordview' }],
        'Virgin Active',
        'Bedfordview',
      ),
    ).toBe('Virgin Active 3');
  });
});
