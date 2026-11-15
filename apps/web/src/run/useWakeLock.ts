import { useEffect } from 'react';

/**
 * Keeps the screen awake while `active` (a live workout), where the browser allows it. Browsers release the lock
 * when the tab is hidden, so it is asked for again when the tab becomes visible. Failure is silent: the screen
 * may simply dim.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release().catch(() => {});
        else lock = l;
      } catch {
        /* refused: the screen may dim */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
