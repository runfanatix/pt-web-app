/**
 * E2E support: signs a fake trainer in and serves the real Bedfordview export from a mocked Supabase API,
 * so the signed-in planner can be tested without a Supabase project or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { planPrototypeImport } from '../packages/core/src/index.ts';
import {
  createMockDb as createDb,
  fakeSession,
  handle,
  type MockDb,
  type StoredClient,
  type StoredLink,
  type StoredRun,
  type StoredTemplate,
} from '../apps/web/src/demo/mockApi.ts';

export type { MockDb, StoredClient, StoredLink, StoredRun, StoredTemplate };

export const SUPABASE_URL = 'http://127.0.0.1:54321';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);
const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });
const groundFloorId = plan.floors[0]!.id;
const floorOfZone = (zoneId: string) => plan.zones.find((z) => z.id === zoneId)?.floor_id;

export const bedfordview = {
  zonesOnFloor: (i: number) => plan.zones.filter((z) => z.floor_id === plan.floors[i]!.id).length,
  machinesOnFloor: (i: number) =>
    plan.equipment.filter((e) => floorOfZone(e.zone_id) === plan.floors[i]!.id).length,
  floorNames: plan.floors.map((f) => f.name),
  /** Ground-floor machines that have linked exercises, in plan order. */
  machinesWithExercises: plan.equipment.filter(
    (e) => plan.links.some((l) => l.equipmentId === e.id) && floorOfZone(e.zone_id) === groundFloorId,
  ),
};

/** A ground-floor machine whose first exercise has several sets and a rest, so the rest countdown applies. */
const linkedExercises = (eid: string) =>
  plan.links
    .filter((l) => l.equipmentId === eid)
    .map((l) => plan.exercises.find((x) => x.legacyId === l.exerciseLegacyId)!)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
const multiSetMachine = bedfordview.machinesWithExercises.find((m) => {
  const x = linkedExercises(m.id)[0]!;
  return x.sets >= 3 && x.rest >= 20;
})!;
export const restMachine = { id: multiSetMachine.id, exercise: linkedExercises(multiSetMachine.id)[0]! };

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

export const createMockDb = (): MockDb => createDb(plan);

/** Signs a trainer in and serves the Bedfordview data. Data lives in memory for the page's lifetime. */
export async function signInWithBedfordview(page: Page, db: MockDb = createMockDb()): Promise<MockDb> {
  // supabase-js stores the session under sb-<first label of the host>-auth-token.
  await page.addInitScript(
    (s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)),
    fakeSession(),
  );
  await serveApi(page, db);
  return db;
}

/** Serves the mocked Supabase API to a page. Use on its own for a visitor who is not logged in. */
export async function serveApi(page: Page, db: MockDb): Promise<void> {
  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const reply = handle(
      db,
      plan,
      method,
      new URL(req.url()),
      req.postData() ? req.postDataJSON() : undefined,
    );
    return route.fulfill({
      status: reply.status,
      headers: cors,
      ...(reply.body === undefined
        ? {}
        : { contentType: 'application/json', body: JSON.stringify(reply.body) }),
    });
  });
}
