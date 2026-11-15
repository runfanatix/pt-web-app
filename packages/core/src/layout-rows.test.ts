import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exerciseRowsFromPlan,
  floorRowsFromPlan,
  gymDataFromRows,
  layoutFromFloorRows,
} from './layout-rows.ts';
import { planPrototypeImport } from './import-prototype.ts';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);

function nestedRows() {
  const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });
  return floorRowsFromPlan(plan);
}

describe('layoutFromFloorRows', () => {
  it('maps the imported Bedfordview rows into a valid layout', () => {
    const layout = layoutFromFloorRows(nestedRows());
    expect(layout.floors).toHaveLength(2);
    expect(layout.zones).toHaveLength(14);
    expect(layout.structs).toHaveLength(3);
    expect(layout.equipment).toHaveLength(41);
    expect(layout.floors.map((f) => f.name)).toEqual(['Ground floor', 'First floor']);
  });

  it("puts every item on its zone's floor and every zone on a known floor", () => {
    const layout = layoutFromFloorRows(nestedRows());
    const floorOfZone = new Map(layout.zones.map((z) => [z.id, z.floor]));
    expect(layout.equipment.every((e) => e.floor === floorOfZone.get(e.zone))).toBe(true);
  });

  it('orders floors by position and joined-zone parts by position', () => {
    const rows = nestedRows().reverse();
    const first = rows.find((f) => f.position === 0)!;
    first.zones[0]!.zone_parts = [
      { x: 50, y: 0, w: 20, h: 20, position: 1 },
      { x: 0, y: 50, w: 30, h: 30, position: 0 },
    ];
    const layout = layoutFromFloorRows(rows);
    expect(layout.floors[0]!.id).toBe(first.id);
    expect(layout.zones.find((z) => z.id === first.zones[0]!.id)!.parts).toEqual([
      { x: 0, y: 50, w: 30, h: 30 },
      { x: 50, y: 0, w: 20, h: 20 },
    ]);
  });

  it('accepts numeric columns delivered as strings and null optional struct fields', () => {
    const rows = nestedRows();
    rows[0]!.zones[0]!.x = '30' as unknown as number;
    rows[0]!.structs[0]!.x2 = null as unknown as number;
    const layout = layoutFromFloorRows(rows);
    expect(layout.zones[0]!.x).toBe(30);
    expect(layout.structs[0]!.x2).toBeUndefined();
  });

  it('rejects malformed rows instead of drawing them', () => {
    expect(() => layoutFromFloorRows([{ id: 'f1' }])).toThrow();
    const rows = nestedRows();
    rows[0]!.zones[0]!.category = 'pool';
    expect(() => layoutFromFloorRows(rows)).toThrow();
  });
});

describe('gymDataFromRows (layout plus exercise library)', () => {
  const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });

  it('gives every exercise its machines at this gym: 111 exercises, 139 links', () => {
    const data = gymDataFromRows(floorRowsFromPlan(plan), exerciseRowsFromPlan(plan));
    expect(data.library).toHaveLength(111);
    expect(data.library.reduce((n, x) => n + x.equipmentIds.length, 0)).toBe(139);
    const machineIds = new Set(data.layout.equipment.map((e) => e.id));
    expect(data.library.every((x) => x.equipmentIds.every((id) => machineIds.has(id)))).toBe(true);
  });

  it('exercises with no machine here have an empty list', () => {
    const rows = floorRowsFromPlan(plan);
    rows.forEach((f) => f.zones.forEach((z) => z.equipment.forEach((e) => (e.exercise_equipment = []))));
    const data = gymDataFromRows(rows, exerciseRowsFromPlan(plan));
    expect(data.library.every((x) => x.equipmentIds.length === 0)).toBe(true);
  });

  it('rejects malformed exercise rows', () => {
    expect(() => gymDataFromRows(floorRowsFromPlan(plan), [{ id: 'x' }])).toThrow();
  });
});
