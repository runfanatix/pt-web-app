import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  back,
  finish,
  fmtClock,
  isActive,
  isRunView,
  jump,
  jumpToMachine,
  machineRun,
  newRun,
  next,
  nextUndone,
  pause,
  reconcile,
  resume,
  runRouteLegs,
  start,
  stepState,
  tick,
  type RunState,
} from './run.ts';
import type { SessionItem } from './session.ts';

const item = (uid: string, eid: string): SessionItem => ({
  uid,
  eid,
  xid: null,
  exercise: `Ex ${uid}`,
  sets: 3,
  reps: '10',
  rest: 60,
  note: '',
});
const three = [item('a', 'm1'), item('b', 'm2'), item('c', 'm3')];

describe('starting, timing and finishing', () => {
  it('starts on the first step with every step at zero', () => {
    const r = start(three, 1000);
    expect(r).toMatchObject({ status: 'running', cur: 'a', startedAt: 1000, last: 1000, total: 0 });
    expect(Object.keys(r.steps)).toEqual(['a', 'b', 'c']);
    expect(start([], 1000).status).toBe('idle');
  });

  it('a tick adds the elapsed time to the total and the current step only', () => {
    const r = tick(start(three, 1000), 4500);
    expect(r.total).toBe(3500);
    expect(r.steps.a!.ms).toBe(3500);
    expect(r.steps.b!.ms).toBe(0);
    expect(tick(r, 4000).total).toBe(3500); // a clock that goes backwards adds nothing
  });

  it('paused time is not counted', () => {
    let r = start(three, 0);
    r = pause(r, 10_000);
    expect(r.status).toBe('paused');
    r = tick(r, 60_000); // ticks while paused do nothing
    r = resume(r, 70_000);
    r = tick(r, 75_000);
    expect(r.total).toBe(15_000);
    expect(r.steps.a!.ms).toBe(15_000);
  });

  it('Next marks the step done, times the next one, and finishes after the last', () => {
    let r = start(three, 0);
    r = next(r, three, 5000);
    expect(r).toMatchObject({ cur: 'b', order: ['a'] });
    expect(r.steps.a).toEqual({ ms: 5000, done: true });
    r = next(r, three, 8000);
    r = next(r, three, 9000);
    expect(r).toMatchObject({ status: 'finished', cur: null, order: ['a', 'b', 'c'], total: 9000 });
    expect(r.steps.c!.ms).toBe(1000);
  });

  it('Back undoes the last completed step, and reopens a finished run as paused', () => {
    let r = start(three, 0);
    r = next(next(next(r, three, 1000), three, 2000), three, 3000);
    expect(r.status).toBe('finished');
    r = back(r, 4000);
    expect(r).toMatchObject({ status: 'paused', cur: 'c', order: ['a', 'b'] });
    expect(r.steps.c!.done).toBe(false);
    expect(back(start(three, 0), 10)).toEqual(start(three, 0)); // nothing to undo
  });

  it('jumping skips to a step still to do and keeps the order list intact', () => {
    let r = start(three, 0);
    r = jump(r, 'c', 2000);
    expect(r.cur).toBe('c');
    expect(r.steps.a!.ms).toBe(2000);
    r = next(r, three, 3000); // finishing c, wraps to a
    expect(r.cur).toBe('a');
    expect(r.order).toEqual(['c']);
    expect(jump(r, 'c', 4000)).toBe(r); // done steps cannot be jumped to
    expect(jump(newRun(), 'a', 0).status).toBe('idle');
  });

  it('tapping a machine jumps to its first step still to do, or says why not', () => {
    const items = [item('a', 'm1'), item('b', 'm2'), item('c', 'm1')];
    const r = start(items, 0);
    expect(jumpToMachine(r, items, 'm2', 100).run.cur).toBe('b');
    expect(jumpToMachine(r, items, 'm1', 100).outcome).toBe('jumped'); // the second m1 step
    expect(jumpToMachine(r, items, 'm1', 100).run.cur).toBe('c');
    const onB = jumpToMachine(r, items, 'm2', 100).run;
    expect(jumpToMachine(onB, items, 'm2', 200).outcome).toBe('here');
    expect(jumpToMachine(r, items, 'nowhere', 100).outcome).toBe('unavailable');
  });

  it('is active only while running or paused, and the live view follows the Run tab', () => {
    expect(isActive(start(three, 0))).toBe(true);
    expect(isActive(newRun())).toBe(false);
    expect(isRunView(newRun(), true, false)).toBe(true);
    expect(isRunView(newRun(), false, false)).toBe(false);
    expect(isRunView(start(three, 0), false, false)).toBe(true);
    expect(isRunView(start(three, 0), true, true)).toBe(false); // edit mode never shows it
  });
});

describe('editing the session during a run', () => {
  it('adds steps for new items, drops removed ones, and moves on when the current step is removed', () => {
    let r = next(start(three, 0), three, 1000); // on b, a done
    const grown = [...three, item('d', 'm4')];
    r = reconcile(r, grown);
    expect(r.steps.d).toEqual({ ms: 0, done: false });
    const shrunk = [item('a', 'm1'), item('c', 'm3')]; // b (current) removed
    r = reconcile(r, shrunk);
    expect(r.steps.b).toBeUndefined();
    expect(r.cur).toBe('c');
    const allDone = reconcile(r, [item('a', 'm1')]); // only a (done) is left
    expect(allDone.status).toBe('finished');
    expect(reconcile(newRun(), three)).toEqual(newRun());
  });
});

describe('run view helpers', () => {
  it('states and marker status', () => {
    const r = next(start(three, 0), three, 1000);
    expect(three.map((i) => stepState(r, i.uid))).toEqual(['done', 'now', 'next']);
    expect(machineRun(r, three, 'm1')).toMatchObject({ st: 'done', nums: [1] });
    expect(machineRun(r, three, 'm2')).toMatchObject({ st: 'now', nums: [2] });
    expect(machineRun(r, three, 'm3')).toMatchObject({ st: 'next', nums: [3] });
    expect(machineRun(r, three, 'zzz').st).toBe('none');
    expect(machineRun(newRun(), three, 'm1')).toEqual({ st: 'ready', nums: [1], ms: 0 });
  });

  it('draws legs done, then current, then still to do', () => {
    const r = next(start(three, 0), three, 1000);
    expect(runRouteLegs(r, three)).toEqual([
      { from: 'm1', to: 'm2', st: 'done' },
      { from: 'm2', to: 'm3', st: 'next' },
    ]);
    expect(runRouteLegs(newRun(), three).map((l) => l.st)).toEqual(['ready', 'ready']);
  });

  it('formats clocks', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(65_000)).toBe('01:05');
    expect(fmtClock(3_723_000)).toBe('1:02:03');
    expect(fmtClock(-5)).toBe('00:00');
  });
});

/* ---------------------------------------------------------------- parity with the prototype */
const proto = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'prototype', 'zone-planner-v11.html'),
  'utf8',
);
function slice(from: string, to: string): string {
  const a = proto.indexOf(from);
  const b = proto.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`prototype markers not found: ${from}`);
  return proto.slice(a, b);
}
const sandbox = {
  state: { session: { items: [] as SessionItem[] }, run: newRun() as unknown },
  getEq: (id: string) => ({ id }),
};
const reference = runInNewContext(
  `${slice('function stepIdx(uid)', 'function reconcileRun')}
   ${slice('function stepState(uid)', 'var RUN_WORD')}
   ${slice('function pad2(n)', 'var RUN_WORD')}
   ${slice('function runRouteSegs()', 'function segSvg')}
   ({ nextUndone, stepState, machineRun, fmtClock, runRouteSegs })`,
  sandbox,
) as {
  nextUndone: (u: string | null) => string | null;
  stepState: (u: string) => string;
  machineRun: (e: string) => { st: string; nums: number[]; ms: number };
  fmtClock: (ms: number) => string;
  runRouteSegs: () => { a: { id: string }; b: { id: string }; st: string }[];
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('agrees with the prototype on random runs', () => {
  it('nextUndone, stepState, machineRun, runRouteLegs and fmtClock over 300 random runs', () => {
    const random = rng(4242);
    for (let n = 0; n < 300; n++) {
      const count = 1 + Math.floor(random() * 6);
      const items = Array.from({ length: count }, (_, i) => item(`u${i}`, `m${Math.floor(random() * 4)}`));
      let r: RunState = start(items, 0);
      let now = 0;
      const steps = Math.floor(random() * 12);
      for (let s = 0; s < steps && r.status !== 'idle'; s++) {
        now += Math.floor(random() * 90_000);
        const roll = random();
        if (roll < 0.45) r = next(r, items, now);
        else if (roll < 0.6) r = back(r, now);
        else if (roll < 0.7) r = pause(r, now);
        else if (roll < 0.8) r = resume(r, now);
        else r = jump(r, items[Math.floor(random() * count)]!.uid, now);
      }
      sandbox.state.session.items = items;
      sandbox.state.run = JSON.parse(JSON.stringify(r));
      for (const it of items) {
        expect(stepState(r, it.uid)).toBe(reference.stepState(it.uid));
        expect(machineRun(r, items, it.eid)).toEqual(reference.machineRun(it.eid));
        expect(nextUndone(r, items, it.uid)).toBe(reference.nextUndone(it.uid));
      }
      expect(nextUndone(r, items, null)).toBe(reference.nextUndone(null));
      const legs = runRouteLegs(r, items).map((l) => ({ a: l.from, b: l.to, st: l.st }));
      expect(legs).toEqual(reference.runRouteSegs().map((q) => ({ a: q.a.id, b: q.b.id, st: q.st })));
      expect(fmtClock(r.total)).toBe(reference.fmtClock(r.total));
    }
  });
});

describe('ending early', () => {
  it('stops the clock, keeps completed steps and marks the rest skipped', () => {
    let r = next(start(three, 0), three, 1000);
    r = finish(r, 4000);
    expect(r).toMatchObject({ status: 'finished', cur: null, total: 4000, order: ['a'] });
    expect(three.map((i) => stepState(r, i.uid))).toEqual(['done', 'skip', 'skip']);
    expect(finish(r, 9000)).toBe(r); // already finished
    expect(finish(newRun(), 1)).toEqual(newRun());
  });
});
