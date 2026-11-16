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
import { exerciseRowsFromPlan, floorRowsFromPlan, fromIso, monthLabel, type ImportPlan } from '@pt/core';

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

export interface StoredInvite extends Record<string, unknown> {
  id: string;
  client_id: string;
  email: string;
  accepted_at: string | null;
  revoked_at: string | null;
}
export interface StoredAccount extends Record<string, unknown> {
  id: string;
  client_id: string;
  revoked_at: string | null;
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
  /** The exercise library, as the app reads it. */
  exercises: Record<string, unknown>[];
  /** The trainer's PayFast settings (one row, or none yet). */
  paymentSettings: Record<string, unknown> | null;
  /** Invoices with their lines, as the app reads them. */
  invoices: Record<string, unknown>[];
  /** Booked sessions, as the app reads them. */
  bookings: Record<string, unknown>[];
  /** Portal invitations and the sign-ins they became (the mock treats the one signed-in user as every invited client). */
  invites: StoredInvite[];
  accounts: StoredAccount[];
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
    invites: [],
    accounts: [],
    bookings: [],
    invoices: [],
    paymentSettings: null,
    // the library that comes with the app: shared, so it can be linked to machines but not rewritten
    exercises: exerciseRowsFromPlan(plan).map((x) => ({ ...x, trainer_id: null, link: '' })),
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
      default_rate_cents: null,
      vat_percent: 0,
      invoice_prefix: 'INV',
      bank_details: '',
      payment_link: '',
      invoice_terms: '',
      auto_invoice: false,
      invoice_days_before: 5,
      auto_send: false,
      session_reminders: false,
      reminder_hours: 24,
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
      const eids = inParam(url, 'equipment_id') ?? [eqParam(url, 'equipment_id')];
      for (const e of allMachines(db).filter((m) => eids.includes(m.id)))
        e.exercise_equipment = e.exercise_equipment.filter((l) => l.exercise_id !== xid);
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
  if (path.endsWith('/rest/v1/exercises')) {
    const id = eqParam(url, 'id');
    if (method === 'POST') {
      const row = {
        id: `ex-${db.exercises.length + 1}`,
        trainer_id: 'trainer-1',
        link: '',
        ...(body as Record<string, unknown>),
      };
      db.exercises.push(row);
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      const x = db.exercises.find((e) => e.id === id);
      if (x && x.trainer_id !== null) Object.assign(x, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      const x = db.exercises.find((e) => e.id === id);
      if (x && x.trainer_id !== null) {
        db.exercises = db.exercises.filter((e) => e.id !== id);
        for (const m of allMachines(db))
          m.exercise_equipment = m.exercise_equipment.filter((l) => l.exercise_id !== id);
      }
      return empty();
    }
    return json(db.exercises);
  }

  if (path.endsWith('/rest/v1/trainers')) {
    if (method === 'PATCH') {
      Object.assign(profile, body as Record<string, unknown>);
      return empty();
    }
    return json(
      sel.includes('business_name') || sel.includes('session_reminders') ? profile : { id: 'trainer-1' },
    );
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
    return json(programmeJson(db, plan, String(link.programme_id)));
  }

  if (path.endsWith('/rest/v1/client_invites')) {
    const id = eqParam(url, 'id');
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const row: StoredInvite = {
        id: `inv-${db.invites.length + 1}`,
        client_id: String(b.client_id),
        email: String(b.email),
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        emailed_at: null,
        accepted_at: null,
        revoked_at: null,
      };
      db.invites.push(row);
      return json({ id: row.id });
    }
    if (method === 'PATCH') {
      Object.assign(db.invites.find((i) => i.id === id) ?? {}, body as Record<string, unknown>);
      return empty();
    }
    const cid = eqParam(url, 'client_id');
    return json(db.invites.filter((i) => i.client_id === cid));
  }

  if (path.endsWith('/rest/v1/client_accounts')) {
    if (method === 'PATCH') {
      Object.assign(
        db.accounts.find((a) => a.id === eqParam(url, 'id')) ?? {},
        body as Record<string, unknown>,
      );
      return empty();
    }
    const cid = eqParam(url, 'client_id');
    return json(db.accounts.filter((a) => a.client_id === cid));
  }

  if (path.endsWith('/functions/v1/send-portal-invite')) {
    const inv = db.invites.find((i) => i.id === (body as { inviteId: string }).inviteId);
    if (!inv) return { status: 404, body: { error: 'That invite is not available.' } };
    inv.emailed_at = new Date().toISOString();
    return json({ sent: true });
  }

  // ---- the client portal: the one signed-in person is every client who has an open invite
  if (path.endsWith('/rest/v1/rpc/portal_overview')) {
    for (const inv of db.invites.filter(
      (i) => !i.accepted_at && !i.revoked_at && Date.parse(String(i.expires_at)) > Date.now(),
    )) {
      const existing = db.accounts.find((a) => a.client_id === inv.client_id);
      if (existing) existing.revoked_at = null;
      else
        db.accounts.push({
          id: `acc-${db.accounts.length + 1}`,
          client_id: inv.client_id,
          created_at: new Date().toISOString(),
          revoked_at: null,
        });
      inv.accepted_at = new Date().toISOString();
    }
    return json({
      email: 'demo@ptplanner.example',
      memberships: db.accounts
        .filter((a) => !a.revoked_at)
        .flatMap((a) => {
          const c = clients.find((x) => x.id === a.client_id);
          if (!c) return [];
          const latest = new Map<string, Record<string, unknown>>();
          for (const r of c.consents) latest.set(`${r.purpose}|${r.detail ?? ''}`, r);
          return [
            {
              client_id: c.id,
              client_name: c.name,
              trainer: {
                business_name: profile.business_name,
                display_name: 'Demo trainer',
                address: profile.address,
                contact_email: profile.contact_email,
                contact_phone: profile.contact_phone,
                information_officer_name: profile.information_officer_name,
                information_officer_email: profile.information_officer_email,
              },
              programmes: [...c.programmes]
                .sort((x, y) => String(y.assigned_at).localeCompare(String(x.assigned_at)))
                .map((p) => ({
                  id: p.id,
                  title: p.title,
                  assigned_at: p.assigned_at,
                  gym: (() => {
                    const g = db.gyms.find((q) => q.id === p.gym_id);
                    return g ? [g.name, g.branch].filter(Boolean).join(' ') : null;
                  })(),
                  exercises: p.programme_items.length,
                })),
              consents: [...latest.values()].map((r) => ({
                purpose: r.purpose,
                detail: r.detail ?? '',
                granted: r.granted !== false,
                at: r.granted_at,
                notice_version: r.notice_version ?? '',
              })),
            },
          ];
        }),
    });
  }

  if (path.endsWith('/rest/v1/rpc/portal_programme')) {
    const id = (body as { p_programme_id: string }).p_programme_id;
    const mine = clients.find(
      (c) =>
        c.programmes.some((p) => p.id === id) &&
        db.accounts.some((a) => a.client_id === c.id && !a.revoked_at),
    );
    return json(mine ? programmeJson(db, plan, id) : null);
  }

  if (path.endsWith('/rest/v1/bookings')) {
    const num = (v: string | null, p: string) => (v?.startsWith(p) ? v.slice(p.length) : null);
    if (method === 'POST') {
      for (const r of (Array.isArray(body) ? body : [body]) as Record<string, unknown>[])
        db.bookings.push({
          id: `bk-${db.bookings.length + 1}`,
          status: 'scheduled',
          client_response: 'pending',
          cancelled_by: null,
          series_id: null,
          ...r,
        });
      return empty(201);
    }
    const id = eqParam(url, 'id');
    const series = eqParam(url, 'series_id');
    const from = num(url.searchParams.getAll('starts_at').find((v) => v.startsWith('gte.')) ?? null, 'gte.');
    const to = num(url.searchParams.getAll('starts_at').find((v) => v.startsWith('lt.')) ?? null, 'lt.');
    if (method === 'PATCH') {
      for (const b of db.bookings) {
        const hit = id
          ? b.id === id
          : series
            ? b.series_id === series &&
              (!from || String(b.starts_at) >= from) &&
              (!eqParam(url, 'status') || b.status === eqParam(url, 'status'))
            : false;
        if (hit) Object.assign(b, body as Record<string, unknown>);
      }
      return empty();
    }
    if (method === 'DELETE') {
      db.bookings = db.bookings.filter((b) => b.id !== id);
      return empty();
    }
    return json(
      db.bookings
        .filter(
          (b) =>
            (!from || new Date(String(b.starts_at)).getTime() >= new Date(from).getTime()) &&
            (!to || new Date(String(b.starts_at)).getTime() < new Date(to).getTime()),
        )
        .sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at))),
    );
  }

  type InvLine = {
    id: string;
    position: number;
    description: string;
    quantity: number;
    unit_cents: number;
    amount_cents: number;
  };
  const linesOf = (i: Record<string, unknown>) => i.invoice_lines as InvLine[];
  const recalc = (i: Record<string, unknown>) => {
    for (const l of linesOf(i)) l.amount_cents = Math.round(Number(l.quantity) * l.unit_cents);
    const sub = linesOf(i).reduce((n, l) => n + l.amount_cents, 0);
    const vat = Math.round((sub * Number(i.vat_percent)) / 100);
    Object.assign(i, { subtotal_cents: sub, vat_cents: vat, total_cents: sub + vat });
  };

  if (path.endsWith('/rest/v1/invoices')) {
    const id = eqParam(url, 'id');
    if (method === 'PATCH') {
      const inv = db.invoices.find((i) => i.id === id);
      if (inv) Object.assign(inv, body as Record<string, unknown>);
      return empty();
    }
    if (method === 'DELETE') {
      db.invoices = db.invoices.filter((i) => !(i.id === id && i.status === 'draft'));
      return empty();
    }
    return json(
      [...db.invoices].sort((a, b) => String(b.period_start).localeCompare(String(a.period_start))),
    );
  }

  if (path.endsWith('/rest/v1/invoice_lines')) {
    const id = eqParam(url, 'id');
    const owner = (lineId: string) => db.invoices.find((i) => linesOf(i).some((l) => l.id === lineId));
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const inv = db.invoices.find((i) => i.id === b.invoice_id);
      if (!inv || inv.status !== 'draft')
        return { status: 400, body: { message: 'Only a draft invoice can be changed.' } };
      linesOf(inv).push({
        id: `ln-${Math.random().toString(36).slice(2)}`,
        position: Number(b.position),
        description: String(b.description),
        quantity: Number(b.quantity),
        unit_cents: Number(b.unit_cents),
        amount_cents: 0,
      });
      recalc(inv);
      return empty(201);
    }
    const inv = owner(id);
    if (!inv) return empty();
    if (inv.status !== 'draft')
      return { status: 400, body: { message: 'Only a draft invoice can be changed.' } };
    if (method === 'PATCH')
      Object.assign(
        linesOf(inv).find((l) => l.id === id)!,
        body as Record<string, unknown>,
      );
    if (method === 'DELETE') inv.invoice_lines = linesOf(inv).filter((l) => l.id !== id);
    recalc(inv);
    return empty();
  }

  if (path.endsWith('/rest/v1/rpc/generate_invoices')) {
    const month = `${String((body as { p_month: string }).p_month).slice(0, 7)}-01`;
    const rate0 = profile.default_rate_cents as number | null;
    const out = {
      month,
      generated: 0,
      invoice_ids: [] as string[],
      skipped_no_rate: [] as string[],
      skipped_existing: 0,
      skipped_no_sessions: 0,
    };
    for (const c of [...clients].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const mine = db.bookings.filter(
        (b) =>
          b.client_id === c.id &&
          ['scheduled', 'completed'].includes(String(b.status)) &&
          fromIso(String(b.starts_at)).date.slice(0, 7) === month.slice(0, 7),
      );
      if (!mine.length) {
        out.skipped_no_sessions += 1;
        continue;
      }
      if (db.invoices.some((i) => i.client_id === c.id && i.period_start === month && i.status !== 'void')) {
        out.skipped_existing += 1;
        continue;
      }
      const rate = (c.rate_cents as number | null | undefined) ?? rate0;
      if (rate === null || rate === undefined) {
        out.skipped_no_rate.push(String(c.name));
        continue;
      }
      const prefix = `${profile.invoice_prefix}-${month.slice(0, 7).replace('-', '')}-`;
      const seq = db.invoices.filter((i) => String(i.number).startsWith(prefix)).length + 1;
      const today = new Date().toISOString().slice(0, 10);
      const inv: Record<string, unknown> = {
        id: `inv-${db.invoices.length + 1}`,
        client_id: c.id,
        client_name: c.name,
        client_email: c.email ?? '',
        number: `${prefix}${String(seq).padStart(3, '0')}`,
        period_start: month,
        issued_on: today,
        due_on: today > month ? today : month,
        status: 'draft',
        vat_percent: profile.vat_percent,
        subtotal_cents: 0,
        vat_cents: 0,
        total_cents: 0,
        notes: `Sessions: ${mine.map((b) => `${fromIso(String(b.starts_at)).date} ${fromIso(String(b.starts_at)).time}`).join(', ')}`,
        auto_generated: false,
        email_queued_at: null,
        emailed_at: null,
        paid_at: null,
        paid_method: null,
        invoice_lines: [],
      };
      const kinds = new Map<string, number>();
      for (const b of mine) kinds.set(String(b.title), (kinds.get(String(b.title)) ?? 0) + 1);
      let pos = 0;
      for (const [title, qty] of kinds)
        linesOf(inv).push({
          id: `ln-${Math.random().toString(36).slice(2)}`,
          position: pos++,
          description: `${title}, ${monthLabel(month)}`,
          quantity: qty,
          unit_cents: rate,
          amount_cents: 0,
        });
      recalc(inv);
      db.invoices.push(inv);
      out.generated += 1;
      out.invoice_ids.push(String(inv.id));
    }
    return json(out);
  }

  if (path.endsWith('/rest/v1/payment_settings')) {
    if (method === 'POST') {
      db.paymentSettings = { ...(db.paymentSettings ?? {}), ...(body as Record<string, unknown>) };
      return empty(201);
    }
    return json(db.paymentSettings);
  }

  // The offline demo cannot reach PayFast: "paying" just marks the invoice paid.
  if (path.endsWith('/functions/v1/payfast-checkout')) {
    const inv = db.invoices.find((i) => i.id === (body as { invoiceId: string }).invoiceId);
    if (!inv || inv.status !== 'sent')
      return { status: 404, body: { error: 'That invoice cannot be paid online.' } };
    Object.assign(inv, { status: 'paid', paid_method: 'card', paid_at: new Date().toISOString() });
    return json({ demo: true });
  }

  if (path.endsWith('/functions/v1/send-invoice')) {
    const inv = db.invoices.find((i) => i.id === (body as { invoiceId: string }).invoiceId);
    if (!inv) return { status: 404, body: { error: 'That invoice is not available.' } };
    inv.emailed_at = new Date().toISOString();
    inv.email_queued_at = null;
    return json({ sent: true });
  }

  const myClient = (clientId: unknown) =>
    clients.find((c) => c.id === clientId && db.accounts.some((a) => a.client_id === c.id && !a.revoked_at));

  if (path.endsWith('/rest/v1/rpc/portal_save_run')) {
    const b = body as {
      p_programme_id: string;
      p_run: Record<string, unknown> & { steps?: Record<string, unknown>[] };
    };
    const owner = clients.find((c) => c.programmes.some((p) => p.id === b.p_programme_id));
    const c = myClient(owner?.id);
    const prog = c?.programmes.find((p) => p.id === b.p_programme_id) as Record<string, unknown> | undefined;
    if (!c || !prog) return json(null);
    const id = String(b.p_run.id || `run-${runs.length + 1}`);
    const old = runs.findIndex((r) => r.id === id);
    if (old >= 0 && !(runs[old]!.by_client && runs[old]!.client_id === c.id)) return json(null);
    const gym = db.gyms.find((g) => g.id === prog.gym_id);
    const row = {
      id,
      client_id: c.id,
      gym_id: prog.gym_id ?? null,
      client_name: c.name,
      gym_name: gym ? [gym.name, gym.branch].filter(Boolean).join(' ') : '',
      coach: '',
      title: String(b.p_run.title ?? prog.title),
      run_date: b.p_run.run_date,
      started_at: b.p_run.started_at,
      total_ms: b.p_run.total_ms,
      planned_min: b.p_run.planned_min,
      by_client: true,
      run_steps: (b.p_run.steps ?? []).map((st) => ({ ...st })),
    } as StoredRun;
    if (old >= 0) runs[old] = row;
    else runs.push(row);
    return json(id);
  }

  if (path.endsWith('/rest/v1/rpc/portal_history')) {
    const mine = runs.filter((r) => myClient(r.client_id));
    return json(
      [...mine]
        .sort((x, y) => String(y.started_at ?? '').localeCompare(String(x.started_at ?? '')))
        .map((r) => ({
          id: r.id,
          client_id: r.client_id,
          title: r.title,
          run_date: r.run_date,
          total_ms: r.total_ms,
          planned_min: r.planned_min,
          by_client: r.by_client === true,
          gym: r.gym_name || null,
          trainer: profile.business_name,
          steps: r.run_steps.map((st) => ({
            n: st.n,
            machine: st.machine,
            exercise_name: st.exercise_name,
            sets: st.sets,
            reps: st.reps,
            ms: st.ms,
            done: st.done,
          })),
        })),
    );
  }

  if (path.endsWith('/rest/v1/rpc/portal_delete_run')) {
    const id = (body as { p_run_id: string }).p_run_id;
    const i = runs.findIndex((r) => r.id === id && r.by_client === true && myClient(r.client_id));
    if (i < 0) return json(false);
    runs.splice(i, 1);
    return json(true);
  }

  if (path.endsWith('/rest/v1/rpc/portal_bookings')) {
    return json(
      db.bookings
        .filter((b) => b.client_id && myClient(b.client_id))
        .sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at)))
        .map((b) => {
          const g = db.gyms.find((q) => q.id === b.gym_id);
          return {
            id: b.id,
            client_id: b.client_id,
            title: b.title,
            starts_at: b.starts_at,
            ends_at: b.ends_at,
            status: b.status,
            client_response: b.client_response,
            cancelled_by: b.cancelled_by,
            gym: g ? [g.name, g.branch].filter(Boolean).join(' ') : null,
            gym_address: g?.address || null,
            trainer: profile.business_name,
          };
        }),
    );
  }

  if (path.endsWith('/rest/v1/rpc/portal_respond_booking')) {
    const b = body as { p_booking_id: string; p_response: string };
    const row = db.bookings.find((x) => x.id === b.p_booking_id);
    if (
      !row ||
      !row.client_id ||
      !myClient(row.client_id) ||
      !['confirmed', 'declined'].includes(b.p_response)
    )
      return json(false);
    if (row.status !== 'scheduled' || new Date(String(row.starts_at)).getTime() <= Date.now())
      return json(false);
    row.client_response = b.p_response;
    return json(true);
  }

  if (path.endsWith('/rest/v1/rpc/portal_invoices')) {
    return json(
      db.invoices
        .filter((i) => i.client_id && myClient(i.client_id) && ['sent', 'paid'].includes(String(i.status)))
        .map((i) => ({
          pay_online: !!(
            db.paymentSettings?.enabled &&
            db.paymentSettings.merchant_id &&
            db.paymentSettings.merchant_key
          ),
          id: i.id,
          client_id: i.client_id,
          number: i.number,
          period_start: i.period_start,
          issued_on: i.issued_on,
          due_on: i.due_on,
          status: i.status,
          vat_percent: i.vat_percent,
          subtotal_cents: i.subtotal_cents,
          vat_cents: i.vat_cents,
          total_cents: i.total_cents,
          notes: i.notes,
          paid_at: i.paid_at,
          trainer: {
            business_name: profile.business_name,
            address: profile.address,
            contact_email: profile.contact_email,
            contact_phone: profile.contact_phone,
            bank_details: profile.bank_details,
            payment_link: profile.payment_link,
            terms: profile.invoice_terms,
          },
          lines: linesOf(i).map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit_cents: l.unit_cents,
            amount_cents: l.amount_cents,
          })),
        })),
    );
  }

  if (path.endsWith('/rest/v1/rpc/portal_reminder_prefs')) {
    return json(
      clients
        .filter((c) => myClient(c.id))
        .map((c) => ({
          client_id: c.id,
          trainer: profile.business_name,
          trainer_sends: !!profile.session_reminders,
          hours: profile.reminder_hours,
          has_email: String(c.email ?? '').trim() !== '',
          on: c.reminders_off !== true,
        })),
    );
  }

  if (path.endsWith('/rest/v1/rpc/portal_set_reminders')) {
    const b = body as { p_client_id: string; p_on: boolean };
    const c = clients.find((x) => x.id === b.p_client_id);
    if (!c || !myClient(c.id)) return json(false);
    c.reminders_off = !b.p_on;
    return json(true);
  }

  if (path.endsWith('/rest/v1/rpc/portal_withdraw_consent')) {
    const b = body as { p_client_id: string; p_purpose: string; p_detail: string };
    const c = clients.find((x) => x.id === b.p_client_id);
    const last = c?.consents
      .filter((r) => r.purpose === b.p_purpose && (r.detail ?? '') === b.p_detail)
      .at(-1);
    if (!c || !last || last.granted === false) return json(false);
    c.consents.push({ ...last, granted: false, granted_at: new Date().toISOString() });
    dataRequests.push({
      id: `d${dataRequests.length + 1}`,
      client_name: c.name,
      kind: 'consent-withdrawal',
      received_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      outcome: `Withdrawn by the client in the portal: ${b.p_purpose}`,
    });
    return json(true);
  }

  if (path.endsWith('/rest/v1/rpc/portal_request')) {
    const b = body as { p_client_id: string; p_kind: string; p_note: string };
    const c = clients.find((x) => x.id === b.p_client_id);
    if (!c) return json(false);
    dataRequests.push({
      id: `d${dataRequests.length + 1}`,
      client_name: c.name,
      kind: b.p_kind,
      received_at: new Date().toISOString(),
      completed_at: null,
      outcome: `Asked by the client in the portal. ${b.p_note}`,
    });
    return json(true);
  }

  return json({});
}

/** What the public link and the portal show for one programme. Only the programme and the plan: nothing from the client's record. */
function programmeJson(db: MockDb, plan: ImportPlan, programmeId: string) {
  const client = db.clients.find((c) => c.programmes.some((p) => p.id === programmeId));
  const programme = client?.programmes.find((p) => p.id === programmeId) as
    Record<string, unknown> | undefined;
  if (!client || !programme) return null;
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
  return {
    title: programme.title,
    notes: programme.notes,
    assigned_at: programme.assigned_at,
    trainer: db.profile.business_name,
    gym: { name: gym.name, branch: gym.branch, address: gym.address },
    items,
    floors: db.floors[gymId] ?? db.floors[plan.gym.id],
  };
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
