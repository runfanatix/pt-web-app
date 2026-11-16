import { describe, expect, it } from 'vitest';
import {
  assignModel,
  catalogueFromRows,
  catalogueIndex,
  layoutCanonical,
  layoutChanged,
  layoutSavePayload,
  machineTitle,
  modelName,
  modelWithCode,
  planCatalogueImport,
  searchModels,
} from './index.ts';
import type { Layout } from './schemas.ts';

const rows = [
  {
    id: 'm-tg',
    trainer_id: 't1',
    name: 'Technogym',
    catalogue_items: [
      {
        id: 'i1',
        trainer_id: 't1',
        model_name: 'Selection Chest Press',
        code: 'MPY01',
        kind: 'machine',
        muscles: ['chest', 'arms'],
        specs: [{ label: 'Weight stack', value: '100 kg' }],
        notes: '',
      },
      {
        id: 'bad',
        trainer_id: 't1',
        model_name: 'Broken',
        code: '',
        kind: 'spaceship',
        muscles: [],
        specs: [],
        notes: '',
      },
    ],
  },
  { id: 'm-el', trainer_id: null, name: 'Eleiko', catalogue_items: [] },
];

const layout = (): Layout => ({
  floors: [{ id: 'f', name: 'Ground', w: 1000, h: 620 }],
  zones: [{ id: 'z', name: 'Z', cat: 'strength', x: 10, y: 10, w: 200, h: 100, floor: 'f' }],
  structs: [],
  equipment: [
    {
      id: 'e1',
      name: 'Chest press',
      zone: 'z',
      type: 'cardio',
      x: 50,
      y: 50,
      muscles: ['legs'],
      notes: '',
      floor: 'f',
    },
  ],
});

describe('the catalogue', () => {
  const c = catalogueFromRows(rows);
  const idx = catalogueIndex(c);

  it('reads manufacturers and models, sorted, marks shared ones, and drops a row that is not valid', () => {
    expect(c.manufacturers.map((m) => [m.name, m.shared])).toEqual([
      ['Eleiko', true],
      ['Technogym', false],
    ]);
    expect(c.items.map((i) => i.model)).toEqual(['Selection Chest Press']);
    expect(c.items[0]!.specs).toEqual([{ label: 'Weight stack', value: '100 kg' }]);
  });

  it('names the real machine, with its code when it has one', () => {
    const e = idx.get('i1')!;
    expect(modelName(e)).toBe('Technogym Selection Chest Press');
    expect(modelWithCode(e)).toBe('Technogym Selection Chest Press (MPY01)');
  });

  it('a machine title adds the model unless the name already says it', () => {
    const e = idx.get('i1')!;
    expect(machineTitle('Chest press', e)).toBe('Chest press · Technogym Selection Chest Press');
    expect(machineTitle('Technogym Selection Chest Press', e)).toBe('Technogym Selection Chest Press');
    expect(machineTitle('Selection Chest Press', e)).toBe('Selection Chest Press · Technogym');
    expect(machineTitle('Chest press', undefined)).toBe('Chest press');
  });

  it('search finds by model, code or manufacturer, within one manufacturer if asked', () => {
    expect(searchModels(c, 'chest')).toHaveLength(1);
    expect(searchModels(c, 'mpy')).toHaveLength(1);
    expect(searchModels(c, 'technogym')).toHaveLength(1);
    expect(searchModels(c, 'chest', 'm-el')).toHaveLength(0);
    expect(searchModels(c, '')).toHaveLength(1);
  });
});

describe('assigning a model to a machine', () => {
  const idx = catalogueIndex(catalogueFromRows(rows));
  const entry = idx.get('i1')!;

  it('links it, and can take the model name, kind and muscles too', () => {
    const l = layout();
    expect(assignModel(l, 'e1', entry).equipment[0]).toMatchObject({
      catalogueId: 'i1',
      name: 'Chest press',
      type: 'cardio',
    });
    expect(assignModel(l, 'e1', entry, { rename: true, copyDetails: true }).equipment[0]).toMatchObject({
      catalogueId: 'i1',
      name: 'Selection Chest Press',
      type: 'machine',
      muscles: ['chest', 'arms'],
    });
  });

  it('clears the link with null and never touches other machines', () => {
    const l = assignModel(layout(), 'e1', entry);
    expect(assignModel(l, 'e1', null).equipment[0]!.catalogueId).toBeNull();
    expect(assignModel(l, 'nope', entry)).toEqual(l);
  });

  it('counts as an unsaved change and is sent to the database', () => {
    const l = layout();
    const next = assignModel(l, 'e1', entry);
    expect(layoutChanged(l, next)).toBe(true);
    expect(layoutCanonical(next)).not.toBe(layoutCanonical(l));
    expect(layoutSavePayload(next).equipment[0]!.catalogue_item_id).toBe('i1');
    expect(layoutSavePayload(l).equipment[0]!.catalogue_item_id).toBeNull();
  });
});

describe('planning a bulk import', () => {
  it('fixes bad kinds and muscles with a warning, and skips repeated codes', () => {
    const plan = planCatalogueImport({
      manufacturers: [
        {
          name: 'Technogym',
          items: [
            {
              model: 'A',
              code: 'X1',
              kind: 'machine',
              muscles: ['chest', 'wings'],
              specs: [{ label: 'Stack', value: 100 }],
            },
            { model: 'B', code: 'x1' },
            { model: 'C', kind: 'tank' },
          ],
        },
        { name: 'technogym', items: [{ model: 'D' }] },
      ],
    });
    expect(plan.manufacturers).toEqual(['Technogym']);
    expect(plan.items.map((i) => i.model)).toEqual(['A', 'C', 'D']);
    expect(plan.items[0]!.muscles).toEqual(['chest']);
    expect(plan.items[0]!.specs).toEqual([{ label: 'Stack', value: '100' }]);
    expect(plan.items[1]!.kind).toBe('machine');
    expect(plan.warnings).toHaveLength(3);
  });

  it('refuses a file that is not a catalogue', () => {
    expect(() => planCatalogueImport({ nope: 1 })).toThrow();
  });
});
