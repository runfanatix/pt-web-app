/**
 * Run history: the record saved when a workout finishes, mapped to and from the `runs` and `run_steps` tables,
 * and the plain-text log trainers copy into WhatsApp. Pure.
 */
import { z } from 'zod';
import { estimateSeconds, type SessionItem, type SessionMeta } from './session.ts';
import { fmtClock, type RunState } from './run.ts';
import type { Layout } from './schemas.ts';

type Equip = Layout['equipment'][number];

export interface HistoryStep {
  n: number;
  /** The machine's id, or '' once it has been deleted. */
  eid: string;
  /** Names are copied in so the history stays readable after equipment or exercises are deleted. */
  machine: string;
  zone: string;
  exercise: string;
  sets: number;
  reps: string;
  rest: number;
  ms: number;
  done: boolean;
  /** 1-based completion order, 0 when not done. */
  order: number;
}

export interface HistoryEntry {
  id: string;
  /** The saved client this run was for, or null for a guest. */
  clientId: string | null;
  clientName: string;
  coach: string;
  title: string;
  /** YYYY-MM-DD, the day the run started (local time). */
  date: string;
  /** Epoch milliseconds. */
  startedAt: number;
  totalMs: number;
  plannedMin: number;
  doneN: number;
  steps: HistoryStep[];
  /** Null when the gym has since been deleted. */
  gymId: string | null;
  gymName: string;
  /** True when the client ran this workout themselves in the portal. */
  byClient?: boolean;
}

export function isoOf(ts: number): string {
  const t = new Date(ts);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The record for a run: one step per exercise of the session with its time and whether it was done.
 * Returns null for a run with no time on the clock (nothing worth saving).
 */
export function buildHistoryEntry(input: {
  id: string;
  run: RunState;
  items: SessionItem[];
  meta: SessionMeta;
  equipment: Map<string, Equip>;
  place: (e: Equip) => string;
  gym: { id: string; name: string };
  /** Build the entry even when no time has been recorded (the live "Copy log" button). */
  allowEmpty?: boolean;
}): HistoryEntry | null {
  const { run, items, meta, equipment, place, gym } = input;
  if (!(run.total > 0) && !input.allowEmpty) return null;
  const steps: HistoryStep[] = items.map((it, i) => {
    const st = run.steps[it.uid] ?? { ms: 0, done: false };
    const e = equipment.get(it.eid);
    return {
      n: i + 1,
      eid: e ? e.id : '',
      machine: e ? e.name : 'Machine',
      zone: e ? place(e) : '',
      exercise: it.exercise,
      sets: Math.max(1, Number(it.sets) || 1),
      reps: String(it.reps),
      rest: Number(it.rest) || 0,
      ms: Math.round(st.ms),
      done: st.done,
      order: st.done ? run.order.indexOf(it.uid) + 1 : 0,
    };
  });
  const startedAt = run.startedAt || Date.now();
  return {
    id: input.id,
    clientId: meta.clientId || null,
    clientName: meta.client,
    coach: meta.coach,
    title: meta.title || 'Workout',
    date: isoOf(startedAt),
    startedAt,
    totalMs: Math.round(run.total),
    plannedMin: Math.round(estimateSeconds(items) / 60),
    doneN: steps.filter((s) => s.done).length,
    steps,
    gymId: gym.id,
    gymName: gym.name,
  };
}

/** The message trainers paste into WhatsApp: a title, who, where, when, and the time at each machine. */
export function runLogText(r: HistoryEntry): string {
  const L = [`*${r.title}* - workout log`];
  if (r.clientName) L.push(`Client: ${r.clientName}`);
  if (r.gymName) L.push(`Gym: ${r.gymName}`);
  if (r.date) L.push(`Date: ${fmtDate(r.date)}`);
  L.push(`Total time: ${fmtClock(r.totalMs)} (planned about ${r.plannedMin} min)`);
  L.push('');
  for (const st of r.steps) {
    L.push(`${st.n}. ${st.machine} - ${st.exercise}: ${fmtClock(st.ms)}${st.done ? '' : ' (not completed)'}`);
  }
  return L.join('\n');
}

/* ---------------------------------------------------------------- database rows */

export const RUNS_SELECT =
  'id, gym_id, client_id, client_name, gym_name, coach, title, run_date, started_at, total_ms, planned_min, by_client,' +
  ' run_steps(n, equipment_id, machine, zone, exercise_name, sets, reps, rest, ms, done, step_order)';

const StepRow = z.object({
  n: z.number(),
  equipment_id: z.string().nullable(),
  machine: z.string(),
  zone: z.string(),
  exercise_name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  ms: z.coerce.number(),
  done: z.boolean(),
  step_order: z.number(),
});
const RunRow = z.object({
  id: z.string(),
  gym_id: z.string().nullable(),
  client_id: z.string().nullable(),
  client_name: z.string(),
  gym_name: z.string(),
  coach: z.string(),
  title: z.string(),
  run_date: z.string(),
  started_at: z.string().nullable(),
  total_ms: z.coerce.number(),
  planned_min: z.number(),
  by_client: z.boolean().optional(),
  run_steps: z.array(StepRow),
});

/** Validates rows from `runs` (with their steps) and returns entries, newest first. */
export function historyFromRows(input: unknown): HistoryEntry[] {
  return RunRow.array()
    .parse(input)
    .map((r) => {
      const steps = r.run_steps
        .slice()
        .sort((a, b) => a.n - b.n)
        .map<HistoryStep>((s) => ({
          n: s.n,
          eid: s.equipment_id ?? '',
          machine: s.machine,
          zone: s.zone,
          exercise: s.exercise_name,
          sets: s.sets,
          reps: s.reps,
          rest: s.rest,
          ms: s.ms,
          done: s.done,
          order: s.step_order,
        }));
      const startedAt = r.started_at ? Date.parse(r.started_at) : 0;
      return {
        id: r.id,
        clientId: r.client_id,
        clientName: r.client_name,
        coach: r.coach,
        title: r.title,
        date: r.run_date,
        startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
        totalMs: r.total_ms,
        plannedMin: r.planned_min,
        doneN: steps.filter((s) => s.done).length,
        steps,
        gymId: r.gym_id,
        gymName: r.gym_name,
        ...(r.by_client ? { byClient: true } : {}),
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Rows to write for an entry. Equipment ids that are not uuids (a deleted machine) become null. */
export function rowsFromEntry(trainerId: string, e: HistoryEntry) {
  const run = {
    id: e.id,
    trainer_id: trainerId,
    gym_id: e.gymId,
    client_id: e.clientId,
    client_name: e.clientName,
    gym_name: e.gymName,
    coach: e.coach,
    title: e.title,
    run_date: e.date,
    started_at: e.startedAt ? new Date(e.startedAt).toISOString() : null,
    total_ms: e.totalMs,
    planned_min: e.plannedMin,
  };
  const steps = e.steps.map((s) => ({
    run_id: e.id,
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
  }));
  return { run, steps };
}
