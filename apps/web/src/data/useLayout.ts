import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXERCISES_SELECT, FLOORS_SELECT, gymDataFromRows, type GymData } from '@pt/core';

export type GymDataState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GymData };

export type GymDataLoader = (gymId: string) => Promise<GymData>;

/**
 * Reads one gym's floors, zones, joined-zone parts, equipment and structures (with each machine's linked
 * exercises) plus the exercise library: two requests in parallel. Row-level security filters to the signed-in
 * trainer; the rows are validated before the UI uses them.
 */
export function createGymDataLoader(client: SupabaseClient): GymDataLoader {
  return async (gymId) => {
    const [floors, exercises] = await Promise.all([
      client.from('floors').select(FLOORS_SELECT).eq('gym_id', gymId).order('position', { ascending: true }),
      client.from('exercises').select(EXERCISES_SELECT).order('name', { ascending: true }),
    ]);
    if (floors.error) throw new Error(floors.error.message);
    if (exercises.error) throw new Error(exercises.error.message);
    return gymDataFromRows(floors.data ?? [], exercises.data ?? []);
  };
}

export function useGymData(load: GymDataLoader, gymId: string | null): GymDataState {
  const [state, setState] = useState<GymDataState>({ status: gymId ? 'loading' : 'idle' });
  useEffect(() => {
    if (!gymId) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    load(gymId).then(
      (data) => active && setState({ status: 'ready', data }),
      (err: unknown) =>
        active && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      active = false;
    };
  }, [load, gymId]);
  return state;
}
