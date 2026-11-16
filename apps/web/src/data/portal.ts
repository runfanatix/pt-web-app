import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsePortalHistory,
  parsePortalOverview,
  parseSharedProgramme,
  portalRunPayload,
  type HistoryEntry,
  type PortalOverview,
  type PortalWorkout,
  type PortalRequestKind,
  type SharedProgramme,
} from '@pt/core';

/** What the client portal needs from the database: only the functions a client is allowed to call. */
export interface PortalApi {
  overview(): Promise<PortalOverview>;
  programme(id: string): Promise<SharedProgramme | null>;
  /** Withdraws one consent. False if there was nothing to withdraw. */
  withdraw(clientId: string, purpose: string, detail: string): Promise<boolean>;
  request(clientId: string, kind: PortalRequestKind, note: string): Promise<boolean>;
  /** Saves a finished workout for the programme's client. Saving the same id again replaces it. */
  saveRun(programmeId: string, entry: HistoryEntry): Promise<boolean>;
  /** The person's workouts (their own and their trainer's records), newest first. */
  history(): Promise<PortalWorkout[]>;
  /** Deletes a workout the client did themselves. */
  deleteRun(id: string): Promise<boolean>;
}

export function createPortalApi(client: SupabaseClient): PortalApi {
  return {
    async overview() {
      const { data, error } = await client.rpc('portal_overview');
      if (error) throw new Error(error.message);
      return parsePortalOverview(data);
    },
    async programme(id) {
      const { data, error } = await client.rpc('portal_programme', { p_programme_id: id });
      if (error) throw new Error(error.message);
      return parseSharedProgramme(data);
    },
    async withdraw(clientId, purpose, detail) {
      const { data, error } = await client.rpc('portal_withdraw_consent', {
        p_client_id: clientId,
        p_purpose: purpose,
        p_detail: detail,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async saveRun(programmeId, entry) {
      const { data, error } = await client.rpc('portal_save_run', {
        p_programme_id: programmeId,
        p_run: portalRunPayload(entry),
      });
      if (error) throw new Error(error.message);
      return typeof data === 'string' && data.length > 0;
    },
    async history() {
      const { data, error } = await client.rpc('portal_history');
      if (error) throw new Error(error.message);
      return parsePortalHistory(data);
    },
    async deleteRun(id) {
      const { data, error } = await client.rpc('portal_delete_run', { p_run_id: id });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async request(clientId, kind, note) {
      const { data, error } = await client.rpc('portal_request', {
        p_client_id: clientId,
        p_kind: kind,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

/** Sends a sign-in link to this email (Supabase Auth). A new person is created as a client, never as a trainer. */
export async function sendSignInLink(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true, data: { role: 'client' }, emailRedirectTo: redirectTo },
  });
  if (error) throw new Error(error.message);
}
