import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { EquipRef, ItemSnap } from '@pt/core';

/** A saved routine: reusable by the trainer, stored per gym. */
export interface Template {
  id: string;
  name: string;
  notes: string;
  gymId: string;
  items: ItemSnap[];
}

/** Everything the templates feature needs from the database; a small seam so the UI can be tested without Supabase. */
export interface TemplateApi {
  list(): Promise<Template[]>;
  /** Saves under `name`, replacing the trainer's template of the same name (case-insensitive). */
  save(input: {
    gymId: string;
    name: string;
    notes: string;
    items: ItemSnap[];
  }): Promise<{ updated: boolean }>;
  remove(id: string): Promise<void>;
  /** Names and types of machines (any of the trainer's gyms), used to remap a template from another gym. */
  equipmentInfo(ids: string[]): Promise<Map<string, EquipRef>>;
}

const ItemRow = z.object({
  position: z.number(),
  equipment_id: z.string().nullable(),
  exercise_id: z.string().nullable(),
  exercise_name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  note: z.string(),
});
const TemplateRow = z.object({
  id: z.string(),
  name: z.string(),
  notes: z.string(),
  gym_id: z.string(),
  template_items: z.array(ItemRow),
});

const SELECT =
  'id, name, notes, gym_id, template_items(position, equipment_id, exercise_id, exercise_name, sets, reps, rest, note)';

export function createTemplateApi(client: SupabaseClient, trainerId: string): TemplateApi {
  return {
    async list() {
      const { data, error } = await client
        .from('templates')
        .select(SELECT)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return TemplateRow.array()
        .parse(data ?? [])
        .map((t) => ({
          id: t.id,
          name: t.name,
          notes: t.notes,
          gymId: t.gym_id,
          items: t.template_items
            .slice()
            .sort((a, b) => a.position - b.position)
            // A machine that was deleted leaves equipment_id null: keep the item so it can be remapped by exercise.
            .map((i) => ({
              eid: i.equipment_id ?? '',
              xid: i.exercise_id,
              exercise: i.exercise_name,
              sets: i.sets,
              reps: i.reps,
              rest: i.rest,
              note: i.note,
            })),
        }));
    },

    async save({ gymId, name, notes, items }) {
      const existing = await client.from('templates').select('id, name').eq('trainer_id', trainerId);
      if (existing.error) throw new Error(existing.error.message);
      const match = (existing.data ?? []).find((t) => String(t.name).toLowerCase() === name.toLowerCase());
      let id: string;
      if (match) {
        id = String(match.id);
        const upd = await client.from('templates').update({ name, notes, gym_id: gymId }).eq('id', id);
        if (upd.error) throw new Error(upd.error.message);
        const del = await client.from('template_items').delete().eq('template_id', id);
        if (del.error) throw new Error(del.error.message);
      } else {
        const ins = await client
          .from('templates')
          .insert({ trainer_id: trainerId, gym_id: gymId, name, notes })
          .select('id')
          .single();
        if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'The template was not saved');
        id = String((ins.data as { id: string }).id);
      }
      const rows = items.map((it, position) => ({
        template_id: id,
        position,
        equipment_id: it.eid || null,
        exercise_id: it.xid,
        exercise_name: it.exercise,
        sets: it.sets,
        reps: it.reps,
        rest: it.rest,
        note: it.note,
      }));
      const res = rows.length ? await client.from('template_items').insert(rows) : { error: null };
      if (res.error) {
        // Do not leave an empty template behind after a failed first save.
        if (!match) await client.from('templates').delete().eq('id', id);
        throw new Error(res.error.message);
      }
      return { updated: !!match };
    },

    async remove(id) {
      const { error } = await client.from('templates').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async equipmentInfo(ids) {
      const out = new Map<string, EquipRef>();
      if (!ids.length) return out;
      const { data, error } = await client.from('equipment').select('id, name, type').in('id', ids);
      if (error) throw new Error(error.message);
      for (const r of data ?? [])
        out.set(String(r.id), { id: String(r.id), name: String(r.name), type: String(r.type) });
      return out;
    },
  };
}

/** Looks up the signed-in trainer's id (row-level security returns only their own row). */
export async function fetchTrainerId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from('trainers').select('id').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No trainer profile found for this account');
  return String((data as { id: string }).id);
}
