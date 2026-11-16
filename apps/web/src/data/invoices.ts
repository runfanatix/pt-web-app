import type { SupabaseClient } from '@supabase/supabase-js';
import {
  INVOICES_SELECT,
  SETTINGS_SELECT,
  parseGenerationSummary,
  parseInvoices,
  parsePortalInvoices,
  settingsFromRow,
  settingsToRow,
  type GenerationSummary,
  type Invoice,
  type InvoiceSettings,
  type PayMethod,
  type PortalInvoice,
} from '@pt/core';

export interface ClientRate {
  clientId: string;
  name: string;
  /** Null: the client pays the default rate. */
  rateCents: number | null;
}

export interface LineInput {
  description: string;
  quantity: number;
  unitCents: number;
}

/** What the Invoices tab needs from the database; a seam so the UI can be tested without Supabase. */
export interface InvoicesApi {
  settings(): Promise<
    InvoiceSettings & { businessName: string; address: string; email: string; phone: string }
  >;
  saveSettings(s: InvoiceSettings): Promise<void>;
  rates(): Promise<ClientRate[]>;
  setRate(clientId: string, cents: number | null): Promise<void>;
  list(): Promise<Invoice[]>;
  /** Makes the month's invoices (as drafts) for every client with sessions in it. */
  generate(monthStart: string): Promise<GenerationSummary>;
  addLine(invoiceId: string, position: number, line: LineInput): Promise<void>;
  updateLine(id: string, line: LineInput): Promise<void>;
  removeLine(id: string): Promise<void>;
  /** Sent, or back to draft. */
  setStatus(id: string, status: 'draft' | 'sent' | 'void'): Promise<void>;
  markPaid(id: string, method: PayMethod, paidOn: string): Promise<void>;
  markUnpaid(id: string): Promise<void>;
  /** Emails the invoice (Resend, through an Edge Function). False when email is not set up or failed. */
  email(id: string): Promise<boolean>;
  removeDraft(id: string): Promise<void>;
}

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export function createInvoicesApi(client: SupabaseClient, trainerId: string): InvoicesApi {
  return {
    async settings() {
      const { data, error } = await client
        .from('trainers')
        .select(SETTINGS_SELECT)
        .eq('id', trainerId)
        .maybeSingle();
      fail(error);
      const r = (data ?? {}) as Record<string, string>;
      return {
        ...settingsFromRow(data),
        businessName: r.business_name ?? '',
        address: r.address ?? '',
        email: r.contact_email ?? '',
        phone: r.contact_phone ?? '',
      };
    },
    async saveSettings(s) {
      const { error } = await client.from('trainers').update(settingsToRow(s)).eq('id', trainerId);
      fail(error);
    },
    async rates() {
      const { data, error } = await client.from('clients').select('id, name, rate_cents').order('name');
      fail(error);
      return ((data ?? []) as { id: string; name: string; rate_cents: number | null }[]).map((r) => ({
        clientId: r.id,
        name: r.name,
        rateCents: r.rate_cents ?? null,
      }));
    },
    async setRate(clientId, cents) {
      const { error } = await client.from('clients').update({ rate_cents: cents }).eq('id', clientId);
      fail(error);
    },
    async list() {
      const { data, error } = await client
        .from('invoices')
        .select(INVOICES_SELECT)
        .order('period_start', { ascending: false })
        .limit(500);
      fail(error);
      return parseInvoices(data ?? []);
    },
    async generate(monthStart) {
      const { data, error } = await client.rpc('generate_invoices', { p_month: monthStart });
      fail(error);
      return parseGenerationSummary(data);
    },
    async addLine(invoiceId, position, l) {
      const { error } = await client.from('invoice_lines').insert({
        invoice_id: invoiceId,
        position,
        description: l.description,
        quantity: l.quantity,
        unit_cents: l.unitCents,
      });
      fail(error);
    },
    async updateLine(id, l) {
      const { error } = await client
        .from('invoice_lines')
        .update({ description: l.description, quantity: l.quantity, unit_cents: l.unitCents })
        .eq('id', id);
      fail(error);
    },
    async removeLine(id) {
      const { error } = await client.from('invoice_lines').delete().eq('id', id);
      fail(error);
    },
    async setStatus(id, status) {
      const { error } = await client
        .from('invoices')
        .update({ status, ...(status === 'sent' ? { email_queued_at: null } : {}) })
        .eq('id', id);
      fail(error);
    },
    async markPaid(id, method, paidOn) {
      const { error } = await client
        .from('invoices')
        .update({
          status: 'paid',
          paid_method: method,
          paid_at: new Date(`${paidOn}T12:00:00+02:00`).toISOString(),
        })
        .eq('id', id);
      fail(error);
    },
    async markUnpaid(id) {
      const { error } = await client
        .from('invoices')
        .update({ status: 'sent', paid_method: null, paid_at: null })
        .eq('id', id);
      fail(error);
    },
    async email(id) {
      try {
        const { data, error } = await client.functions.invoke('send-invoice', { body: { invoiceId: id } });
        return !error && (data as { sent?: boolean } | null)?.sent === true;
      } catch {
        return false;
      }
    },
    async removeDraft(id) {
      const { error } = await client.from('invoices').delete().eq('id', id).eq('status', 'draft');
      fail(error);
    },
  };
}

/** The client's side: their own sent and paid invoices. */
export interface PortalInvoicesApi {
  list(): Promise<PortalInvoice[]>;
}
export function createPortalInvoicesApi(client: SupabaseClient): PortalInvoicesApi {
  return {
    async list() {
      const { data, error } = await client.rpc('portal_invoices');
      if (error) throw new Error(error.message);
      return parsePortalInvoices(data);
    },
  };
}
