import { useEffect, useReducer } from 'react';
import {
  emptySession,
  loadDraft,
  saveDraft,
  sessionReducer,
  type Action,
  type SessionState,
} from './sessionState.ts';

interface Scoped {
  /** Which gym this session belongs to; the draft is only written for the gym it was loaded for. */
  gymId: string | null;
  session: SessionState;
}

type ScopedAction = Action | { type: 'switch'; gymId: string | null; session: SessionState };

function reducer(state: Scoped, a: ScopedAction): Scoped {
  if (a.type === 'switch') return { gymId: a.gymId, session: a.session };
  return { ...state, session: sessionReducer(state.session, a) };
}

/** The routine being built for the open gym, kept as a draft in this browser. */
export function useSession(gymId: string | null) {
  const [state, dispatch] = useReducer(reducer, undefined, (): Scoped => ({
    gymId,
    session: (gymId && loadDraft(gymId)) || emptySession(),
  }));

  // Switching gym swaps in that gym's draft (or a blank routine).
  useEffect(() => {
    if (state.gymId !== gymId) {
      dispatch({ type: 'switch', gymId, session: (gymId && loadDraft(gymId)) || emptySession() });
    }
  }, [gymId, state.gymId]);

  // Persist only once the state belongs to the open gym, so one gym's routine never lands in another's draft.
  useEffect(() => {
    if (gymId && state.gymId === gymId) saveDraft(gymId, state.session);
  }, [gymId, state]);

  return { session: state.session, dispatch: dispatch as (a: Action) => void };
}
