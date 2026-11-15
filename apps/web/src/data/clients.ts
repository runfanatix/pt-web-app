import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  CLIENTS_SELECT,
  RETENTION_YEARS,
  RUNS_SELECT,
  clientRecordsFromRows,
  clientToRow,
  consentToRow,
  emptyProfile,
  historyFromRows,
  programmeToRows,
  retentionDate,
  type Client,
  type ClientRecord,
  type ConsentRecord,
  type HistoryEntry,
  type ItemSnap,
  type TrainerProfile,
} from '@pt/core';

export interface ConsentInput {
  purpose: string;
  detail?: string;
  granted: boolean;
  /** The exact text the person saw. */
  wording: string;
}

export type RequestKind = 'access' | 'correction' | 'deletion' | 'consent-withdrawal' | 'objection';

export interface DataRequest {
  id: string;
  clientName: string;
  kind: RequestKind;
  receivedAt: string;
  completedAt: string | null;
  outcome: string;
}

/** What the Clients tab needs from the database; a seam so the UI can be tested without Supabase. */
export interface ClientsApi {
  list(): Promise<ClientRecord[]>;
  /** Creates the client, then records the consents given at onboarding. Returns the new client's id. */
  create(client: Client, consents: ConsentInput[]): Promise<string>;
  update(client: Client): Promise<void>;
  /** Appends consent records (a withdrawal is a new record with granted = false). */
  recordConsents(clientId: string, consents: ConsentInput[]): Promise<void>;
  /** Every consent record for a client, with the wording they saw (for proof and for the export). */
  consentHistory(clientId: string): Promise<ConsentRecord[]>;
  /** Assigns the routine to each client as a programme. Returns how many were created. */
  assign(args: {
    clientIds: string[];
    gymId: string | null;
    title: string;
    notes: string;
    items: ItemSnap[];
  }): Promise<number>;
  removeProgramme(programmeId: string): Promise<void>;
  clientRuns(clientId: string): Promise<HistoryEntry[]>;
  /** Pushes a client's retention date out to five years after a workout. */
  extendRetention(clientId: string, lastActivityIso: string): Promise<void>;
  logRequest(r: {
    clientId: string | null;
    clientName: string;
    kind: RequestKind;
    outcome: string;
    completed?: boolean;
  }): Promise<void>;
  requests(): Promise<DataRequest[]>;
  /** Erases a client and everything about them. The request is logged first and survives the erasure. */
  erase(client: Client): Promise<void>;
}

const ConsentFullRow = z.object({
  purpose: z.string(),
  detail: z.string(),
  granted: z.boolean(),
  granted_at: z.string(),
  notice_version: z.string(),
  wording: z.string(),
});
const RequestRow = z.object({
  id: z.string(),
  client_name: z.string(),
  kind: z.enum(['access', 'correction', 'deletion', 'consent-withdrawal', 'objection']),
  received_at: z.string(),
  completed_at: z.string().nullable(),
  outcome: z.string(),
});

const fail = (e: { message: string } | null): void => {
  if (e) throw new Error(e.message);
};

export function createClientsApi(client: SupabaseClient, trainerId: string): ClientsApi {
  const api: ClientsApi = {
    async list() {
      const { data, error } = await client
        .from('clients')
        .select(CLIENTS_SELECT)
        .order('name', { ascending: true });
      fail(error);
      return clientRecordsFromRows(data ?? []);
    },

    async create(c, consents) {
      const today = new Date().toISOString().slice(0, 10);
      const row = { ...clientToRow(trainerId, c), retention_until: retentionDate(today, RETENTION_YEARS) };
      const ins = await client.from('clients').insert(row).select('id').single();
      if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'The client was not saved');
      const id = String((ins.data as { id: string }).id);
      await api.recordConsents(id, consents);
      return id;
    },

    async update(c) {
      const { trainer_id: _trainer, ...changes } = clientToRow(trainerId, c);
      void _trainer;
      const { error } = await client.from('clients').update(changes).eq('id', c.id);
      fail(error);
    },

    async recordConsents(clientId, consents) {
      if (!consents.length) return;
      const { error } = await client
        .from('consents')
        .insert(consents.map((k) => consentToRow(trainerId, clientId, k)));
      fail(error);
    },

    async consentHistory(clientId) {
      const { data, error } = await client
        .from('consents')
        .select('purpose, detail, granted, granted_at, notice_version, wording')
        .eq('client_id', clientId)
        .order('granted_at', { ascending: true });
      fail(error);
      return ConsentFullRow.array()
        .parse(data ?? [])
        .map((r) => ({
          purpose: r.purpose,
          detail: r.detail,
          granted: r.granted,
          grantedAt: r.granted_at,
          noticeVersion: r.notice_version,
          wording: r.wording,
        }));
    },

    async assign({ clientIds, gymId, title, notes, items }) {
      let made = 0;
      for (const clientId of clientIds) {
        const rows = programmeToRows(clientId, gymId, { title, notes }, items);
        const p = await client.from('programmes').insert(rows.programme).select('id').single();
        if (p.error || !p.data) throw new Error(p.error?.message ?? 'The programme was not saved');
        const programmeId = String((p.data as { id: string }).id);
        if (items.length) {
          const ins = await client.from('programme_items').insert(rows.items(programmeId));
          if (ins.error) {
            await client.from('programmes').delete().eq('id', programmeId);
            throw new Error(ins.error.message);
          }
        }
        made += 1;
      }
      return made;
    },

    async removeProgramme(programmeId) {
      const { error } = await client.from('programmes').delete().eq('id', programmeId);
      fail(error);
    },

    async clientRuns(clientId) {
      const { data, error } = await client
        .from('runs')
        .select(RUNS_SELECT)
        .eq('client_id', clientId)
        .order('started_at', { ascending: false });
      fail(error);
      return historyFromRows(data ?? []);
    },

    async extendRetention(clientId, lastActivityIso) {
      const { error } = await client
        .from('clients')
        .update({ retention_until: retentionDate(lastActivityIso, RETENTION_YEARS) })
        .eq('id', clientId);
      fail(error);
    },

    async logRequest({ clientId, clientName, kind, outcome, completed = true }) {
      const { error } = await client.from('data_requests').insert({
        trainer_id: trainerId,
        client_id: clientId,
        client_name: clientName,
        kind,
        outcome,
        completed_at: completed ? new Date().toISOString() : null,
      });
      fail(error);
    },

    async requests() {
      const { data, error } = await client
        .from('data_requests')
        .select('id, client_name, kind, received_at, completed_at, outcome')
        .order('received_at', { ascending: false })
        .limit(50);
      fail(error);
      return RequestRow.array()
        .parse(data ?? [])
        .map((r) => ({
          id: r.id,
          clientName: r.client_name,
          kind: r.kind,
          receivedAt: r.received_at,
          completedAt: r.completed_at,
          outcome: r.outcome,
        }));
    },

    async erase(c) {
      await api.logRequest({
        clientId: c.id,
        clientName: c.name,
        kind: 'deletion',
        outcome: 'Client and all their information deleted.',
      });
      const { error } = await client.from('clients').delete().eq('id', c.id);
      fail(error);
    },
  };
  return api;
}

/** The trainer's business details, used to fill in the privacy notice. */
export interface ProfileApi {
  get(): Promise<TrainerProfile>;
  save(p: TrainerProfile): Promise<void>;
}

const ProfileRow = z.object({
  business_name: z.string(),
  address: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  information_officer_name: z.string(),
  information_officer_email: z.string(),
  payment_provider: z.string(),
  messaging_provider: z.string(),
  studio_name: z.string(),
});

export function createProfileApi(client: SupabaseClient, trainerId: string): ProfileApi {
  return {
    async get() {
      const { data, error } = await client
        .from('trainers')
        .select(
          'business_name, address, contact_email, contact_phone, information_officer_name, information_officer_email, payment_provider, messaging_provider, studio_name',
        )
        .eq('id', trainerId)
        .maybeSingle();
      fail(error);
      if (!data) return emptyProfile();
      const r = ProfileRow.parse(data);
      return {
        businessName: r.business_name,
        address: r.address,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        informationOfficerName: r.information_officer_name,
        informationOfficerEmail: r.information_officer_email,
        paymentProvider: r.payment_provider,
        messagingProvider: r.messaging_provider,
        studioName: r.studio_name,
      };
    },
    async save(p) {
      const { error } = await client
        .from('trainers')
        .update({
          business_name: p.businessName.trim(),
          address: p.address.trim(),
          contact_email: p.contactEmail.trim(),
          contact_phone: p.contactPhone.trim(),
          information_officer_name: p.informationOfficerName.trim(),
          information_officer_email: p.informationOfficerEmail.trim(),
          payment_provider: p.paymentProvider.trim(),
          messaging_provider: p.messagingProvider.trim(),
          studio_name: p.studioName.trim(),
        })
        .eq('id', trainerId);
      fail(error);
    },
  };
}
