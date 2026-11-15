import { useCallback, useEffect, useRef, useState } from 'react';
import {
  back as runBack,
  completeSet as runCompleteSet,
  finish as runFinish,
  isActive,
  jump as runJump,
  jumpToMachine,
  newRun,
  next as runNext,
  pause as runPause,
  reconcile,
  resume as runResume,
  skipRest as runSkipRest,
  start as runStart,
  tick,
  type JumpResult,
  type RunState,
  type SessionItem,
} from '@pt/core';
import { restOverAlert, unlockAudio } from '../lib/alerts.ts';
import { clearRunInProgress, loadRunInProgress, saveRunInProgress } from './runStore.ts';
import { useWakeLock } from './useWakeLock.ts';

/**
 * The live workout. The state machine is pure (packages/core/src/run.ts); this hook owns the clock: it ticks four
 * times a second from real timestamps (so a throttled background tab still counts correctly), keeps the screen
 * awake, buzzes when a rest between sets ends, keeps the run consistent when the session's items change mid-run,
 * and keeps a run in progress across a reload (it comes back paused).
 */
export function useRun(items: SessionItem[], gymId: string | null) {
  const [restoredRun] = useState<RunState | null>(() => {
    const saved = loadRunInProgress();
    return saved && gymId && saved.gymId === gymId ? saved.run : null;
  });
  const [run, setRun] = useState<RunState>(() => restoredRun ?? newRun());
  const ref = useRef(run);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** True while the stored copy belongs to this hook, so it is cleared when the run ends but not before. */
  const owns = useRef(restoredRun !== null);

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

  // Keep a run in progress in the browser; forget it once it has ended or been reset.
  useEffect(() => {
    if (!gymId) return;
    if (isActive(run)) {
      owns.current = true;
      saveRunInProgress(gymId, run);
    } else if (owns.current) {
      owns.current = false;
      clearRunInProgress();
    }
  }, [run, gymId]);

  // A rest between sets that ran out by itself: vibrate and beep.
  const seenRestEnds = useRef(run.restEnds);
  useEffect(() => {
    if (run.restEnds > seenRestEnds.current) restOverAlert();
    seenRestEnds.current = run.restEnds;
  }, [run.restEnds]);

  return {
    run,
    /** True when this run was brought back after a reload (it is paused). */
    restored: restoredRun !== null,
    start: () => {
      unlockAudio();
      return update(() => runStart(itemsRef.current, Date.now()));
    },
    next: () => update((r) => runNext(r, itemsRef.current, Date.now())),
    back: () => update((r) => runBack(r, Date.now())),
    pause: () => update((r) => runPause(r, Date.now())),
    resume: () => {
      unlockAudio();
      return update((r) => runResume(r, Date.now()));
    },
    finish: () => update((r) => runFinish(r, Date.now())),
    reset: () => update(() => newRun()),
    /** The client finished a set: start the rest before the next one. */
    completeSet: () => {
      unlockAudio();
      return update((r) => runCompleteSet(r, itemsRef.current, Date.now()));
    },
    skipRest: () => update((r) => runSkipRest(r, Date.now())),
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
