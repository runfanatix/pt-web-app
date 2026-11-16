/**
 * Invoicing: money in South African rand (whole cents), the invoice rows the database returns, the trainer's
 * invoice settings, and the messages sent with an invoice. Pure. The invoices themselves are made by the database
 * (`generate_invoices` and `run_auto_invoicing`), so the maths here mirrors that, it does not replace it.
 */
import { z } from 'zod';
import { addDays, addMonths, longDate, monthName, todaySast } from './calendar.ts';

/* ---------------------------------------------------------------- money */

/** 123456 -> "R1 234,56" (South African style: a space for thousands, a comma for cents). */
export function rand(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${neg ? '-' : ''}R${whole},${String(abs % 100).padStart(2, '0')}`;
}

/** What a trainer types for an amount ("450", "450,50", "R 1 200.5") as cents, or null when it is not an amount. */
export function parseRand(text: string): number | null {
  const t = text.replace(/[Rr\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export interface Line {
  description: string;
  quantity: number;
  unitCents: number;
}

/** The totals the database works out from the lines: each line is quantity x price, VAT is on the subtotal. */
export function invoiceTotals(
  lines: Line[],
  vatPercent: number,
): { subtotal: number; vat: number; total: number } {
  const subtotal = lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCents), 0);
  const vat = Math.round((subtotal * vatPercent) / 100);
  return { subtotal, vat, total: subtotal + vat };
}

/* ---------------------------------------------------------------- the trainer's settings */

export const InvoiceSettingsSchema = z.object({
  defaultRate: z.number().int().min(0).max(10_000_000).nullable(),
  vatPercent: z.number().min(0).max(100),
  prefix: z.string().regex(/^[A-Za-z0-9-]{1,10}$/, 'Use up to 10 letters, numbers or dashes.'),
  bankDetails: z.string().max(600),
  paymentLink: z
    .string()
    .max(300)
    .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'A payment link must start with https://'),
  terms: z.string().max(600),
  auto: z.boolean(),
  daysBefore: z.number().int().min(0).max(25),
  autoSend: z.boolean(),
});
export type InvoiceSettings = z.infer<typeof InvoiceSettingsSchema>;

export const defaultInvoiceSettings = (): InvoiceSettings => ({
  defaultRate: null,
  vatPercent: 0,
  prefix: 'INV',
  bankDetails: '',
  paymentLink: '',
  terms: '',
  auto: false,
  daysBefore: 5,
  autoSend: false,
});

export const SETTINGS_SELECT =
  'default_rate_cents, vat_percent, invoice_prefix, bank_details, payment_link, invoice_terms, auto_invoice, invoice_days_before, auto_send, business_name, address, contact_email, contact_phone';

const SettingsRow = z.object({
  default_rate_cents: z.number().nullable(),
  vat_percent: z.coerce.number(),
  invoice_prefix: z.string(),
  bank_details: z.string(),
  payment_link: z.string(),
  invoice_terms: z.string(),
  auto_invoice: z.boolean(),
  invoice_days_before: z.number(),
  auto_send: z.boolean(),
});
export function settingsFromRow(raw: unknown): InvoiceSettings {
  const r = SettingsRow.parse(raw);
  return {
    defaultRate: r.default_rate_cents,
    vatPercent: r.vat_percent,
    prefix: r.invoice_prefix,
    bankDetails: r.bank_details,
    paymentLink: r.payment_link,
    terms: r.invoice_terms,
    auto: r.auto_invoice,
    daysBefore: r.invoice_days_before,
    autoSend: r.auto_send,
  };
}
export function settingsToRow(s: InvoiceSettings) {
  return {
    default_rate_cents: s.defaultRate,
    vat_percent: s.vatPercent,
    invoice_prefix: s.prefix.trim(),
    bank_details: s.bankDetails.trim(),
    payment_link: s.paymentLink.trim(),
    invoice_terms: s.terms.trim(),
    auto_invoice: s.auto,
    invoice_days_before: s.daysBefore,
    auto_send: s.autoSend,
  };
}

/** The day the automatic job makes next month's invoices, given today (South African date) and the setting. */
export function autoInvoiceDay(today: string, daysBefore: number): string {
  const nextFirst = addMonths(`${today.slice(0, 7)}-01`, 1);
  return addDays(nextFirst, -1 - daysBefore);
}

/** First of next month, for the "generate next month's invoices" button. */
export const nextMonthStart = (today: string = todaySast()): string =>
  addMonths(`${today.slice(0, 7)}-01`, 1);

export const monthLabel = (monthStart: string): string =>
  `${monthName(Number(monthStart.slice(5, 7)))} ${monthStart.slice(0, 4)}`;

/* ---------------------------------------------------------------- invoices */

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  void: 'Cancelled',
};
export const PAY_METHODS = ['eft', 'cash', 'card', 'other'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  eft: 'EFT',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
};

export interface InvoiceLine extends Line {
  id: string;
  amountCents: number;
}
export interface Invoice {
  id: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  number: string;
  /** First day of the month the invoice is for. */
  periodStart: string;
  issuedOn: string;
  dueOn: string;
  status: InvoiceStatus;
  vatPercent: number;
  subtotal: number;
  vat: number;
  total: number;
  notes: string;
  autoGenerated: boolean;
  /** Set when an automatic invoice is waiting to be emailed. */
  emailQueuedAt: string | null;
  emailedAt: string | null;
  paidAt: string | null;
  paidMethod: PayMethod | null;
  lines: InvoiceLine[];
}

export const INVOICES_SELECT =
  'id, client_id, client_name, client_email, number, period_start, issued_on, due_on, status, vat_percent, subtotal_cents, vat_cents, total_cents, notes, auto_generated, email_queued_at, emailed_at, paid_at, paid_method,' +
  ' invoice_lines(id, position, description, quantity, unit_cents, amount_cents)';

const LineRow = z.object({
  id: z.string(),
  position: z.number(),
  description: z.string(),
  quantity: z.coerce.number(),
  unit_cents: z.number(),
  amount_cents: z.number(),
});
const InvoiceRow = z.object({
  id: z.string(),
  client_id: z.string().nullable(),
  client_name: z.string(),
  client_email: z.string(),
  number: z.string(),
  period_start: z.string(),
  issued_on: z.string(),
  due_on: z.string(),
  status: z.enum(INVOICE_STATUSES),
  vat_percent: z.coerce.number(),
  subtotal_cents: z.number(),
  vat_cents: z.number(),
  total_cents: z.number(),
  notes: z.string(),
  auto_generated: z.boolean(),
  email_queued_at: z.string().nullable(),
  emailed_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  paid_method: z.enum(PAY_METHODS).nullable(),
  invoice_lines: z.array(LineRow).default([]),
});

/** Validates rows from `invoices` with their lines. Newest month first, then by number. */
export function parseInvoices(raw: unknown): Invoice[] {
  return InvoiceRow.array()
    .parse(raw)
    .map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      clientEmail: r.client_email,
      number: r.number,
      periodStart: r.period_start,
      issuedOn: r.issued_on,
      dueOn: r.due_on,
      status: r.status,
      vatPercent: r.vat_percent,
      subtotal: r.subtotal_cents,
      vat: r.vat_cents,
      total: r.total_cents,
      notes: r.notes,
      autoGenerated: r.auto_generated,
      emailQueuedAt: r.email_queued_at,
      emailedAt: r.emailed_at,
      paidAt: r.paid_at,
      paidMethod: r.paid_method,
      lines: r.invoice_lines
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          unitCents: l.unit_cents,
          amountCents: l.amount_cents,
        })),
    }))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.number.localeCompare(b.number));
}

export interface GenerationSummary {
  month: string;
  generated: number;
  invoiceIds: string[];
  skippedNoRate: string[];
  skippedExisting: number;
  skippedNoSessions: number;
}
const Summary = z.object({
  month: z.string(),
  generated: z.number(),
  invoice_ids: z.array(z.string()).nullable(),
  skipped_no_rate: z.array(z.string()).nullable(),
  skipped_existing: z.number(),
  skipped_no_sessions: z.number(),
});
export function parseGenerationSummary(raw: unknown): GenerationSummary {
  const r = Summary.parse(raw);
  return {
    month: r.month,
    generated: r.generated,
    invoiceIds: r.invoice_ids ?? [],
    skippedNoRate: r.skipped_no_rate ?? [],
    skippedExisting: r.skipped_existing,
    skippedNoSessions: r.skipped_no_sessions,
  };
}

/** A sent invoice that is past its due date and not paid. */
export const isOverdue = (i: Pick<Invoice, 'status' | 'dueOn'>, today: string = todaySast()): boolean =>
  i.status === 'sent' && i.dueOn < today;

/** What is still owed: sent invoices, and how much of it is overdue. */
export function outstanding(
  list: Invoice[],
  today: string = todaySast(),
): { count: number; owed: number; overdueCount: number; overdue: number } {
  const sent = list.filter((i) => i.status === 'sent');
  const late = sent.filter((i) => isOverdue(i, today));
  return {
    count: sent.length,
    owed: sent.reduce((n, i) => n + i.total, 0),
    overdueCount: late.length,
    overdue: late.reduce((n, i) => n + i.total, 0),
  };
}

export interface PayInfo {
  bankDetails: string;
  paymentLink: string;
  terms: string;
}

/** The message that goes with an invoice (WhatsApp or email body). */
export function invoiceMessage(
  i: Pick<Invoice, 'number' | 'periodStart' | 'total' | 'dueOn' | 'clientName'>,
  trainerName: string,
  pay: PayInfo,
): string {
  const lines = [
    `Hi ${i.clientName.trim().split(/\s+/)[0] || 'there'},`,
    '',
    `Your invoice ${i.number} for your ${monthLabel(i.periodStart)} sessions is ${rand(i.total)}, due ${longDate(i.dueOn)}.`,
  ];
  if (pay.paymentLink) lines.push('', `Pay online: ${pay.paymentLink}`);
  if (pay.bankDetails)
    lines.push('', 'Or pay by EFT:', pay.bankDetails, `Use ${i.number} as the payment reference.`);
  if (pay.terms) lines.push('', pay.terms);
  lines.push('', `Thank you, ${trainerName || 'your trainer'}`);
  return lines.join('\n');
}

/* ---------------------------------------------------------------- what the portal receives */

const PortalLine = z.object({
  description: z.string(),
  quantity: z.coerce.number(),
  unit_cents: z.number(),
  amount_cents: z.number(),
});
const PortalRow = z.object({
  id: z.string(),
  client_id: z.string().nullable(),
  number: z.string(),
  period_start: z.string(),
  issued_on: z.string(),
  due_on: z.string(),
  status: z.enum(['sent', 'paid']),
  vat_percent: z.coerce.number(),
  subtotal_cents: z.number(),
  vat_cents: z.number(),
  total_cents: z.number(),
  notes: z.string(),
  paid_at: z.string().nullable(),
  pay_online: z.boolean().default(false),
  trainer: z.object({
    business_name: z.string(),
    address: z.string(),
    contact_email: z.string(),
    contact_phone: z.string(),
    bank_details: z.string(),
    payment_link: z.string(),
    terms: z.string(),
  }),
  lines: z.array(PortalLine),
});

export interface PortalInvoice {
  id: string;
  number: string;
  periodStart: string;
  issuedOn: string;
  dueOn: string;
  status: 'sent' | 'paid';
  vatPercent: number;
  subtotal: number;
  vat: number;
  total: number;
  notes: string;
  paidAt: string | null;
  /** The trainer takes online payment (PayFast): the client can pay this invoice now. */
  payOnline: boolean;
  trainerName: string;
  trainerAddress: string;
  trainerEmail: string;
  trainerPhone: string;
  pay: PayInfo;
  lines: { description: string; quantity: number; unitCents: number; amountCents: number }[];
}

/** Validates what `portal_invoices` returned (newest month first). */
export function parsePortalInvoices(raw: unknown): PortalInvoice[] {
  if (raw === null || raw === undefined) return [];
  return PortalRow.array()
    .parse(raw)
    .map((r) => ({
      id: r.id,
      number: r.number,
      periodStart: r.period_start,
      issuedOn: r.issued_on,
      dueOn: r.due_on,
      status: r.status,
      vatPercent: r.vat_percent,
      subtotal: r.subtotal_cents,
      vat: r.vat_cents,
      total: r.total_cents,
      notes: r.notes,
      paidAt: r.paid_at,
      payOnline: r.pay_online,
      trainerName: r.trainer.business_name,
      trainerAddress: r.trainer.address,
      trainerEmail: r.trainer.contact_email,
      trainerPhone: r.trainer.contact_phone,
      pay: {
        bankDetails: r.trainer.bank_details,
        paymentLink: r.trainer.payment_link,
        terms: r.trainer.terms,
      },
      lines: r.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unit_cents,
        amountCents: l.amount_cents,
      })),
    }));
}
