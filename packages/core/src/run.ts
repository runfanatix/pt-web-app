/**
 * Live run state machine, ported from prototype/zone-planner-v11.html (newRun, tick, runStart, runNext, runBack,
 * runPause, runResume, runJump*, reconcileRun, stepState, machineRun, fmtClock). Pure: every function takes the
 * current time as an argument and returns a new state, so it is unit-testable and the UI owns the clock.
 */
import type { SessionItem } from './session.ts';

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface RunStep {
  /** Milliseconds spent at this step. */
  ms: number;
  done: boolean;
}

export interface RunState {
  status: RunStatus;
  /** Total running time in ms (excludes paused time). */
  total: number;
  /** Timestamp (ms) of the last tick; the next tick adds the time since then. */
  last: number;
  steps: Record<string, RunStep>;
  /** Item uids in the order they were completed. */
  order: string[];
  /** The uid of the current step, or null when idle or finished. */
  cur: string | null;
  startedAt: number;
  /** Id of the history entry once the run has been saved, so a re-finish updates it. */
  histId: string;
}

export function newRun(): RunState {
  return { status: 'idle', total: 0, last: 0, steps: {}, order: [], cur: null, startedAt: 0, histId: '' };
}

export const isActive = (r: RunState): boolean => r.status === 'running' || r.status === 'paused';

/** The live view shows on the Run tab, and for as long as a run is not idle. */
export const isRunView = (r: RunState, tabIsRun: boolean, editMode: boolean): boolean =>
  !editMode && (r.status !== 'idle' || tabIsRun);

const indexOfUid = (items: SessionItem[], uid: string | null): number =>
  items.findIndex((i) => i.uid === uid);

/** The next step not yet done after `afterUid`, wrapping round; null when everything is done. */
export function nextUndone(r: RunState, items: SessionItem[], afterUid: string | null): string | null {
  const start = afterUid == null ? -1 : indexOfUid(items, afterUid);
  for (let i = 1; i <= items.length; i++) {
    const u = items[(start + i) % items.length]!.uid;
    const s = r.steps[u];
    if (u !== afterUid && s && !s.done) return u;
  }
  return null;
}

/** Adds the time since the last tick to the total and to the current step. */
export function tick(r: RunState, now: number): RunState {
  if (r.status !== 'running') return r;
  const d = Math.max(0, now - r.last);
  const cur = r.cur ? r.steps[r.cur] : undefined;
  return {
    ...r,
    last: now,
    total: r.total + d,
    steps: cur && r.cur ? { ...r.steps, [r.cur]: { ...cur, ms: cur.ms + d } } : r.steps,
  };
}

export function start(items: SessionItem[], now: number): RunState {
  if (!items.length) return newRun();
  const steps: Record<string, RunStep> = {};
  for (const it of items) steps[it.uid] = { ms: 0, done: false };
  return { ...newRun(), status: 'running', last: now, startedAt: now, cur: items[0]!.uid, steps };
}

/** Marks the current step done and moves to the next undone one; finishes the run when none is left. */
export function next(r: RunState, items: SessionItem[], now: number): RunState {
  if (!isActive(r)) return r;
  let run = tick(r, now);
  const cur = run.cur;
  const s = cur ? run.steps[cur] : undefined;
  if (cur && s && !s.done)
    run = { ...run, steps: { ...run.steps, [cur]: { ...s, done: true } }, order: [...run.order, cur] };
  const nx = nextUndone(run, items, cur);
  return nx ? { ...run, cur: nx } : { ...run, status: 'finished', cur: null };
}

/** Undo the last completed step (also reopens a finished run, paused). */
export function back(r: RunState, now: number): RunState {
  if (!r.order.length || r.status === 'idle') return r;
  const run = tick(r, now);
  const order = run.order.slice();
  const prev = order.pop()!;
  const s = run.steps[prev];
  return {
    ...run,
    order,
    steps: s ? { ...run.steps, [prev]: { ...s, done: false } } : run.steps,
    status: run.status === 'finished' ? 'paused' : run.status,
    cur: prev,
    last: now,
  };
}

export function pause(r: RunState, now: number): RunState {
  return r.status === 'running' ? { ...tick(r, now), status: 'paused' } : r;
}

export function resume(r: RunState, now: number): RunState {
  return r.status === 'paused' ? { ...r, last: now, status: 'running' } : r;
}

/** Jump straight to a step that is still to do. */
export function jump(r: RunState, uid: string, now: number): RunState {
  if (!isActive(r) || uid === r.cur) return r;
  const s = r.steps[uid];
  if (!s || s.done) return r;
  return { ...tick(r, now), cur: uid };
}

export type JumpResult = { run: RunState; outcome: 'jumped' | 'here' | 'unavailable' };

/** Tapping a machine during a run: jump to its first step still to do. */
export function jumpToMachine(r: RunState, items: SessionItem[], eid: string, now: number): JumpResult {
  const target = items.find(
    (it) => it.eid === eid && it.uid !== r.cur && r.steps[it.uid] && !r.steps[it.uid]!.done,
  );
  if (target) return { run: jump(r, target.uid, now), outcome: 'jumped' };
  const here = items.find((it) => it.uid === r.cur);
  return { run: r, outcome: here && here.eid === eid ? 'here' : 'unavailable' };
}

/** Keep a run consistent after the session's items change mid-run (items added, removed or reordered). */
export function reconcile(r: RunState, items: SessionItem[]): RunState {
  if (r.status === 'idle') return r;
  const ids = new Set(items.map((i) => i.uid));
  const steps: Record<string, RunStep> = {};
  for (const it of items) steps[it.uid] = r.steps[it.uid] ?? { ms: 0, done: false };
  let run: RunState = { ...r, steps, order: r.order.filter((u) => ids.has(u)) };
  if (isActive(run) && (!run.cur || !ids.has(run.cur))) {
    const nx = nextUndone(run, items, null);
    run = nx ? { ...run, cur: nx } : { ...run, status: 'finished', cur: null };
  }
  return run;
}

export type StepState = 'ready' | 'now' | 'done' | 'skip' | 'next';

export function stepState(r: RunState, uid: string): StepState {
  const s = r.steps[uid];
  if (r.status === 'idle') return 'ready';
  if (uid === r.cur) return 'now';
  if (s && s.done) return 'done';
  return r.status === 'finished' ? 'skip' : 'next';
}

export interface MachineRun {
  st: StepState | 'none';
  /** Step numbers to show on the marker. */
  nums: number[];
  ms: number;
}

/** How a machine looks during a run: current, still to do, done, skipped or not in the routine. */
export function machineRun(r: RunState, items: SessionItem[], eid: string): MachineRun {
  const nums: number[] = [];
  const undone: number[] = [];
  let ms = 0;
  let any = false;
  let hasCur = false;
  items.forEach((it, i) => {
    if (it.eid !== eid) return;
    any = true;
    const s = r.steps[it.uid] ?? { ms: 0, done: false };
    ms += s.ms;
    nums.push(i + 1);
    if (it.uid === r.cur) hasCur = true;
    else if (!s.done) undone.push(i + 1);
  });
  if (!any) return { st: 'none', nums: [], ms: 0 };
  if (r.status === 'idle') return { st: 'ready', nums, ms: 0 };
  if (hasCur) return { st: 'now', nums: [indexOfUid(items, r.cur) + 1], ms };
  if (undone.length) return { st: r.status === 'finished' ? 'skip' : 'next', nums: undone, ms };
  return { st: 'done', nums, ms };
}

export interface RouteLeg {
  from: string;
  to: string;
  st: 'ready' | 'done' | 'now' | 'next' | 'skip';
}

/**
 * Route legs for the live view as machine-id pairs: done, then the current step, then what is still to do.
 * Consecutive steps at the same machine make no leg.
 */
export function runRouteLegs(r: RunState, items: SessionItem[]): RouteLeg[] {
  const byUid = new Map(items.map((i) => [i.uid, i]));
  const seq: { eid: string; st: 'ready' | 'done' | 'now' | 'next' | 'skip' }[] = [];
  if (r.status === 'idle') {
    for (const it of items) seq.push({ eid: it.eid, st: 'ready' });
  } else {
    for (const u of r.order) {
      const it = byUid.get(u);
      if (it) seq.push({ eid: it.eid, st: 'done' });
    }
    const cur = r.cur ? byUid.get(r.cur) : undefined;
    if (cur) seq.push({ eid: cur.eid, st: 'now' });
    for (const it of items) {
      const s = r.steps[it.uid];
      if (it.uid !== r.cur && s && !s.done)
        seq.push({ eid: it.eid, st: r.status === 'finished' ? 'skip' : 'next' });
    }
  }
  const legs: RouteLeg[] = [];
  let prev: string | null = null;
  for (const q of seq) {
    if (prev && prev !== q.eid) legs.push({ from: prev, to: q.eid, st: q.st === 'now' ? 'done' : q.st });
    prev = q.eid;
  }
  return legs;
}

export const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

/** "05:07", or "1:02:03" past an hour. */
export function fmtClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${pad2(m)}:${pad2(x)}`;
}

export const RUN_WORD: Record<StepState, string> = {
  ready: 'in routine',
  now: 'current',
  next: 'still to do',
  done: 'completed',
  skip: 'skipped',
};

/** End the workout now (the "End workout" button): the clock stops, steps keep what was done, the rest are skipped. */
export function finish(r: RunState, now: number): RunState {
  if (!isActive(r)) return r;
  return { ...tick(r, now), status: 'finished', cur: null };
}
