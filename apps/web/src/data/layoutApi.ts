import type { SupabaseClient } from '@supabase/supabase-js';
import { layoutSavePayload, type Layout } from '@pt/core';

export interface LayoutApi {
  /** Saves the whole layout in one all-or-nothing step (database function `save_gym_layout`). */
  save: (gymId: string, layout: Layout) => Promise<void>;
  /** Links or unlinks one exercise and one saved machine. */
  setLink: (exerciseId: string, equipmentId: string, linked: boolean) => Promise<void>;
}

export function createLayoutApi(client: SupabaseClient): LayoutApi {
  return {
    async save(gymId, layout) {
      const { error } = await client.rpc('save_gym_layout', {
        p_gym_id: gymId,
        p_layout: layoutSavePayload(layout),
      });
      if (error) throw new Error(error.message);
    },
    async setLink(exerciseId, equipmentId, linked) {
      const q = linked
        ? client
            .from('exercise_equipment')
            .upsert({ exercise_id: exerciseId, equipment_id: equipmentId }, { ignoreDuplicates: true })
        : client
            .from('exercise_equipment')
            .delete()
            .eq('exercise_id', exerciseId)
            .eq('equipment_id', equipmentId);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
  };
}
