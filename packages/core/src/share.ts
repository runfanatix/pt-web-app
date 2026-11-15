/**
 * Sharing a programme with a client: the message text, WhatsApp and email links, PDF helpers, share-link URLs,
 * and reading what the public client page receives. Ported from prototype/zone-planner-v11.html (routineText,
 * waNumber, pdfSafe, pdfName). Pure.
 */
import { z } from 'zod';
import { layoutFromFloorRows } from './layout-rows.ts';
import type { Layout } from './schemas.ts';
import type { SessionItem } from './session.ts';
import { fmtDate } from './history.ts';

export const firstName = (n: string): string => n.trim().split(/\s+/)[0] ?? '';

/** WhatsApp wants digits only, with the country code. Numbers starting with 0 are treated as South African (+27). */
export function waNumber(raw: string): string {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '27' + d.slice(1);
  return d;
}

/** The PDF fonts only know Latin-1: swap typographic characters and replace anything else with "?". */
export function pdfSafe(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '>')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
}

export interface ShareItem {
  exercise: string;
  /** The machine's name and where it is, for the message and the PDF ('' if the machine is gone). */
  machine: string;
  zone: string;
  sets: number;
  reps: string;
  rest: number;
  note: string;
  cue: string;
}

export interface ShareModel {
  title: string;
  client: string;
  coach: string;
  /** YYYY-MM-DD, or ''. */
  date: string;
  notes: string;
  /** "Virgin Active Bedfordview, 101 Van Buuren Rd". */
  gym: string;
  items: ShareItem[];
}

/** The text message a trainer copies or opens in WhatsApp or email. */
export function routineText(m: ShareModel, opts: { link?: string } = {}): string {
  const L: string[] = [];
  const fn = firstName(m.client);
  if (fn) L.push(`Hi ${fn},`, 'Here is your training programme.', '');
  L.push(`*${m.title || 'Training programme'}*`);
  if (m.client) L.push(`Client: ${m.client}`);
  if (m.coach) L.push(`Coach: ${m.coach}`);
  if (m.gym) L.push(`Gym: ${m.gym}`);
  if (m.date) L.push(`Date: ${fmtDate(m.date)}`);
  L.push('');
  m.items.forEach((it, i) => {
    L.push(`${i + 1}. ${it.exercise}${it.machine ? ` (${it.machine}${it.zone ? `, ${it.zone}` : ''})` : ''}`);
    L.push(
      `    ${it.sets} x ${it.reps}${it.rest ? `, rest ${it.rest} s` : ''}${it.note ? `. ${it.note}` : ''}`,
    );
  });
  if (m.notes.trim()) L.push('', m.notes.trim());
  if (opts.link) L.push('', `See it on the gym plan: ${opts.link}`);
  return L.join('\n');
}

export function whatsappUrl(number: string, text: string): string {
  return `https://wa.me/${waNumber(number)}?text=${encodeURIComponent(text)}`;
}

/** A mailto link. A very long message is replaced by a short one, since mail apps cut off long links. */
export function mailtoUrl(
  address: string,
  m: Pick<ShareModel, 'title' | 'client' | 'coach'>,
  text: string,
): string {
  const subject = m.title || 'Your training programme';
  let body = text.replace(/\*/g, '');
  if (encodeURIComponent(body).length > 1800) {
    body = `Hi${m.client ? ` ${m.client}` : ''},\n\nYour training programme is attached as a PDF.${m.coach ? `\n\n${m.coach}` : ''}`;
  }
  return `mailto:${encodeURIComponent(address.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** "training-programme-Sam-2026-11-15.pdf" (or "workout-results-..." for a finished run). */
export function pdfFileName(
  m: { client: string; date: string },
  kind: 'programme' | 'results',
  today: string,
): string {
  let base = kind === 'results' ? 'workout-results' : 'training-programme';
  if (m.client.trim()) base += `-${m.client.trim()}`;
  base += `-${m.date || today}`;
  return base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-') + '.pdf';
}

/** The link a client opens: the app's own address plus /p/ and the token. */
export const shareUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, '')}/p/${token}`;

/** Pulls the token out of a /p/<token> path, or null. */
export function tokenFromPath(pathname: string): string | null {
  const m = /^\/p\/([0-9a-f]{16,128})\/?$/i.exec(pathname);
  return m ? m[1]!.toLowerCase() : null;
}

/* ---------------------------------------------------------------- what the public page receives */

const SharedItem = z.object({
  position: z.number(),
  equipment_id: z.string().nullable(),
  exercise_name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  note: z.string(),
  cue: z.string(),
});
const SharedSchema = z.object({
  title: z.string(),
  notes: z.string(),
  assigned_at: z.string(),
  trainer: z.string(),
  gym: z.object({ name: z.string(), branch: z.string(), address: z.string() }).nullable(),
  items: z.array(SharedItem),
  floors: z.array(z.unknown()),
});

export interface SharedProgramme {
  title: string;
  notes: string;
  trainerName: string;
  /** YYYY-MM-DD the programme was assigned. */
  assignedOn: string;
  gymName: string;
  gymLine: string;
  /** Items in order; `uid` is just the position. `eid` is '' for a machine that no longer exists. */
  items: SessionItem[];
  /** The coaching cue for each item, in the same order. */
  cues: string[];
  /** The gym's layout, or null when the programme has no gym (then no plan is drawn). */
  layout: Layout | null;
}

/** Validates what `get_shared_programme` returned. Null (a bad, revoked or expired link) gives null. */
export function parseSharedProgramme(raw: unknown): SharedProgramme | null {
  if (raw === null || raw === undefined) return null;
  const r = SharedSchema.parse(raw);
  const items = r.items.slice().sort((a, b) => a.position - b.position);
  const gymName = r.gym ? [r.gym.name, r.gym.branch].filter(Boolean).join(' ') : '';
  return {
    title: r.title,
    notes: r.notes,
    trainerName: r.trainer,
    assignedOn: r.assigned_at.slice(0, 10),
    gymName,
    gymLine: r.gym && r.gym.address ? `${gymName}, ${r.gym.address}` : gymName,
    items: items.map((i, n) => ({
      uid: `s${n}`,
      eid: i.equipment_id ?? '',
      xid: null,
      exercise: i.exercise_name,
      sets: i.sets,
      reps: i.reps,
      rest: i.rest,
      note: i.note,
    })),
    cues: items.map((i) => i.cue),
    layout: r.floors.length ? layoutFromFloorRows(r.floors) : null,
  };
}
