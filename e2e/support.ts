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

export interface StoredClient extends Record<string, unknown> {
  id: string;
  consents: Record<string, unknown>[];
  programmes: { id: string; programme_items: Record<string, unknown>[] }[] & Record<string, unknown>[];
}

export interface StoredRun extends Record<string, unknown> {
  id: string;
  run_steps: Record<string, unknown>[];
}

export interface StoredLink {
  token: string;
  programme_id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Everything the mocked API remembers. Share one between pages to see the same data in two browser windows. */
export interface MockDb {
  templates: StoredTemplate[];
  runs: StoredRun[];
  clients: StoredClient[];
  profile: Record<string, unknown>;
  dataRequests: Record<string, unknown>[];
  shareLinks: StoredLink[];
  /** Every layout the app sent to save_gym_layout. */
  layoutSaves: { p_gym_id: string; p_layout: Record<string, unknown[]> }[];
}

export function createMockDb(): MockDb {
  return {
    templates: [],
    runs: [],
    clients: [],
    dataRequests: [],
    shareLinks: [],
    layoutSaves: [],
    profile: {
      business_name: '',
      address: '',
      contact_email: '',
      contact_phone: '',
      information_officer_name: '',
      information_officer_email: '',
      payment_provider: '',
      messaging_provider: '',
      studio_name: '',
    },
  };
}

/** Signs a trainer in and serves the Bedfordview data. Data lives in memory for the page's lifetime. */
export async function signInWithBedfordview(page: Page): Promise<MockDb> {
  const db = createMockDb();
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
  const { templates, runs, clients, profile, dataRequests, shareLinks } = db;

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
    if (path.endsWith('/rest/v1/trainers')) {
      if (method === 'PATCH') {
        Object.assign(profile, req.postDataJSON() as Record<string, unknown>);
        return empty(route);
      }
      const wantsProfile = (url.searchParams.get('select') ?? '').includes('business_name');
      return json(route, wantsProfile ? profile : { id: 'trainer-1' });
    }

    if (path.endsWith('/rest/v1/clients')) {
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        const row = {
          ...body,
          id: `c${clients.length + 1}`,
          created_at: new Date().toISOString(),
          consents: [],
          programmes: [],
        } as StoredClient;
        clients.push(row);
        return json(route, { id: row.id });
      }
      if (method === 'PATCH') {
        const c = clients.find((x) => x.id === id);
        if (c) Object.assign(c, req.postDataJSON() as Record<string, unknown>);
        return empty(route);
      }
      if (method === 'DELETE') {
        const i = clients.findIndex((x) => x.id === id);
        if (i >= 0) clients.splice(i, 1);
        return empty(route);
      }
      return json(route, clients);
    }

    if (path.endsWith('/rest/v1/consents')) {
      if (method === 'POST') {
        const rows = req.postDataJSON() as Record<string, unknown>[];
        for (const r of rows) {
          clients
            .find((c) => c.id === r.client_id)
            ?.consents.push({ ...r, granted_at: new Date().toISOString() });
        }
        return empty(route, 201);
      }
      return json(
        route,
        clients.flatMap((c) => c.consents),
      );
    }

    if (path.endsWith('/rest/v1/data_requests')) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        dataRequests.push({
          id: `d${dataRequests.length + 1}`,
          received_at: new Date().toISOString(),
          completed_at: null,
          outcome: '',
          ...body,
        });
        return empty(route, 201);
      }
      return json(route, dataRequests);
    }

    if (path.endsWith('/rest/v1/programmes')) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        const p = {
          id: `p${Math.random()}`,
          assigned_at: new Date().toISOString(),
          programme_items: [] as Record<string, unknown>[],
          ...body,
        };
        clients.find((c) => c.id === body.client_id)?.programmes.push(p);
        return json(route, { id: p.id });
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
        for (const c of clients) c.programmes = c.programmes.filter((p) => p.id !== id);
        return empty(route);
      }
    }

    if (path.endsWith('/rest/v1/programme_items') && method === 'POST') {
      const rows = req.postDataJSON() as Record<string, unknown>[];
      for (const c of clients)
        c.programmes.find((p) => p.id === rows[0]?.programme_id)?.programme_items.push(...rows);
      return empty(route, 201);
    }

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
    if (path.endsWith('/rest/v1/runs')) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        const i = runs.findIndex((r) => r.id === body.id);
        const row = {
          ...body,
          id: String(body.id),
          run_steps: i >= 0 ? runs[i]!.run_steps : [],
        } as StoredRun;
        if (i >= 0) runs[i] = row;
        else runs.push(row);
        return empty(route, 201);
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
        const i = runs.findIndex((r) => r.id === id);
        if (i >= 0) runs.splice(i, 1);
        return empty(route);
      }
      return json(route, runs);
    }

    if (path.endsWith('/rest/v1/run_steps')) {
      if (method === 'POST') {
        const rows = req.postDataJSON() as Record<string, unknown>[];
        const r = runs.find((x) => x.id === rows[0]?.run_id);
        if (r) r.run_steps.push(...rows);
        return empty(route, 201);
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('run_id') ?? '').replace('eq.', '');
        const r = runs.find((x) => x.id === id);
        if (r) r.run_steps = [];
        return empty(route);
      }
    }
    if (path.endsWith('/rest/v1/share_links')) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        const link: StoredLink = {
          token: String(shareLinks.length + 1).padStart(64, 'a'),
          programme_id: String(body.programme_id),
          created_at: new Date().toISOString(),
          expires_at: (body.expires_at as string | null) ?? null,
          revoked_at: null,
        };
        shareLinks.push(link);
        return json(route, link);
      }
      if (method === 'PATCH') {
        const token = (url.searchParams.get('token') ?? '').replace('eq.', '');
        const link = shareLinks.find((l) => l.token === token);
        if (link) Object.assign(link, req.postDataJSON() as Record<string, unknown>);
        return empty(route);
      }
      const pid = (url.searchParams.get('programme_id') ?? '').replace('eq.', '');
      return json(
        route,
        shareLinks.filter((l) => l.programme_id === pid),
      );
    }

    if (path.endsWith('/rest/v1/rpc/save_gym_layout')) {
      db.layoutSaves.push(req.postDataJSON() as MockDb['layoutSaves'][number]);
      return json(route, null);
    }

    // The one thing a visitor who is not logged in may call: what a client's link shows.
    if (path.endsWith('/rest/v1/rpc/get_shared_programme')) {
      const { p_token } = req.postDataJSON() as { p_token: string };
      const link = shareLinks.find((l) => l.token === p_token);
      const live = link && !link.revoked_at && (!link.expires_at || Date.parse(link.expires_at) > Date.now());
      if (!live) return json(route, null);
      const client = clients.find((c) => c.programmes.some((p) => p.id === link.programme_id));
      const programme = client?.programmes.find((p) => p.id === link.programme_id) as
        Record<string, unknown> | undefined;
      if (!client || !programme) return json(route, null);
      const items = (programme.programme_items as Record<string, unknown>[]).map((i) => ({
        position: i.position,
        equipment_id: i.equipment_id,
        exercise_name: i.exercise_name,
        sets: i.sets,
        reps: i.reps,
        rest: i.rest,
        note: i.note,
        cue: '',
      }));
      // Only the programme and the plan: nothing from the client's own record.
      return json(route, {
        title: programme.title,
        notes: programme.notes,
        assigned_at: programme.assigned_at,
        trainer: profile.business_name,
        gym: { name: plan.gym.name, branch: plan.gym.branch, address: plan.gym.address },
        items,
        floors: floorRowsFromPlan(plan),
      });
    }
    return json(route, {});
  });
}
