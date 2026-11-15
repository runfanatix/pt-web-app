/**
 * E2E support: signs a fake trainer in and serves the real Bedfordview export from a mocked Supabase API,
 * so the signed-in planner can be tested without a Supabase project or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { exerciseRowsFromPlan, floorRowsFromPlan, planPrototypeImport } from '../packages/core/src/index.ts';

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

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp })}.sig`;
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: 365 * 24 * 3600,
    expires_at: exp,
    refresh_token: 'refresh',
    user: {
      id: 'u1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'pt@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
}
const empty = (route: Route, status = 204) => route.fulfill({ status, headers: cors });

export interface StoredTemplate {
  id: string;
  name: string;
  notes: string;
  gym_id: string;
  template_items: Record<string, unknown>[];
}

/** Signs in and serves the Bedfordview data. Templates live in memory for the page's lifetime. */
export async function signInWithBedfordview(page: Page): Promise<{ templates: StoredTemplate[] }> {
  const templates: StoredTemplate[] = [];
  // supabase-js stores the session under sb-<first label of the host>-auth-token.
  await page.addInitScript(
    (s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)),
    fakeSession(),
  );

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return empty(route);
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith('/rest/v1/gyms'))
      return json(route, [{ ...plan.gym, updated_at: '2026-11-15T00:00:00Z' }]);
    if (path.endsWith('/rest/v1/floors')) return json(route, floorRowsFromPlan(plan));
    if (path.endsWith('/rest/v1/exercises')) return json(route, exerciseRowsFromPlan(plan));
    if (path.endsWith('/rest/v1/trainers')) return json(route, { id: 'trainer-1' });

    if (path.endsWith('/rest/v1/templates')) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, string>;
        const t: StoredTemplate = {
          id: `t${templates.length + 1}`,
          name: body.name!,
          notes: body.notes ?? '',
          gym_id: body.gym_id!,
          template_items: [],
        };
        templates.push(t);
        return json(route, { id: t.id });
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
        const i = templates.findIndex((t) => t.id === id);
        if (i >= 0) templates.splice(i, 1);
        return empty(route);
      }
      if (method === 'PATCH') return empty(route);
      const wantsItems = (url.searchParams.get('select') ?? '').includes('template_items');
      return json(route, wantsItems ? templates : templates.map(({ id, name }) => ({ id, name })));
    }

    if (path.endsWith('/rest/v1/template_items')) {
      if (method === 'POST') {
        const rows = req.postDataJSON() as Record<string, unknown>[];
        const t = templates.find((x) => x.id === rows[0]?.template_id);
        if (t) t.template_items.push(...rows);
        return empty(route, 201);
      }
      return empty(route);
    }
    return json(route, {});
  });
  return { templates };
}
