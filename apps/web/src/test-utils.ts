/** Test support: the real Bedfordview export, shaped like the rows the app reads from the database. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { floorRowsFromPlan, layoutFromFloorRows, planPrototypeImport } from '@pt/core';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);

export function bedfordviewFloorRows() {
  return floorRowsFromPlan(planPrototypeImport(exportJson, { trainerId: 'trainer-1' }).plan);
}

export function bedfordviewLayout() {
  return layoutFromFloorRows(bedfordviewFloorRows());
}
