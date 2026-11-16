import { describe, expect, it } from 'vitest';
import {
  blankExercise,
  exerciseProblems,
  exerciseToInput,
  filterLibrary,
  linkChanges,
  noFilter,
  normaliseLink,
  planBulkImport,
  tidyExercise,
  type LibraryExercise,
} from './index.ts';

const ex = (over: Partial<LibraryExercise> & { id: string; name: string }): LibraryExercise => ({
  muscles: [],
  level: 'B',
  sets: 3,
  reps: '10',
  rest: 60,
  cue: '',
  equipmentIds: [],
  ...over,
});
const lib = [
  ex({ id: 'sq', name: 'Squat', muscles: ['legs', 'glutes'], equipmentIds: ['rack'] }),
  ex({ id: 'bp', name: 'Bench press', muscles: ['chest'], equipmentIds: ['bench', 'smith'] }),
  ex({ id: 'pl', name: 'Plank', muscles: ['core'] }),
  ex({ id: 'ab', name: 'Abductor', muscles: ['glutes'], equipmentIds: ['abd'] }),
];

describe('links', () => {
  it('make a typed link safe and refuse anything that is not a web address', () => {
    expect(normaliseLink('')).toBe('');
    expect(normaliseLink('  youtube.com/watch?v=1 ')).toBe('https://youtube.com/watch?v=1');
    expect(normaliseLink('http://x.co/a')).toBe('http://x.co/a');
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('ftp://x.co')).toBeNull();
    expect(normaliseLink('https://has space.com')).toBeNull();
    expect(normaliseLink('https://' + 'a'.repeat(300))).toBeNull();
  });
});

describe('checking an exercise', () => {
  const ok = { ...blankExercise(['legs']), name: 'Lunge' };
  it('a good one has no problems, and a blank one asks for a name', () => {
    expect(exerciseProblems(ok)).toEqual([]);
    expect(exerciseProblems(blankExercise())).toEqual(['Give the exercise a name.']);
  });
  it('names the problem in plain words', () => {
    const p = exerciseProblems({
      ...ok,
      name: 'x'.repeat(81),
      sets: 0,
      rest: -1,
      reps: 'y'.repeat(41),
      cue: 'z'.repeat(1001),
      link: 'ftp://x',
    });
    expect(p).toHaveLength(6);
    expect(p).toContain('Sets must be a whole number from 1 to 99.');
    expect(p).toContain('The demo link must start with http:// or https://.');
  });
  it('tidies what is saved', () => {
    expect(
      tidyExercise({
        ...ok,
        name: ' Lunge ',
        sets: 2.6,
        reps: '  ',
        rest: 12.4,
        cue: ' keep tall ',
        link: 'x.co/v',
        muscles: ['legs', 'wings'],
      }),
    ).toEqual({
      name: 'Lunge',
      level: 'B',
      sets: 3,
      reps: '10',
      rest: 12,
      cue: 'keep tall',
      link: 'https://x.co/v',
      muscles: ['legs'],
    });
  });
  it('an exercise from the library can be edited as a form', () => {
    expect(exerciseToInput(ex({ id: 'a', name: 'A', level: 'X', link: 'https://x.co' }))).toMatchObject({
      level: 'B',
      link: 'https://x.co',
    });
  });
});

describe('searching and filtering', () => {
  it('lists everything by name when nothing is chosen', () => {
    expect(filterLibrary(lib, noFilter()).map((x) => x.name)).toEqual([
      'Abductor',
      'Bench press',
      'Plank',
      'Squat',
    ]);
  });
  it('searches the name and the muscles, ignoring case', () => {
    expect(filterLibrary(lib, { ...noFilter(), query: ' PRESS ' }).map((x) => x.id)).toEqual(['bp']);
    expect(filterLibrary(lib, { ...noFilter(), query: 'glutes' }).map((x) => x.id)).toEqual(['ab', 'sq']);
  });
  it('filters by muscle and by machine, or by not linked to any', () => {
    expect(filterLibrary(lib, { ...noFilter(), muscle: 'glutes' }).map((x) => x.id)).toEqual(['ab', 'sq']);
    expect(filterLibrary(lib, { ...noFilter(), equipment: 'smith' }).map((x) => x.id)).toEqual(['bp']);
    expect(filterLibrary(lib, { ...noFilter(), equipment: 'none' }).map((x) => x.id)).toEqual(['pl']);
    expect(
      filterLibrary(lib, { query: 'squat', muscle: 'legs', equipment: 'rack' }).map((x) => x.id),
    ).toEqual(['sq']);
    expect(filterLibrary(lib, { query: 'squat', muscle: 'chest', equipment: 'all' })).toEqual([]);
  });
});

describe('linking to machines', () => {
  it('works out what to add and what to take away', () => {
    expect(linkChanges(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(linkChanges([], [])).toEqual({ add: [], remove: [] });
  });
});

describe('adding many exercises at once', () => {
  const machines = [
    { id: 'm1', name: 'Leg press' },
    { id: 'm2', name: 'Smith machine' },
  ];
  it('reads every field of a line', () => {
    const p = planBulkImport(
      'Hack squat | legs, glutes | Leg press | I | 4 | 8-10 | 90 | Heels down',
      [],
      machines,
    );
    expect(p.adds).toEqual([
      {
        input: {
          name: 'Hack squat',
          level: 'I',
          sets: 4,
          reps: '8-10',
          rest: 90,
          cue: 'Heels down',
          link: '',
          muscles: ['legs', 'glutes'],
        },
        equipmentIds: ['m1'],
      },
    ]);
    expect(p.message).toBe('Added 1, updated 0.');
  });
  it('uses sensible defaults, drops unknown muscles, and matches a machine by name or id in any case', () => {
    const p = planBulkImport('Lunge | legs, wings | SMITH MACHINE, m1', [], machines);
    expect(p.adds[0]).toMatchObject({
      equipmentIds: ['m2', 'm1'],
      input: { level: 'B', sets: 3, reps: '10', rest: 60, muscles: ['legs'] },
    });
  });
  it('reports machines it could not find, and skips blank names', () => {
    const p = planBulkImport('Lunge | legs | Mystery rig\n | legs |\n\n', [], machines);
    expect(p.missing).toEqual(['Mystery rig']);
    expect(p.skipped).toBe(1);
    expect(p.message).toBe('Added 1, updated 0, skipped 1. Equipment not found: Mystery rig.');
  });
  it('an exercise that exists is extended, not copied: machines and muscles are added, a cue only if there was none', () => {
    const library = [ex({ id: 'sq', name: 'Squat', muscles: ['legs'], equipmentIds: ['m1'], cue: 'Brace' })];
    const p = planBulkImport(
      'squat | legs, glutes | Leg press, Smith machine | B | 3 | 10 | 60 | New cue',
      library,
      machines,
    );
    expect(p.adds).toEqual([]);
    expect(p.merges).toEqual([{ id: 'sq', addEquipment: ['m2'], addMuscles: ['glutes'], cue: '' }]);
    const bare = planBulkImport('Squat | | | | | | | A cue', [ex({ id: 'sq', name: 'Squat' })], machines);
    expect(bare.merges[0]!.cue).toBe('A cue');
  });
  it('the same new exercise twice in one paste becomes one', () => {
    const p = planBulkImport('Lunge | legs | Leg press\nlunge | glutes | Smith machine', [], machines);
    expect(p.adds).toHaveLength(1);
    expect(p.adds[0]!.equipmentIds).toEqual(['m1', 'm2']);
    expect(p.adds[0]!.input.muscles).toEqual(['legs', 'glutes']);
  });
  it('clamps silly numbers', () => {
    const p = planBulkImport('A | | | | 500 | | 99999', [], machines);
    expect(p.adds[0]!.input).toMatchObject({ sets: 3, rest: 3600 });
  });
});
