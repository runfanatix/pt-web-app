import type { SupabaseClient } from '@supabase/supabase-js';
import { RUNS_SELECT, historyFromRows, rowsFromEntry, type HistoryEntry } from '@pt/core';

/** What the run history needs from the database; a seam so the UI can be tested without Supabase. */
export interface HistoryApi {
  list(): Promise<HistoryEntry[]>;
  /** Saves a finished run. Saving the same id again replaces it (undo, then finish again). */
  save(entry: HistoryEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

const PAGE = 50;

export function createHistoryApi(client: SupabaseClient, trainerId: string): HistoryApi {
  return {
    async list() {
      const { data, error } = await client
        .from('runs')
        .select(RUNS_SELECT)
        .order('started_at', { ascending: false })
        .limit(PAGE);
      if (error) throw new Error(error.message);
      return historyFromRows(data ?? []);
    },

    async save(entry) {
      const { run, steps } = rowsFromEntry(trainerId, entry);
      const up = await client.from('runs').upsert(run);
      if (up.error) throw new Error(up.error.message);
      const del = await client.from('run_steps').delete().eq('run_id', entry.id);
      if (del.error) throw new Error(del.error.message);
      if (steps.length) {
        const ins = await client.from('run_steps').insert(steps);
        if (ins.error) throw new Error(ins.error.message);
      }
    },

    async remove(id) {
      const { error } = await client.from('runs').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}
