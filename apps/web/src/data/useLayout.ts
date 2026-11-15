import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FLOORS_SELECT, layoutFromFloorRows, type Layout } from '@pt/core';

export type LayoutState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; layout: Layout };

export type LayoutLoader = (gymId: string) => Promise<Layout>;

/**
 * Reads one gym's floors, zones, joined-zone parts, equipment and structures in a single request.
 * Row-level security filters to the signed-in trainer; the rows are validated before the UI draws them.
 */
export function createLayoutLoader(client: SupabaseClient): LayoutLoader {
  return async (gymId) => {
    const { data, error } = await client
      .from('floors')
      .select(FLOORS_SELECT)
      .eq('gym_id', gymId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return layoutFromFloorRows(data ?? []);
  };
}

export function useLayout(load: LayoutLoader, gymId: string | null): LayoutState {
  const [state, setState] = useState<LayoutState>({ status: gymId ? 'loading' : 'idle' });
  useEffect(() => {
    if (!gymId) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    load(gymId).then(
      (layout) => active && setState({ status: 'ready', layout }),
      (err: unknown) =>
        active && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      active = false;
    };
  }, [load, gymId]);
  return state;
}
