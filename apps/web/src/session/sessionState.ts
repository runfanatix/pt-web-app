import { z } from 'zod';
import {
  ItemSnapSchema,
  moveItem,
  type ItemSnap,
  type LibraryExercise,
  type SessionItem,
  type SessionMeta,
  itemFromExercise,
  snapsOf,
} from '@pt/core';

export interface SessionState {
  meta: SessionMeta;
  items: SessionItem[];
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function emptySession(now: Date = new Date()): SessionState {
  return { meta: { title: '', client: '', coach: '', date: todayIso(now), notes: '' }, items: [] };
}

let counter = 0;
/** Unique id for a session item (the browser's UUID where available). */
export function newUid(): string {
  counter += 1;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `u${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export type Action =
  | { type: 'add'; eid: string; exercise: LibraryExercise; uid?: string }
  | {
      type: 'update';
      uid: string;
      patch: Partial<Pick<SessionItem, 'exercise' | 'xid' | 'sets' | 'reps' | 'rest' | 'note'>>;
    }
  | { type: 'move'; uid: string; by: -1 | 1 }
  | { type: 'remove'; uid: string }
  | { type: 'clear' }
  | { type: 'meta'; patch: Partial<SessionMeta> }
  /** Replace the items (and optionally title and notes), e.g. loading a template. */
  | { type: 'load'; items: ItemSnap[]; title?: string; notes?: string }
  | { type: 'append'; items: ItemSnap[] }
  | { type: 'reset'; state: SessionState };

const fromSnap = (s: ItemSnap): SessionItem => ({ ...s, uid: newUid() });

export function sessionReducer(state: SessionState, a: Action): SessionState {
  switch (a.type) {
    case 'add':
      return { ...state, items: [...state.items, itemFromExercise(a.uid ?? newUid(), a.eid, a.exercise)] };
    case 'update':
      return { ...state, items: state.items.map((it) => (it.uid === a.uid ? { ...it, ...a.patch } : it)) };
    case 'move': {
      const i = state.items.findIndex((it) => it.uid === a.uid);
      return i < 0 ? state : { ...state, items: moveItem(state.items, i, i + a.by) };
    }
    case 'remove':
      return { ...state, items: state.items.filter((it) => it.uid !== a.uid) };
    case 'clear':
      return { ...state, items: [] };
    case 'meta':
      return { ...state, meta: { ...state.meta, ...a.patch } };
    case 'load':
      return {
        meta: {
          ...state.meta,
          ...(a.title != null ? { title: a.title } : {}),
          ...(a.notes != null ? { notes: a.notes } : {}),
        },
        items: a.items.map(fromSnap),
      };
    case 'append':
      return { ...state, items: [...state.items, ...a.items.map(fromSnap)] };
    case 'reset':
      return a.state;
  }
}

/* ---------------------------------------------------------------- draft kept on this device */

const StoredSchema = z.object({
  meta: z.object({
    title: z.string(),
    client: z.string(),
    coach: z.string(),
    date: z.string(),
    notes: z.string(),
  }),
  // uid is kept so a run in progress can still find its steps after a reload (older drafts have none).
  items: z.array(ItemSnapSchema.extend({ uid: z.string().min(1).optional() })),
});

const key = (gymId: string) => `pt-session:${gymId}`;

/**
 * The unsent routine is kept in this browser (per gym) so a reload does not lose it. It holds only the routine and
 * a guest name, never client records. Storage can be missing or full, so every access is guarded.
 */
export function loadDraft(gymId: string): SessionState | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(gymId));
    if (!raw) return null;
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      meta: parsed.data.meta,
      items: parsed.data.items.map(({ uid, ...snap }) => ({ ...snap, uid: uid ?? newUid() })),
    };
  } catch {
    return null;
  }
}

export function saveDraft(gymId: string, state: SessionState): void {
  try {
    globalThis.localStorage?.setItem(
      key(gymId),
      JSON.stringify({
        meta: state.meta,
        items: state.items.map((it) => ({ ...snapsOf([it])[0], uid: it.uid })),
      }),
    );
  } catch {
    /* storage unavailable or full: the routine simply is not kept across reloads */
  }
}
