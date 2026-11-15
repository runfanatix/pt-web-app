import { describe, it, expect } from 'vitest';
import { ImportError, planPrototypeImport, runImport } from './import-prototype.ts';
import type { ImportSink } from './import-prototype.ts';

function counter() { let n = 0; return () => 'id' + (++n); }
const opts = () => ({ trainerId: 'trainer-1', newId: counter() });

function sample() {
  return {
    venue: 'Virgin Active Bedfordview',
    gym: { name: 'Virgin Active', branch: 'Bedfordview', address: '101 Van Buuren Rd', phone: '', notes: '' },
    floors: [{ id: 'f1', name: 'Ground floor', w: 1000, h: 620 }, { id: 'f2', name: 'First floor', w: 900, h: 500 }],
    zones: [
      { id: 'cardio', name: 'Cardio', cat: 'cardio', x: 30, y: 30, w: 250, h: 180, floor: 'f1' },
      { id: 'joined', name: 'Strength', cat: 'strength', x: 290, y: 30, w: 100, h: 100, floor: 'f1', parts: [{ x: 390, y: 30, w: 100, h: 200 }, { x: 'bad' }] },
      { id: 'studio', name: 'Studio', cat: 'studio', x: 20, y: 20, w: 300, h: 200, floor: 'f2' }
    ],
    structs: [
      { id: 's1', type: 'stairs', floor: 'f1', x: 50, y: 500, w: 80, h: 44, shared: true },
      { id: 's2', type: 'stairs', floor: 'f2', x: 50, y: 500, w: 80, h: 44, shared: true },
      { id: 's3', type: 'wall', floor: 'f1', x: 10, y: 10, x2: 200, y2: 10 },
      { id: 's4', type: 'door', floor: 'f1', x: 100, y: 600, w: 36, rot: 90 },
      { id: 's5', type: 'nonsense', floor: 'f1', x: 1, y: 1 }
    ],
    equipment: [
      { id: 'tread', name: 'Treadmills', zone: 'cardio', type: 'cardio', x: 60, y: 80, muscles: ['cardio', 'nonsense'], notes: '', floor: 'f1', exerciseIds: ['walk'] },
      { id: 'press', name: 'Chest press', zone: 'joined', type: 'machine', x: 420, y: 150, muscles: ['chest'], notes: 'n', floor: 'f1', exerciseIds: [] },
      { id: 'lost', name: 'Lost bench', zone: 'gone', type: 'free', x: 300, y: 60, muscles: [], notes: '', floor: 'f1' },
      { id: 'nowhere', name: 'Nowhere', zone: 'gone', type: 'free', x: 5000, y: 5000, muscles: [], notes: '', floor: 'f1' }
    ],
    exercises: [
      { id: 'walk', name: 'Incline walk', muscles: ['cardio'], equipmentIds: ['tread'], level: 'B', sets: 1, reps: '8 min', rest: 0, cue: 'Tall posture' },
      { id: 'cp', name: 'Seated chest press', muscles: ['chest'], equipmentIds: ['press', 'ghost'], level: 'X', sets: 3, reps: 10, rest: 'abc', cue: '' },
      { id: 'unused', name: 'Unused exercise', muscles: [], equipmentIds: [], level: 'A', sets: 2, reps: '5', rest: 30, cue: '' }
    ],
    templates: [
      { id: 't1', name: 'Beginner', notes: '', gymId: 'old-gym-id', items: [
        { eid: 'press', xid: 'cp', exercise: 'Seated chest press', sets: 3, reps: '10', rest: 60, note: '' },
        { eid: 'removed-machine', xid: null, exercise: 'Leg press', sets: 3, reps: '10', rest: 60, note: '' }
      ] },
      { id: 't2', name: 'Empty after filtering', notes: '', items: [{ eid: 'gone', exercise: 'x', sets: 1, reps: '1', rest: 0, note: '' }] }
    ],
    session: {
      title: 'Thabo push day', notes: '', items: [{ equipmentId: 'tread', exerciseId: 'walk', exercise: 'Incline walk', sets: 1, reps: '8 min', restSeconds: 0, note: '' }]
    }
  };
}

describe('planPrototypeImport', () => {
  it('maps a prototype export into rows with fresh ids', () => {
    const { plan } = planPrototypeImport(sample(), opts());
    expect(plan.gym.name).toBe('Virgin Active');
    expect(plan.gym.branch).toBe('Bedfordview');
    expect(plan.gym.trainer_id).toBe('trainer-1');
    expect(plan.floors).toHaveLength(2);
    expect(plan.floors[1].w).toBe(900);
    expect(plan.zones).toHaveLength(3);
    expect(plan.zones[0].category).toBe('cardio');
    const ids = [plan.gym.id].concat(plan.floors.map((f) => f.id), plan.zones.map((z) => z.id), plan.equipment.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.zones[0].floor_id).toBe(plan.floors[0].id);
    expect(plan.zones[2].floor_id).toBe(plan.floors[1].id);
  });

  it('keeps joined zones as a primary rectangle plus valid parts only', () => {
    const { plan } = planPrototypeImport(sample(), opts());
    expect(plan.zoneParts).toHaveLength(1);
    expect(plan.zoneParts[0].zone_id).toBe(plan.zones[1].id);
    expect(plan.zoneParts[0].w).toBe(100);
  });

  it('clamps sizes to the prototype limits', () => {
    const s = sample();
    s.floors[0].w = 99999;
    s.floors[0].h = 10;
    s.zones[0].w = 5;
    s.zones[0].h = 5;
    const { plan } = planPrototypeImport(s, opts());
    expect(plan.floors[0].w).toBe(2400);
    expect(plan.floors[0].h).toBe(400);
    expect(plan.zones[0].w).toBe(60);
    expect(plan.zones[0].h).toBe(50);
  });

  it('collapses identical shared stairs and drops unknown struct types', () => {
    const { plan } = planPrototypeImport(sample(), opts());
    expect(plan.structs.filter((s) => s.type === 'stairs')).toHaveLength(1);
    expect(plan.structs.some((s) => s.type === ('nonsense' as string))).toBe(false);
    const wall = plan.structs.find((s) => s.type === 'wall')!;
    expect(wall.x2).toBe(200);
    expect(wall.w).toBe(null);
    expect(plan.structs.find((s) => s.type === 'door')!.rotation).toBe(90);
  });

  it('finds the zone for a machine whose zone is missing, and skips machines in no zone', () => {
    const { plan, warnings } = planPrototypeImport(sample(), opts());
    const lost = plan.equipment.find((e) => e.name === 'Lost bench')!;
    expect(lost.zone_id).toBe(plan.zones[1].id);
    expect(plan.equipment.some((e) => e.name === 'Nowhere')).toBe(false);
    expect(warnings.join(' ')).toContain('Nowhere');
    expect(plan.equipment.find((e) => e.name === 'Treadmills')!.muscles).toEqual(['cardio']);
  });

  it('builds exercise links from either side without duplicates and ignores unknown ids', () => {
    const { plan } = planPrototypeImport(sample(), opts());
    const tread = plan.equipment.find((e) => e.name === 'Treadmills')!.id;
    const walkLinks = plan.links.filter((l) => l.exerciseLegacyId === 'walk' && l.equipmentId === tread);
    expect(walkLinks).toHaveLength(1);
    expect(plan.links.filter((l) => l.exerciseLegacyId === 'cp')).toHaveLength(1);
  });

  it('normalises exercises and leaves out unlinked ones unless asked', () => {
    const { plan } = planPrototypeImport(sample(), opts());
    expect(plan.exercises.map((x) => x.legacyId).sort()).toEqual(['cp', 'walk']);
    const cp = plan.exercises.find((x) => x.legacyId === 'cp')!;
    expect(cp.level).toBe('B');
    expect(cp.reps).toBe('10');
    expect(cp.rest).toBe(60);
    const all = planPrototypeImport(sample(), { ...opts(), allExercises: true }).plan;
    expect(all.exercises).toHaveLength(3);
  });

  it('imports templates, drops items for missing machines, and reassigns the gym', () => {
    const { plan, warnings } = planPrototypeImport(sample(), opts());
    expect(plan.templates).toHaveLength(1);
    expect(plan.templates[0].gym_id).toBe(plan.gym.id);
    expect(plan.templateItems).toHaveLength(1);
    expect(plan.templateItems[0].exercise_legacy_id).toBe('cp');
    expect(warnings.join(' ')).toContain('Empty after filtering');
    expect(warnings.join(' ')).toContain('left out');
  });

  it('imports the on-screen session as a template only when asked', () => {
    expect(planPrototypeImport(sample(), opts()).plan.templates).toHaveLength(1);
    const { plan } = planPrototypeImport(sample(), { ...opts(), includeSession: true });
    expect(plan.templates.map((t) => t.name)).toContain('Thabo push day');
    const item = plan.templateItems.find((t) => t.exercise_name === 'Incline walk')!;
    expect(item.reps).toBe('8 min');
  });

  it('lets the caller override the gym name', () => {
    const { plan } = planPrototypeImport(sample(), { ...opts(), gymName: 'Test gym' });
    expect(plan.gym.name).toBe('Test gym');
    expect(plan.gym.branch).toBe('');
  });

  it('creates a ground floor for old exports without floors', () => {
    const s = sample() as Record<string, unknown>;
    delete s.floors;
    const { plan, warnings } = planPrototypeImport(s, opts());
    expect(plan.floors).toHaveLength(1);
    expect(plan.zones.every((z) => z.floor_id === plan.floors[0].id)).toBe(true);
    expect(warnings.join(' ')).toContain('no floors');
  });

  it('rejects files that are not exports and reports every bad row', () => {
    expect(() => planPrototypeImport('nope', opts())).toThrow(ImportError);
    expect(() => planPrototypeImport({ zones: [] }, opts())).toThrow(ImportError);
    const s = sample();
    (s.zones as unknown[]).push({ id: 'bad' });
    (s.equipment as unknown[]).push({ id: 'bad2' });
    try {
      planPrototypeImport(s, opts());
      expect('should have thrown').toBe('');
    } catch (err) {
      expect((err as ImportError).problems).toHaveLength(2);
    }
  });
});

function memorySink(failOn?: string) {
  const tables: Record<string, object[]> = {};
  const deleted: string[] = [];
  const existing: Record<string, string> = { 'incline walk': 'db-ex-1' };
  let next = 0;
  const sink: ImportSink = {
    async insert(table, rows) {
      if (table === failOn) throw new Error('boom in ' + table);
      tables[table] = (tables[table] || []).concat(rows);
    },
    async findExerciseIdsByName() { return existing; },
    async createExercises(_trainer, defs) { return defs.map(() => 'new-ex-' + (++next)); },
    async deleteWhere(table, column, value) { deleted.push(table + ':' + column + '=' + value); }
  };
  return { sink, tables, deleted };
}

describe('runImport', () => {
  it('matches exercises by name, creates the rest, and writes every table', async () => {
    const { plan } = planPrototypeImport(sample(), { ...opts(), includeSession: true });
    const m = memorySink();
    const summary = await runImport(plan, m.sink);
    expect(summary.exercisesMatched).toBe(1);
    expect(summary.exercisesCreated).toBe(1);
    expect(summary.zones).toBe(3);
    const links = m.tables['exercise_equipment'] as { exercise_id: string }[];
    expect(links.map((l) => l.exercise_id).sort()).toEqual(['db-ex-1', 'new-ex-1']);
    const items = m.tables['template_items'] as { exercise_id: string | null; exercise_legacy_id?: string }[];
    expect(items.every((i) => i.exercise_legacy_id === undefined)).toBe(true);
    expect(items.some((i) => i.exercise_id === 'new-ex-1')).toBe(true);
  });

  it('removes the gym and the exercises it created when a step fails', async () => {
    const { plan } = planPrototypeImport(sample(), opts());
    const m = memorySink('equipment');
    await expect(runImport(plan, m.sink)).rejects.toThrow('boom in equipment');
    expect(m.deleted).toContain('gyms:id=' + plan.gym.id);
    expect(m.deleted).toContain('exercises:id=new-ex-1');
  });
});
