/**
 * E2E support: signs a fake trainer in and serves the real Bedfordview export from a mocked Supabase API,
 * so the signed-in planner can be tested without a Supabase project or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { floorRowsFromPlan, planPrototypeImport } from '../packages/core/src/index.ts';

export const SUPABASE_URL = 'http://127.0.0.1:54321';

const exportJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'exports', 'bedfordview-v11.json'), 'utf8'),
);
const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });

export const bedfordview = {
  zonesOnFloor: (i: number) => plan.zones.filter((z) => z.floor_id === plan.floors[i]!.id).length,
  machinesOnFloor: (i: number) =>
    plan.equipment.filter((e) => plan.zones.find((z) => z.id === e.zone_id)?.floor_id === plan.floors[i]!.id)
      .length,
  floorNames: plan.floors.map((f) => f.name),
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
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
}

export async function signInWithBedfordview(page: Page): Promise<void> {
  // supabase-js stores the session under sb-<first label of the host>-auth-token.
  await page.addInitScript(
    (s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)),
    fakeSession(),
  );
  await page.route(`${SUPABASE_URL}/**`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    if (url.pathname.endsWith('/rest/v1/gyms')) {
      return json(route, [{ ...plan.gym, updated_at: '2026-11-15T00:00:00Z' }]);
    }
    if (url.pathname.endsWith('/rest/v1/floors')) return json(route, floorRowsFromPlan(plan));
    return json(route, {});
  });
}
