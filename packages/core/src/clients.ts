/**
 * Clients, their consent records and assigned programmes: mapping to and from the database rows, and the readable
 * copy of a client's data for an access request. Pure.
 */
import { z } from 'zod';
import { CONSENT_WORDING_VERSION, type ConsentRecord } from './privacy.ts';
import { fmtDate, type HistoryEntry } from './history.ts';
import type { Client } from './schemas.ts';
import type { ItemSnap } from './schemas.ts';
import { fmtClock } from './run.ts';

/** One request loads the client list with consents and programmes. (`wording` is left out: it is large.) */
export const CLIENTS_SELECT =
  'id, name, whatsapp, email, emergency_name, emergency_phone, emergency_relation, plan, sub_status,' +
  ' per_week, sessions_left, renewal, goals, private_notes, date_of_birth, guardian_name, retention_until, created_at,' +
  ' consents(purpose, detail, granted, granted_at, notice_version),' +
  ' programmes(id, title, notes, assigned_at, gym_id,' +
  ' programme_items(position, equipment_id, exercise_id, exercise_name, sets, reps, rest, note))';

export interface ProgrammeRecord {
  id: string;
  title: string;
  notes: string;
  /** ISO timestamp. */
  assignedAt: string;
  gymId: string | null;
  items: ItemSnap[];
}

export interface ClientRecord {
  client: Client;
  consents: ConsentRecord[];
  programmes: ProgrammeRecord[];
  /** ISO timestamp. */
  createdAt: string;
}

const ConsentRow = z.object({
  purpose: z.string(),
  detail: z.string(),
  granted: z.boolean(),
  granted_at: z.string(),
  notice_version: z.string(),
});
const ItemRow = z.object({
  position: z.number(),
  equipment_id: z.string().nullable(),
  exercise_id: z.string().nullable(),
  exercise_name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  note: z.string(),
});
const ProgrammeRow = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  assigned_at: z.string(),
  gym_id: z.string().nullable(),
  programme_items: z.array(ItemRow),
});
const ClientRow = z.object({
  id: z.string(),
  name: z.string(),
  whatsapp: z.string(),
  email: z.string(),
  emergency_name: z.string(),
  emergency_phone: z.string(),
  emergency_relation: z.string(),
  plan: z.string(),
  sub_status: z.enum(['active', 'trial', 'paused', 'expired']),
  per_week: z.number(),
  sessions_left: z.number(),
  renewal: z.string().nullable(),
  goals: z.string(),
  private_notes: z.string(),
  date_of_birth: z.string().nullable(),
  guardian_name: z.string(),
  retention_until: z.string().nullable(),
  created_at: z.string(),
  consents: z.array(ConsentRow),
  programmes: z.array(ProgrammeRow),
});

/** Validates the rows of a CLIENTS_SELECT query. Email is not re-validated on read: a stored value is shown as is. */
export function clientRecordsFromRows(input: unknown): ClientRecord[] {
  return ClientRow.array()
    .parse(input)
    .map((r) => ({
      client: {
        id: r.id,
        name: r.name,
        whatsapp: r.whatsapp,
        email: r.email,
        emergencyName: r.emergency_name,
        emergencyPhone: r.emergency_phone,
        emergencyRelation: r.emergency_relation,
        plan: r.plan,
        subStatus: r.sub_status,
        perWeek: r.per_week,
        sessionsLeft: r.sessions_left,
        renewal: r.renewal,
        goals: r.goals,
        privateNotes: r.private_notes,
        dateOfBirth: r.date_of_birth,
        guardianName: r.guardian_name,
        retentionUntil: r.retention_until,
      },
      consents: r.consents.map((c) => ({
        purpose: c.purpose,
        detail: c.detail,
        granted: c.granted,
        grantedAt: c.granted_at,
        noticeVersion: c.notice_version,
        wording: '',
      })),
      programmes: r.programmes
        .slice()
        .sort((a, b) => Date.parse(b.assigned_at) - Date.parse(a.assigned_at))
        .map((p) => ({
          id: p.id,
          title: p.title,
          notes: p.notes,
          assignedAt: p.assigned_at,
          gymId: p.gym_id,
          items: p.programme_items
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((i) => ({
              eid: i.equipment_id ?? '',
              xid: i.exercise_id,
              exercise: i.exercise_name,
              sets: i.sets,
              reps: i.reps,
              rest: i.rest,
              note: i.note,
            })),
        })),
      createdAt: r.created_at,
    }))
    .sort((a, b) => a.client.name.toLowerCase().localeCompare(b.client.name.toLowerCase()));
}

const blankToNull = (s: string | null): string | null => (s && s.trim() ? s : null);

/** The columns to write for a client (without the id, which the database chooses on insert). */
export function clientToRow(trainerId: string, c: Client) {
  return {
    trainer_id: trainerId,
    name: c.name.trim(),
    whatsapp: c.whatsapp.trim(),
    email: c.email.trim(),
    emergency_name: c.emergencyName.trim(),
    emergency_phone: c.emergencyPhone.trim(),
    emergency_relation: c.emergencyRelation.trim(),
    plan: c.plan.trim(),
    sub_status: c.subStatus,
    per_week: c.perWeek,
    sessions_left: c.sessionsLeft,
    renewal: blankToNull(c.renewal),
    goals: c.goals,
    private_notes: c.privateNotes,
    date_of_birth: blankToNull(c.dateOfBirth),
    guardian_name: c.guardianName.trim(),
    retention_until: blankToNull(c.retentionUntil),
  };
}

/** A consent record to append (granted or withdrawn), with the exact wording and version the person saw. */
export function consentToRow(
  trainerId: string,
  clientId: string,
  c: { purpose: string; detail?: string; granted: boolean; wording: string; noticeVersion?: string },
) {
  return {
    trainer_id: trainerId,
    client_id: clientId,
    subject: 'client' as const,
    purpose: c.purpose,
    detail: c.detail ?? '',
    granted: c.granted,
    notice_version: c.noticeVersion ?? CONSENT_WORDING_VERSION,
    wording: c.wording,
  };
}

/** Rows to write when assigning a routine to a client. */
export function programmeToRows(
  clientId: string,
  gymId: string | null,
  programme: { title: string; notes: string },
  items: ItemSnap[],
) {
  return {
    programme: {
      client_id: clientId,
      gym_id: gymId,
      title: programme.title.trim() || 'Programme',
      notes: programme.notes,
    },
    items: (programmeId: string) =>
      items.map((it, position) => ({
        programme_id: programmeId,
        position,
        equipment_id: it.eid || null,
        exercise_id: it.xid,
        exercise_name: it.exercise,
        sets: it.sets,
        reps: it.reps,
        rest: it.rest,
        note: it.note,
      })),
  };
}

/* ---------------------------------------------------------------- access request: a readable copy */

export interface ClientExport {
  /** Plain text the trainer can send or print. */
  text: string;
  /** The same data as JSON, for a machine-readable copy. */
  json: string;
}

/** Everything held about a client, in readable form, for an access request. Includes the trainer's private notes. */
export function buildClientExport(
  r: ClientRecord,
  extra: { runs: HistoryEntry[]; consents: ConsentRecord[]; trainerName: string; generatedOn: string },
): ClientExport {
  const c = r.client;
  const L: string[] = [];
  L.push(`Information held about ${c.name} by ${extra.trainerName || 'your trainer'}`);
  L.push(`Prepared on ${fmtDate(extra.generatedOn)}`);
  L.push('');
  L.push('About you');
  const line = (k: string, v: string | number | null) => v !== null && v !== '' && L.push(`${k}: ${v}`);
  line('Name', c.name);
  line('Date of birth', c.dateOfBirth);
  line('WhatsApp', c.whatsapp);
  line('Email', c.email);
  line(
    'Emergency contact',
    [c.emergencyName, c.emergencyPhone, c.emergencyRelation].filter(Boolean).join(', '),
  );
  line('Guardian', c.guardianName);
  L.push('');
  L.push('Training and account');
  line('Plan', c.plan);
  line('Subscription', c.subStatus);
  line('Sessions per week', c.perWeek);
  line('Sessions left', c.sessionsLeft);
  line('Renewal date', c.renewal);
  line('Goals', c.goals);
  line('Notes held about you', c.privateNotes);
  line('Keep until', c.retentionUntil);
  L.push('');
  L.push(`Programmes (${r.programmes.length})`);
  for (const p of r.programmes) {
    L.push(`- ${p.title} (assigned ${p.assignedAt.slice(0, 10)})${p.notes ? `: ${p.notes}` : ''}`);
    p.items.forEach((i, n) =>
      L.push(
        `    ${n + 1}. ${i.exercise}: ${i.sets} x ${i.reps}, rest ${i.rest} s${i.note ? ` (${i.note})` : ''}`,
      ),
    );
  }
  L.push('');
  L.push(`Workouts completed (${extra.runs.length})`);
  for (const run of extra.runs) {
    L.push(
      `- ${run.date} ${run.title}: ${fmtClock(run.totalMs)}, ${run.doneN} of ${run.steps.length} steps done`,
    );
  }
  L.push('');
  L.push(`Consents and privacy (${extra.consents.length} records)`);
  for (const k of extra.consents.slice().sort((a, b) => Date.parse(a.grantedAt) - Date.parse(b.grantedAt))) {
    L.push(
      `- ${k.grantedAt.slice(0, 16).replace('T', ' ')} ${k.purpose}${k.detail ? ` (${k.detail})` : ''}: ${k.granted ? 'agreed' : 'withdrawn'} (wording version ${k.noticeVersion})`,
    );
  }
  return {
    text: L.join('\n'),
    json: JSON.stringify(
      {
        client: c,
        programmes: r.programmes,
        workouts: extra.runs,
        consents: extra.consents,
        preparedOn: extra.generatedOn,
      },
      null,
      2,
    ),
  };
}
