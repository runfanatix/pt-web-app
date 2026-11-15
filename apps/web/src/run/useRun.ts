import { useCallback, useEffect, useRef, useState } from 'react';
import {
  back as runBack,
  finish as runFinish,
  jump as runJump,
  jumpToMachine,
  newRun,
  next as runNext,
  pause as runPause,
  reconcile,
  resume as runResume,
  start as runStart,
  tick,
  type JumpResult,
  type RunState,
  type SessionItem,
} from '@pt/core';
import { useWakeLock } from './useWakeLock.ts';

/**
 * The live workout. The state machine is pure (packages/core/src/run.ts); this hook owns the clock: it ticks four
 * times a second from real timestamps (so a throttled background tab still counts correctly), keeps the screen
 * awake, and keeps the run consistent when the session's items change mid-run.
 */
export function useRun(items: SessionItem[]) {
  const [run, setRun] = useState<RunState>(newRun);
  const ref = useRef(run);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback((fn: (r: RunState) => RunState): RunState => {
    const n = fn(ref.current);
    if (n !== ref.current) {
      ref.current = n;
      setRun(n);
    }
    return n;
  }, []);

  useEffect(() => {
    if (run.status !== 'running') return;
    const id = setInterval(() => update((r) => tick(r, Date.now())), 250);
    const onVisible = () => update((r) => tick(r, Date.now()));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [run.status, update]);

  useWakeLock(run.status === 'running');

  useEffect(() => {
    update((r) => reconcile(r, items));
  }, [items, update]);

  return {
    run,
    start: () => update(() => runStart(itemsRef.current, Date.now())),
    next: () => update((r) => runNext(r, itemsRef.current, Date.now())),
    back: () => update((r) => runBack(r, Date.now())),
    pause: () => update((r) => runPause(r, Date.now())),
    resume: () => update((r) => runResume(r, Date.now())),
    finish: () => update((r) => runFinish(r, Date.now())),
    reset: () => update(() => newRun()),
    /** Jump to a step by its uid (the "Go now" button). */
    go: (uid: string) => update((r) => runJump(r, uid, Date.now())),
    /** Tapping a machine on the plan. */
    jumpToMachine: (eid: string): JumpResult => {
      const res = jumpToMachine(ref.current, itemsRef.current, eid, Date.now());
      update(() => res.run);
      return res;
    },
    /** Remember the history entry id so finishing again after an undo updates the same record. */
    markSaved: (histId: string) => update((r) => (r.histId === histId ? r : { ...r, histId })),
  };
}
