import { restoreRun, storedRun, type RunState } from '@pt/core';

const KEY = 'pt-run';

/**
 * A workout in progress is kept in this browser so a reload, a closed tab or a phone call does not lose it.
 * One run at a time. Storage can be missing or full, so every access is guarded.
 */
export function saveRunInProgress(gymId: string, run: RunState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(storedRun(gymId, run)));
  } catch {
    /* storage unavailable or full: the run simply is not kept across reloads */
  }
}

export function clearRunInProgress(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The saved run (comes back paused), or null. */
export function loadRunInProgress(): { gymId: string; run: RunState } | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? restoreRun(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
