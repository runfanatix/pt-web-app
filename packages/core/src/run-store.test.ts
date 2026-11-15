import { describe, expect, it } from 'vitest';
import { completeSet, newRun, next, pause, start, tick } from './run.ts';
import { restoreRun, storedRun } from './run-store.ts';
import type { SessionItem } from './session.ts';

const item = (uid: string): SessionItem => ({
  uid,
  eid: `m-${uid}`,
  xid: null,
  exercise: uid,
  sets: 3,
  reps: '10',
  rest: 45,
  note: '',
});
const items = [item('a'), item('b')];
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('restoring a run after a reload', () => {
  it('a running workout comes back paused, with its time, step and set intact', () => {
    let r = start(items, 1000);
    r = tick(r, 31_000);
    r = completeSet(r, items, 32_000); // set 2, resting 45 s
    r = tick(r, 40_000); // 8 s into the rest
    const back = restoreRun(roundTrip(storedRun('g1', r)))!;
    expect(back.gymId).toBe('g1');
    expect(back.run).toMatchObject({
      status: 'paused',
      cur: 'a',
      total: 39_000,
      setNo: 2,
      restLeft: 37_000,
      startedAt: 1000,
    });
    expect(back.run.steps.a!.ms).toBe(39_000);
  });

  it('time spent with the page closed is not counted: resuming starts from now', () => {
    const r = tick(start(items, 0), 10_000);
    const { run } = restoreRun(roundTrip(storedRun('g1', r)))!;
    expect(run.total).toBe(10_000);
    expect(tick(run, 999_999).total).toBe(10_000); // paused: nothing is added until Resume
  });

  it('keeps the steps already done and their order', () => {
    const r = next(tick(start(items, 0), 5000), items, 5000);
    const { run } = restoreRun(roundTrip(storedRun('g1', r)))!;
    expect(run.order).toEqual(['a']);
    expect(run.cur).toBe('b');
    expect(run.steps.a).toEqual({ ms: 5000, done: true });
  });

  it('a paused run is restored as paused', () => {
    const r = pause(tick(start(items, 0), 3000), 3000);
    expect(restoreRun(roundTrip(storedRun('g1', r)))!.run.status).toBe('paused');
  });

  it('nothing is restored for an idle or finished run, or for garbage', () => {
    expect(restoreRun(storedRun('g1', newRun()))).toBeNull();
    const finished = next(next(start(items, 0), items, 1000), items, 2000);
    expect(finished.status).toBe('finished');
    expect(restoreRun(storedRun('g1', finished))).toBeNull();
    for (const junk of [
      null,
      'x',
      {},
      { v: 2 },
      { v: 1, gymId: 'g', run: { status: 'running' } },
      undefined,
    ]) {
      expect(restoreRun(junk)).toBeNull();
    }
  });

  it('rejects a run whose current step is missing or whose numbers are impossible', () => {
    const r = start(items, 0);
    expect(restoreRun(roundTrip(storedRun('g1', { ...r, cur: 'zzz' })))).toBeNull();
    expect(restoreRun(roundTrip(storedRun('g1', { ...r, total: -5 })))).toBeNull();
    expect(restoreRun(roundTrip(storedRun('g1', { ...r, setNo: 0 })))).toBeNull();
  });
});
