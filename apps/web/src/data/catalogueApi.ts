import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CATALOGUE_SELECT,
  ManufacturerInputSchema,
  ModelInputSchema,
  catalogueFromRows,
  type Catalogue,
  type ModelEntry,
  type ModelInput,
} from '@pt/core';

/** Everything the Catalogue tab needs from the database; a small seam so the UI can be tested without Supabase. */
export interface CatalogueApi {
  load(): Promise<Catalogue>;
  addManufacturer(name: string): Promise<string>;
  renameManufacturer(id: string, name: string): Promise<void>;
  /** Deletes the manufacturer and its models. Machines that used them keep their names and lose the link. */
  removeManufacturer(id: string): Promise<void>;
  addModel(manufacturerId: string, input: ModelInput): Promise<string>;
  updateModel(id: string, input: ModelInput): Promise<void>;
  removeModel(id: string): Promise<void>;
  /** How many machines (in any of the trainer's gyms) use each model. */
  usage(): Promise<Record<string, number>>;
}

const fail = (e: { message: string } | null) => {
  if (e)
    throw new Error(
      e.message.includes('duplicate key') ? 'That name or code is already in the catalogue.' : e.message,
    );
};

export function createCatalogueApi(client: SupabaseClient, trainerId: string): CatalogueApi {
  const itemRow = (i: ModelInput) => ({
    model_name: i.model,
    code: i.code,
    kind: i.kind,
    muscles: i.muscles,
    specs: i.specs,
    notes: i.notes,
  });
  return {
    async load() {
      const { data, error } = await client.from('manufacturers').select(CATALOGUE_SELECT).order('name');
      fail(error);
      return catalogueFromRows(data ?? []);
    },
    async addManufacturer(name) {
      const v = ManufacturerInputSchema.parse({ name });
      const { data, error } = await client
        .from('manufacturers')
        .insert({ trainer_id: trainerId, name: v.name })
        .select('id')
        .single();
      fail(error);
      return String((data as { id: string }).id);
    },
    async renameManufacturer(id, name) {
      const v = ManufacturerInputSchema.parse({ name });
      const { error } = await client.from('manufacturers').update({ name: v.name }).eq('id', id);
      fail(error);
    },
    async removeManufacturer(id) {
      const { error } = await client.from('manufacturers').delete().eq('id', id);
      fail(error);
    },
    async addModel(manufacturerId, input) {
      const v = ModelInputSchema.parse(input);
      const { data, error } = await client
        .from('catalogue_items')
        .insert({ trainer_id: trainerId, manufacturer_id: manufacturerId, ...itemRow(v) })
        .select('id')
        .single();
      fail(error);
      return String((data as { id: string }).id);
    },
    async updateModel(id, input) {
      const v = ModelInputSchema.parse(input);
      const { error } = await client.from('catalogue_items').update(itemRow(v)).eq('id', id);
      fail(error);
    },
    async removeModel(id) {
      const { error } = await client.from('catalogue_items').delete().eq('id', id);
      fail(error);
    },
    async usage() {
      const { data, error } = await client
        .from('equipment')
        .select('catalogue_item_id')
        .not('catalogue_item_id', 'is', null);
      fail(error);
      const out: Record<string, number> = {};
      for (const r of (data ?? []) as { catalogue_item_id: string }[])
        out[r.catalogue_item_id] = (out[r.catalogue_item_id] ?? 0) + 1;
      return out;
    },
  };
}

/** The catalogue models by id, for any screen that shows a machine. Empty until the catalogue has loaded. */
export const ModelsContext = createContext<Map<string, ModelEntry>>(new Map());

/** The catalogue model a machine is, if it has one. */
export function useModelOf(e: { catalogueId?: string | null } | undefined | null): ModelEntry | undefined {
  const models = useContext(ModelsContext);
  return e?.catalogueId ? models.get(e.catalogueId) : undefined;
}
