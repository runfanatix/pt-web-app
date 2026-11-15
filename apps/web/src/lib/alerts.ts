/**
 * Alerts for the end of a rest: a vibration where the browser supports it (Android; iPhone Safari does not),
 * plus a short beep so there is a signal everywhere. The trainer can switch alerts off.
 */
const KEY = 'pt-rest-alert';

export function alertsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertsEnabled(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* the choice just is not remembered */
  }
}

let ctx: AudioContext | null = null;

/** Browsers only allow sound after a tap: call this from a button handler (Start, Set done). */
export function unlockAudio(): void {
  try {
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio: vibration and the on-screen change still happen */
  }
}

/** Vibrate and beep to say the rest is over. */
export function restOverAlert(): void {
  if (!alertsEnabled()) return;
  try {
    navigator.vibrate?.([250, 120, 250, 120, 450]);
  } catch {
    /* not supported */
  }
  try {
    if (!ctx) return;
    const beep = (at: number, freq: number) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx!.destination);
      osc.start(ctx!.currentTime + at);
      osc.stop(ctx!.currentTime + at + 0.18);
    };
    beep(0, 880);
    beep(0.3, 880);
    beep(0.6, 1175);
  } catch {
    /* no audio */
  }
}
