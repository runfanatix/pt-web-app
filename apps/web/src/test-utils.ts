/** Test support: the real Bedfordview export, shaped like the rows the app reads from the database. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exerciseRowsFromPlan, floorRowsFromPlan, gymDataFromRows, planPrototypeImport } from '@pt/core';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);
const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });

export function bedfordviewFloorRows() {
  return floorRowsFromPlan(plan);
}

export function bedfordviewExerciseRows() {
  return exerciseRowsFromPlan(plan);
}

/** Layout plus the exercise library, as the app builds them. */
export function bedfordviewData() {
  return gymDataFromRows(bedfordviewFloorRows(), bedfordviewExerciseRows());
}

export function bedfordviewLayout() {
  return bedfordviewData().layout;
}
