import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planBuiltInLibrary, planPrototypeImport, runImport } from '@pt/core';
import { REPO_ROOT, asUser, createTestDb, createUser, pgliteSink } from './harness.ts';

const exportJson: unknown = JSON.parse(
  readFileSync(join(REPO_ROOT, 'exports', 'bedfordview-v11.json'), 'utf8'),
);

describe('built-in exercise library seed', () => {
  it('loads 111 built-in exercises that every trainer can read, and importing a gym then links to them', async () => {
    const db = await createTestDb();
    const pt = await createUser(db, 'pt@example.com');
    const other = await createUser(db, 'other@example.com');

    const { rows } = planBuiltInLibrary(exportJson);
    for (const r of rows) {
      await db.query(
        'insert into exercises (trainer_id, name, muscles, level, sets, reps, rest, cue) values (null,$1,$2,$3,$4,$5,$6,$7)',
        [r.name, r.muscles, r.level, r.sets, r.reps, r.rest, r.cue],
      );
    }
    expect(await asUser(db, other.userId, (q) => q('select * from exercises'))).toHaveLength(111);

    const { plan } = planPrototypeImport(exportJson, { trainerId: pt.trainerId });
    const summary = await runImport(plan, pgliteSink(db));
    expect(summary.exercisesCreated).toBe(0);
    expect(summary.exercisesMatched).toBe(111);
    expect(summary.links).toBe(139);

    // The imported equipment is linked to built-in exercises, and still invisible to the other trainer.
    const linked = await asUser(db, pt.userId, (q) =>
      q<{ n: number }>('select count(*)::int as n from exercise_equipment'),
    );
    expect(linked[0]!.n).toBe(139);
    expect(await asUser(db, other.userId, (q) => q('select * from exercise_equipment'))).toHaveLength(0);
  });
});
