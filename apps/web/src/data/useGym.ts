import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GymSummarySchema, type GymSummary } from '@pt/core';

export type GymState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; gyms: GymSummary[] };

/**
 * Loads the signed-in trainer's gyms. Row-level security means the query returns only this trainer's rows,
 * so there is no trainer filter here on purpose. Results are validated before the UI uses them.
 */
export async function fetchGyms(client: SupabaseClient): Promise<GymSummary[]> {
  const { data, error } = await client
    .from('gyms')
    .select('id, name, branch, address, phone, notes, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return GymSummarySchema.array().parse(data ?? []);
}

/** The trainer's gyms. `refresh` reads them again without blanking the screen (after adding, editing or deleting one). */
export function useGyms(client: SupabaseClient): GymState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<GymState>({ status: 'loading' });
  const refresh = useCallback(async () => {
    setState({ status: 'ready', gyms: await fetchGyms(client) });
  }, [client]);
  useEffect(() => {
    let active = true;
    fetchGyms(client).then(
      (gyms) => active && setState({ status: 'ready', gyms }),
      (err: unknown) =>
        active && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      active = false;
    };
  }, [client]);
  return { ...state, refresh };
}
