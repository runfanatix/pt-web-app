import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planBuiltInLibrary } from './seed-library.ts';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);

describe('planBuiltInLibrary', () => {
  it('turns the Bedfordview export into 111 built-in exercises with no trainer', () => {
    const { rows, warnings } = planBuiltInLibrary(exportJson);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(111);
    expect(rows.every((r) => r.trainer_id === null)).toBe(true);
  });

  it('skips duplicates by name and invalid rows, with a warning each', () => {
    const ex = {
      id: 'a',
      name: 'Squat',
      muscles: ['legs'],
      level: 'B',
      sets: 3,
      reps: '10',
      rest: 60,
      cue: '',
    };
    const { rows, warnings } = planBuiltInLibrary({
      exercises: [
        ex,
        { ...ex, id: 'b', name: 'squat' },
        { ...ex, id: 'c', name: 'Bad', muscles: ['biceps'] },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(['Squat']);
    expect(warnings).toHaveLength(2);
  });

  it('handles a file without an exercises list', () => {
    expect(planBuiltInLibrary({}).rows).toEqual([]);
    expect(planBuiltInLibrary(null).warnings).toHaveLength(1);
  });
});
