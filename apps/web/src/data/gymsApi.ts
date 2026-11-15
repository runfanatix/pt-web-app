import type { SupabaseClient } from '@supabase/supabase-js';
import { GymSchema } from '@pt/core';

export interface GymMeta {
  name: string;
  branch: string;
  address: string;
  phone: string;
  notes: string;
}

/** Everything the Gyms tab needs from the database; a small seam so the UI can be tested without Supabase. */
export interface GymsApi {
  /** Makes a gym row for the signed-in trainer and returns its id. */
  create(meta: GymMeta): Promise<string>;
  update(id: string, patch: Partial<GymMeta>): Promise<void>;
  /** Deletes the gym with its floors, zones, machines and templates (history and programmes keep their rows). */
  remove(id: string): Promise<void>;
  /** Copies exercise links from machines to their copies. */
  copyLinks(copies: { from: string; to: string }[]): Promise<void>;
  /** The floors, zones and machines of every gym, counted. */
  counts(): Promise<Record<string, { floors: number; zones: number; equipment: number }>>;
}

export function createGymsApi(client: SupabaseClient, trainerId: string): GymsApi {
  return {
    async create(meta) {
      const v = GymSchema.omit({ id: true }).parse(meta);
      const { data, error } = await client
        .from('gyms')
        .insert({ trainer_id: trainerId, ...v })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return String((data as { id: string }).id);
    },
    async update(id, patch) {
      const { error } = await client.from('gyms').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async remove(id) {
      const { error } = await client.from('gyms').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async copyLinks(copies) {
      if (!copies.length) return;
      const from = copies.map((c) => c.from);
      const { data, error } = await client
        .from('exercise_equipment')
        .select('exercise_id, equipment_id')
        .in('equipment_id', from);
      if (error) throw new Error(error.message);
      const to = new Map(copies.map((c) => [c.from, c.to]));
      const rows = ((data ?? []) as { exercise_id: string; equipment_id: string }[]).map((r) => ({
        exercise_id: r.exercise_id,
        equipment_id: to.get(r.equipment_id)!,
      }));
      if (!rows.length) return;
      const ins = await client.from('exercise_equipment').insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    },
    async counts() {
      const { data, error } = await client.from('gyms').select('id, floors(id, zones(id, equipment(id)))');
      if (error) throw new Error(error.message);
      type Row = { id: string; floors?: { zones?: { equipment?: unknown[] }[] }[] };
      const out: Record<string, { floors: number; zones: number; equipment: number }> = {};
      for (const g of (data ?? []) as Row[]) {
        const floors = g.floors ?? [];
        const zones = floors.flatMap((f) => f.zones ?? []);
        out[g.id] = {
          floors: floors.length,
          zones: zones.length,
          equipment: zones.reduce((n, z) => n + (z.equipment?.length ?? 0), 0),
        };
      }
      return out;
    },
  };
}
