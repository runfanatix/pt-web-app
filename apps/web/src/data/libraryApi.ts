import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExerciseInput } from '@pt/core';

/** What the Library tab needs from the database; a seam so the UI can be tested without Supabase. */
export interface LibraryApi {
  /** Makes one of the trainer's own exercises. Returns its id. */
  create(input: ExerciseInput): Promise<string>;
  /** Changes one of the trainer's own exercises (a shared one is refused by the database). */
  update(id: string, input: ExerciseInput): Promise<void>;
  /** Deletes one of the trainer's own exercises and its links. */
  remove(id: string): Promise<void>;
  /** Links an exercise (shared or own) to machines of the trainer's gyms. */
  addLinks(exerciseId: string, equipmentIds: string[]): Promise<void>;
  removeLinks(exerciseId: string, equipmentIds: string[]): Promise<void>;
}

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export function createLibraryApi(client: SupabaseClient, trainerId: string): LibraryApi {
  const row = (x: ExerciseInput) => ({
    name: x.name,
    muscles: x.muscles,
    level: x.level,
    sets: x.sets,
    reps: x.reps,
    rest: x.rest,
    cue: x.cue,
    link: x.link,
  });
  return {
    async create(input) {
      const { data, error } = await client
        .from('exercises')
        .insert({ trainer_id: trainerId, ...row(input) })
        .select('id')
        .single();
      fail(error);
      return String((data as { id: string }).id);
    },
    async update(id, input) {
      const { error } = await client.from('exercises').update(row(input)).eq('id', id);
      fail(error);
    },
    async remove(id) {
      const { error } = await client.from('exercises').delete().eq('id', id);
      fail(error);
    },
    async addLinks(exerciseId, equipmentIds) {
      if (!equipmentIds.length) return;
      const { error } = await client.from('exercise_equipment').upsert(
        equipmentIds.map((e) => ({ exercise_id: exerciseId, equipment_id: e })),
        { ignoreDuplicates: true },
      );
      fail(error);
    },
    async removeLinks(exerciseId, equipmentIds) {
      if (!equipmentIds.length) return;
      const { error } = await client
        .from('exercise_equipment')
        .delete()
        .eq('exercise_id', exerciseId)
        .in('equipment_id', equipmentIds);
      fail(error);
    },
  };
}
