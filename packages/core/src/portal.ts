/**
 * The client portal: what a signed-in client is told by the database function `portal_overview`, and how their
 * consent choices are described to them. Nothing here is private to the trainer: the function never returns it.
 */
import { z } from 'zod';
import type { HistoryEntry } from './history.ts';

/** Placeholder branding until the real product name and logo exist. Change it here and everywhere follows. */
export const BRAND = {
  productName: 'PT Planner',
  portalName: 'Client portal',
  /** Shown above the sign-in form. */
  tagline: 'Your training programmes, in one place.',
  /** Letter shown in the logo circle until there is a real logo. */
  mark: 'P',
} as const;

const Trainer = z.object({
  business_name: z.string(),
  display_name: z.string(),
  address: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  information_officer_name: z.string(),
  information_officer_email: z.string(),
});
const Programme = z.object({
  id: z.string(),
  title: z.string(),
  assigned_at: z.string(),
  gym: z.string().nullable(),
  exercises: z.coerce.number(),
});
const Consent = z.object({
  purpose: z.string(),
  detail: z.string(),
  granted: z.boolean(),
  at: z.string(),
  notice_version: z.string(),
});
const Membership = z.object({
  client_id: z.string(),
  client_name: z.string(),
  trainer: Trainer,
  programmes: z.array(Programme),
  consents: z.array(Consent),
});
const Overview = z.object({ email: z.string().nullable(), memberships: z.array(Membership) });

export interface PortalProgrammeSummary {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  assignedOn: string;
  gym: string;
  exercises: number;
}
export interface PortalConsent {
  purpose: string;
  detail: string;
  granted: boolean;
  noticeVersion: string;
}
/** One trainer the person trains with, and everything of theirs at that trainer. */
export interface PortalMembership {
  clientId: string;
  clientName: string;
  trainerName: string;
  trainer: {
    address: string;
    contactEmail: string;
    contactPhone: string;
    officerName: string;
    officerEmail: string;
  };
  programmes: PortalProgrammeSummary[];
  consents: PortalConsent[];
}
export interface PortalOverview {
  email: string;
  memberships: PortalMembership[];
}

/** Validates what `portal_overview` returned. Null (not signed in) gives an empty overview. */
export function parsePortalOverview(raw: unknown): PortalOverview {
  if (raw === null || raw === undefined) return { email: '', memberships: [] };
  const o = Overview.parse(raw);
  return {
    email: o.email ?? '',
    memberships: o.memberships.map((m) => ({
      clientId: m.client_id,
      clientName: m.client_name,
      trainerName: m.trainer.business_name || m.trainer.display_name || 'Your trainer',
      trainer: {
        address: m.trainer.address,
        contactEmail: m.trainer.contact_email,
        contactPhone: m.trainer.contact_phone,
        officerName: m.trainer.information_officer_name,
        officerEmail: m.trainer.information_officer_email,
      },
      programmes: m.programmes.map((p) => ({
        id: p.id,
        title: p.title,
        assignedOn: p.assigned_at.slice(0, 10),
        gym: p.gym ?? '',
        exercises: p.exercises,
      })),
      consents: m.consents.map((c) => ({
        purpose: c.purpose,
        detail: c.detail,
        granted: c.granted,
        noticeVersion: c.notice_version,
      })),
    })),
  };
}

const CONSENT_LABELS: Record<string, string> = {
  'privacy-notice': 'My trainer keeping my details and training records',
  'health-information': 'My trainer using my health and training information',
  'hosting-abroad': 'Storing my information on servers outside South Africa',
  guardian: 'My guardian’s consent',
  marketing: 'News and offers from my trainer',
};

/** How a consent is described to the client, in plain words. */
export function consentLabel(purpose: string, detail = ''): string {
  if (purpose === 'sharing') return `Sharing my information with ${detail || 'another professional'}`;
  return CONSENT_LABELS[purpose] ?? purpose;
}

/** Withdrawing these means the trainer can no longer keep the client's records, so the client is warned first. */
export const isCoreConsent = (purpose: string): boolean =>
  purpose === 'privacy-notice' || purpose === 'health-information' || purpose === 'hosting-abroad';

export const REQUEST_KINDS = [
  { kind: 'access', label: 'Send me a copy of my information' },
  { kind: 'correction', label: 'Correct something about me' },
  { kind: 'deletion', label: 'Delete my information' },
  { kind: 'objection', label: 'Stop using my information for something' },
] as const;
export type PortalRequestKind = (typeof REQUEST_KINDS)[number]['kind'];

export type InviteStatus = 'none' | 'invited' | 'active' | 'off' | 'expired';

/** A trainer's view of one client's portal access, from their invites and accounts. */
export function inviteStatus(
  invites: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string }[],
  accounts: { revokedAt: string | null }[],
  now: number = Date.now(),
): InviteStatus {
  if (accounts.some((a) => !a.revokedAt)) return 'active';
  if (invites.some((i) => !i.acceptedAt && !i.revokedAt && Date.parse(i.expiresAt) > now)) return 'invited';
  if (accounts.length) return 'off';
  if (invites.some((i) => !i.acceptedAt && !i.revokedAt)) return 'expired';
  return invites.length ? 'off' : 'none';
}

/* ---------------------------------------------------------------- the client's own workouts */

/** What `portal_save_run` receives for a finished workout. The programme decides the client and the gym. */
export function portalRunPayload(e: HistoryEntry) {
  return {
    id: e.id,
    title: e.title,
    run_date: e.date,
    started_at: e.startedAt ? new Date(e.startedAt).toISOString() : null,
    total_ms: e.totalMs,
    planned_min: e.plannedMin,
    steps: e.steps.map((s) => ({
      n: s.n,
      equipment_id: s.eid || null,
      machine: s.machine,
      zone: s.zone,
      exercise_name: s.exercise,
      sets: s.sets,
      reps: s.reps,
      rest: s.rest,
      ms: s.ms,
      done: s.done,
      step_order: s.order,
    })),
  };
}

const WorkoutRow = z.object({
  id: z.string(),
  client_id: z.string(),
  title: z.string(),
  run_date: z.string(),
  total_ms: z.coerce.number(),
  planned_min: z.coerce.number(),
  by_client: z.boolean(),
  gym: z.string().nullable(),
  trainer: z.string().nullable(),
  steps: z.array(
    z.object({
      n: z.number(),
      machine: z.string(),
      exercise_name: z.string(),
      sets: z.number(),
      reps: z.string(),
      ms: z.coerce.number(),
      done: z.boolean(),
    }),
  ),
});

export interface PortalWorkout {
  id: string;
  clientId: string;
  title: string;
  date: string;
  totalMs: number;
  plannedMin: number;
  /** True when the client did it themselves (they can delete it); false when their trainer recorded it. */
  byClient: boolean;
  gym: string;
  trainerName: string;
  steps: {
    n: number;
    machine: string;
    exercise: string;
    sets: number;
    reps: string;
    ms: number;
    done: boolean;
  }[];
  doneN: number;
}

/** Validates what `portal_history` returned (newest first). */
export function parsePortalHistory(raw: unknown): PortalWorkout[] {
  if (raw === null || raw === undefined) return [];
  return WorkoutRow.array()
    .parse(raw)
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
      title: r.title,
      date: r.run_date,
      totalMs: r.total_ms,
      plannedMin: r.planned_min,
      byClient: r.by_client,
      gym: r.gym ?? '',
      trainerName: r.trainer ?? '',
      steps: r.steps
        .slice()
        .sort((a, b) => a.n - b.n)
        .map((s) => ({
          n: s.n,
          machine: s.machine,
          exercise: s.exercise_name,
          sets: s.sets,
          reps: s.reps,
          ms: s.ms,
          done: s.done,
        })),
      doneN: r.steps.filter((s) => s.done).length,
    }));
}
