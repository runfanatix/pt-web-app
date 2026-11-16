/**
 * A stand-in for the Supabase API that runs with no server and no network: the same routes the app calls, answered
 * from an in-memory (or stored) copy of a gym's data. Two users:
 *
 *  - the Playwright tests (e2e/support.ts) answer browser requests with it;
 *  - the offline demo (demo.ts) answers the app's own fetch calls with it, so the whole app can be shown from one
 *    HTML file on a laptop with no internet.
 *
 * It is deliberately forgiving (no row-level security, no validation beyond what the app sends). It is NOT the
 * database: the real rules are tested against real SQL in packages/db.
 */
import { exerciseRowsFromPlan, floorRowsFromPlan, type ImportPlan } from '@pt/core';

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
  programme_id?: string;
  created_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
}

interface EqRow {
  id: string;
  exercise_equipment: { exercise_id: string }[];
  [k: string]: unknown;
}
interface ZoneRow {
  id: string;
  equipment: EqRow[];
  [k: string]: unknown;
}
export interface FloorRow {
  id: string;
  position: number;
  zones: ZoneRow[];
  structs: unknown[];
  [k: string]: unknown;
}

/** What the layout editor sends to the database function `save_gym_layout`. */
interface LayoutPayload {
  floors: { id: string; name: string; w: number; h: number; position: number }[];
  zones: (Record<string, unknown> & { id: string; floor_id: string; parts?: Record<string, unknown>[] })[];
  structs: (Record<string, unknown> & { floor_id: string })[];
  equipment: (Record<string, unknown> & { id: string; zone_id: string })[];
}

/** Everything the mocked API remembers. Share one between pages to see the same data in two browser windows. */
export interface MockDb {
  templates: StoredTemplate[];
  runs: StoredRun[];
  clients: StoredClient[];
  profile: Record<string, unknown>;
  dataRequests: Record<string, unknown>[];
  shareLinks: StoredLink[];
  /** Manufacturers with their models, shaped like the rows the app reads. */
  catalogue: {
    id: string;
    trainer_id: string | null;
    name: string;
    catalogue_items: Record<string, unknown>[];
  }[];
  /** The trainer's gyms (the first is the imported one). */
  gyms: Record<string, unknown>[];
  /** Each gym's floors with their zones, machines (and exercise links) and structures, as the app reads them. */
  floors: Record<string, FloorRow[]>;
  /** Every layout the app sent to save_gym_layout. */
  layoutSaves: { p_gym_id: string; p_layout: Record<string, unknown[]> }[];
}

export function createMockDb(plan: ImportPlan): MockDb {
  return {
    templates: [],
    runs: [],
    clients: [],
    dataRequests: [],
    shareLinks: [],
    layoutSaves: [],
    catalogue: [],
    gyms: [{ ...plan.gym, updated_at: '2026-11-15T00:00:00Z' }],
    floors: { [plan.gym.id]: structuredClone(floorRowsFromPlan(plan)) as unknown as FloorRow[] },
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

export interface Reply {
  status: number;
  body?: unknown;
}
const json = (body: unknown): Reply => ({ status: 200, body });
const empty = (status = 204): Reply => ({ status });

const eqParam = (url: URL, name: string) => (url.searchParams.get(name) ?? '').replace('eq.', '');
/** PostgREST `in.(a,b,c)` */
const inParam = (url: URL, name: string): string[] | null => {
  const v = url.searchParams.get(name);
  if (!v?.startsWith('in.(')) return null;
  return v
    .slice(4, -1)
    .split(',')
    .map((x) => x.replace(/^"|"$/g, ''))
    .filter(Boolean);
};

const allMachines = (db: MockDb): EqRow[] =>
  Object.values(db.floors).flatMap((fl) => fl.flatMap((f) => f.zones.flatMap((z) => z.equipment)));

/** Rebuilds a gym's rows from a saved layout, keeping the exercise links of the machines that remain. */
function rowsFromLayout(p: LayoutPayload, previous: FloorRow[]): FloorRow[] {
  const links = new Map<string, { exercise_id: string }[]>();
  for (const f of previous)
    for (const z of f.zones) for (const e of z.equipment) links.set(e.id, e.exercise_equipment);
  return [...p.floors]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      id: f.id,
      name: f.name,
      w: f.w,
      h: f.h,
      position: f.position,
      zones: p.zones
        .filter((z) => z.floor_id === f.id)
        .map((z) => ({
          id: z.id,
          name: z.name,
          category: z.category,
          x: z.x,
          y: z.y,
          w: z.w,
          h: z.h,
          zone_parts: z.parts ?? [],
          equipment: p.equipment
            .filter((e) => e.zone_id === z.id)
            .map((e) => ({
              id: e.id,
              name: e.name,
              type: e.type,
              x: e.x,
              y: e.y,
              muscles: e.muscles,
              notes: e.notes,
              catalogue_item_id: e.catalogue_item_id ?? null,
              exercise_equipment: links.get(e.id) ?? [],
            })),
        })),
      structs: p.structs
        .filter((s) => s.floor_id === f.id)
        .map((s) => ({
          id: s.id,
          type: s.type,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          x2: s.x2,
          y2: s.y2,
          rotation: s.rotation,
          label: s.label,
          shared: s.shared,
        })),
    }));
}

/** Answers one request. `body` is the parsed JSON body (or undefined). The path is whatever follows the host. */
export function handle(db: MockDb, plan: ImportPlan, method: string, url: URL, body: unknown): Reply {
  const { templates, runs, clients, profile, dataRequests, shareLinks } = db;
  const path = url.pathname;
  const sel = url.searchParams.get('select') ?? '';

  if (path.endsWith('/rest/v1/gyms')) {
    const gid = eqParam(url, 'id');
    if (method === 'POST') {
      const row = { ...(body as Record<string, unknown>), id: `gym-${db.gyms.length + 1}` };
      db.gyms.push({ updated_at: new Date().toISOString(), ...row });
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      Object.assign(db.gyms.find((g) => g.id === gid) ?? {}, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      const i = db.gyms.findIndex((g) => g.id === gid);
      if (i >= 0) db.gyms.splice(i, 1);
      delete db.floors[gid];
      for (let k = templates.length - 1; k >= 0; k--)
        if (templates[k]!.gym_id === gid) templates.splice(k, 1);
      return empty();
    }
    // The Gyms tab counts floors, zones and machines with a nested select.
    if (sel.includes('floors(')) {
      return json(
        db.gyms.map((g) => ({
          id: g.id,
          floors: (db.floors[String(g.id)] ?? []).map((f) => ({
            id: f.id,
            zones: f.zones.map((z) => ({ id: z.id, equipment: z.equipment })),
          })),
        })),
      );
    }
    return json(db.gyms);
  }

  if (path.endsWith('/rest/v1/manufacturers')) {
    const mid = eqParam(url, 'id');
    if (method === 'POST') {
      const b = body as { name: string; trainer_id: string };
      const row = {
        id: `mk-${db.catalogue.length + 1}`,
        trainer_id: b.trainer_id,
        name: b.name,
        catalogue_items: [],
      };
      db.catalogue.push(row);
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      Object.assign(db.catalogue.find((m) => m.id === mid) ?? {}, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      const i = db.catalogue.findIndex((m) => m.id === mid);
      if (i >= 0) db.catalogue.splice(i, 1);
      return empty();
    }
    return json(db.catalogue);
  }

  if (path.endsWith('/rest/v1/catalogue_items')) {
    const iid = eqParam(url, 'id');
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const maker = db.catalogue.find((m) => m.id === b.manufacturer_id);
      const row = { ...b, id: `it-${db.catalogue.flatMap((m) => m.catalogue_items).length + 1}` };
      maker?.catalogue_items.push(row);
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      for (const m of db.catalogue)
        Object.assign(m.catalogue_items.find((i) => i.id === iid) ?? {}, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      for (const m of db.catalogue) m.catalogue_items = m.catalogue_items.filter((i) => i.id !== iid);
      return empty();
    }
    return json([]);
  }

  if (path.endsWith('/rest/v1/equipment')) {
    const ids = inParam(url, 'id');
    const machines = allMachines(db);
    if (ids)
      return json(
        machines.filter((e) => ids.includes(e.id)).map((e) => ({ id: e.id, name: e.name, type: e.type })),
      );
    if (sel.includes('catalogue_item_id'))
      return json(
        machines.filter((e) => e.catalogue_item_id).map((e) => ({ catalogue_item_id: e.catalogue_item_id })),
      );
    return json([]);
  }

  if (path.endsWith('/rest/v1/exercise_equipment')) {
    if (method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]) as { exercise_id: string; equipment_id: string }[];
      const machines = allMachines(db);
      for (const r of rows) {
        const e = machines.find((m) => m.id === r.equipment_id);
        if (e && !e.exercise_equipment.some((l) => l.exercise_id === r.exercise_id))
          e.exercise_equipment.push({ exercise_id: r.exercise_id });
      }
      return empty(201);
    }
    if (method === 'DELETE') {
      const xid = eqParam(url, 'exercise_id');
      const eid = eqParam(url, 'equipment_id');
      const e = allMachines(db).find((m) => m.id === eid);
      if (e) e.exercise_equipment = e.exercise_equipment.filter((l) => l.exercise_id !== xid);
      return empty();
    }
    const ids = inParam(url, 'equipment_id');
    return json(
      allMachines(db)
        .filter((e) => !ids || ids.includes(e.id))
        .flatMap((e) =>
          e.exercise_equipment.map((l) => ({ exercise_id: l.exercise_id, equipment_id: e.id })),
        ),
    );
  }

  if (path.endsWith('/rest/v1/floors')) {
    const gid = eqParam(url, 'gym_id');
    return json(db.floors[gid || plan.gym.id] ?? []);
  }
  if (path.endsWith('/rest/v1/exercises')) return json(exerciseRowsFromPlan(plan));

  if (path.endsWith('/rest/v1/trainers')) {
    if (method === 'PATCH') {
      Object.assign(profile, body as Record<string, unknown>);
      return empty();
    }
    return json(sel.includes('business_name') ? profile : { id: 'trainer-1' });
  }

  if (path.endsWith('/rest/v1/clients')) {
    const id = eqParam(url, 'id');
    if (method === 'POST') {
      const row = {
        ...(body as Record<string, unknown>),
        id: `c${clients.length + 1}`,
        created_at: new Date().toISOString(),
        consents: [],
        programmes: [],
      } as StoredClient;
      clients.push(row);
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      const c = clients.find((x) => x.id === id);
      if (c) Object.assign(c, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      const i = clients.findIndex((x) => x.id === id);
      if (i >= 0) clients.splice(i, 1);
      return empty();
    }
    return json(clients);
  }

  if (path.endsWith('/rest/v1/consents')) {
    if (method === 'POST') {
      for (const r of body as Record<string, unknown>[])
        clients
          .find((c) => c.id === r.client_id)
          ?.consents.push({ ...r, granted_at: new Date().toISOString() });
      return empty(201);
    }
    return json(clients.flatMap((c) => c.consents));
  }

  if (path.endsWith('/rest/v1/data_requests')) {
    if (method === 'POST') {
      dataRequests.push({
        id: `d${dataRequests.length + 1}`,
        received_at: new Date().toISOString(),
        completed_at: null,
        outcome: '',
        ...(body as Record<string, unknown>),
      });
      return empty(201);
    }
    return json(dataRequests);
  }

  if (path.endsWith('/rest/v1/programmes')) {
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const p = {
        id: `p${Math.random().toString(36).slice(2)}`,
        assigned_at: new Date().toISOString(),
        programme_items: [] as Record<string, unknown>[],
        ...b,
      };
      clients.find((c) => c.id === b.client_id)?.programmes.push(p);
      return json({ id: p.id });
    }
    if (method === 'DELETE') {
      const id = eqParam(url, 'id');
      for (const c of clients) c.programmes = c.programmes.filter((p) => p.id !== id);
      return empty();
    }
  }

  if (path.endsWith('/rest/v1/programme_items') && method === 'POST') {
    const rows = body as Record<string, unknown>[];
    for (const c of clients)
      c.programmes.find((p) => p.id === rows[0]?.programme_id)?.programme_items.push(...rows);
    return empty(201);
  }

  if (path.endsWith('/rest/v1/templates')) {
    if (method === 'POST') {
      const b = body as Record<string, string>;
      const t: StoredTemplate = {
        id: `t${templates.length + 1}`,
        name: b.name!,
        notes: b.notes ?? '',
        gym_id: b.gym_id!,
        template_items: [],
      };
      templates.push(t);
      return json({ id: t.id });
    }
    if (method === 'DELETE') {
      const i = templates.findIndex((t) => t.id === eqParam(url, 'id'));
      if (i >= 0) templates.splice(i, 1);
      return empty();
    }
    if (method === 'PATCH') return empty();
    return json(sel.includes('template_items') ? templates : templates.map(({ id, name }) => ({ id, name })));
  }

  if (path.endsWith('/rest/v1/template_items')) {
    if (method === 'POST') {
      const rows = body as Record<string, unknown>[];
      const t = templates.find((x) => x.id === rows[0]?.template_id);
      if (t) t.template_items.push(...rows);
      return empty(201);
    }
    return empty();
  }

  if (path.endsWith('/rest/v1/runs')) {
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const i = runs.findIndex((r) => r.id === b.id);
      const row = { ...b, id: String(b.id), run_steps: i >= 0 ? runs[i]!.run_steps : [] } as StoredRun;
      if (i >= 0) runs[i] = row;
      else runs.push(row);
      return empty(201);
    }
    if (method === 'DELETE') {
      const i = runs.findIndex((r) => r.id === eqParam(url, 'id'));
      if (i >= 0) runs.splice(i, 1);
      return empty();
    }
    return json(runs);
  }

  if (path.endsWith('/rest/v1/run_steps')) {
    if (method === 'POST') {
      const rows = body as Record<string, unknown>[];
      const r = runs.find((x) => x.id === rows[0]?.run_id);
      if (r) r.run_steps.push(...rows);
      return empty(201);
    }
    if (method === 'DELETE') {
      const r = runs.find((x) => x.id === eqParam(url, 'run_id'));
      if (r) r.run_steps = [];
      return empty();
    }
  }

  if (path.endsWith('/rest/v1/share_links')) {
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const link: StoredLink = {
        token: String(shareLinks.length + 1).padStart(64, 'a'),
        programme_id: String(b.programme_id),
        created_at: new Date().toISOString(),
        expires_at: (b.expires_at as string | null) ?? null,
        revoked_at: null,
      };
      shareLinks.push(link);
      return json(link);
    }
    if (method === 'PATCH') {
      const link = shareLinks.find((l) => l.token === eqParam(url, 'token'));
      if (link) Object.assign(link, body as Record<string, unknown>);
      return empty();
    }
    const pid = eqParam(url, 'programme_id');
    return json(shareLinks.filter((l) => l.programme_id === pid));
  }

  if (path.endsWith('/rest/v1/rpc/save_gym_layout')) {
    const b = body as { p_gym_id: string; p_layout: LayoutPayload };
    db.layoutSaves.push(b as unknown as MockDb['layoutSaves'][number]);
    db.floors[b.p_gym_id] = rowsFromLayout(b.p_layout, db.floors[b.p_gym_id] ?? []);
    const g = db.gyms.find((x) => x.id === b.p_gym_id);
    if (g) g.updated_at = new Date().toISOString();
    return json(null);
  }

  // The one thing a visitor who is not logged in may call: what a client's link shows.
  if (path.endsWith('/rest/v1/rpc/get_shared_programme')) {
    const { p_token } = body as { p_token: string };
    const link = shareLinks.find((l) => l.token === p_token);
    const live = link && !link.revoked_at && (!link.expires_at || Date.parse(link.expires_at) > Date.now());
    if (!live) return json(null);
    const client = clients.find((c) => c.programmes.some((p) => p.id === link.programme_id));
    const programme = client?.programmes.find((p) => p.id === link.programme_id) as
      Record<string, unknown> | undefined;
    if (!client || !programme) return json(null);
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
    const gymId = String(programme.gym_id ?? plan.gym.id);
    const gym = (db.gyms.find((g) => g.id === gymId) ?? plan.gym) as Record<string, unknown>;
    // Only the programme and the plan: nothing from the client's own record.
    return json({
      title: programme.title,
      notes: programme.notes,
      assigned_at: programme.assigned_at,
      trainer: profile.business_name,
      gym: { name: gym.name, branch: gym.branch, address: gym.address },
      items,
      floors: db.floors[gymId] ?? db.floors[plan.gym.id],
    });
  }

  return json({});
}

const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A signed-in session that never expires, in the shape supabase-js stores. The signature is not checked by the mock. */
export function fakeSession(email = 'pt@example.com') {
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', role: 'authenticated', exp })}.sig`;
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
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}
