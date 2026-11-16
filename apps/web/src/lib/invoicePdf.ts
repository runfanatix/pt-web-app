/**
 * An invoice as a one-page PDF: who it is from and to, the lines, the totals (with VAT when there is VAT), how to
 * pay, and the sessions it covers. Used by the trainer and by the client in the portal, so both print the same page.
 */
import { jsPDF } from 'jspdf';
import {
  INVOICE_STATUS_LABEL,
  fmtDate,
  monthLabel,
  pdfSafe,
  rand,
  type Invoice,
  type PayInfo,
  type PortalInvoice,
} from '@pt/core';

export interface InvoicePdfModel {
  number: string;
  periodStart: string;
  issuedOn: string;
  dueOn: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  vatPercent: number;
  subtotal: number;
  vat: number;
  total: number;
  notes: string;
  lines: { description: string; quantity: number; unitCents: number; amountCents: number }[];
  from: { name: string; address: string; email: string; phone: string };
  billTo: { name: string; email: string };
  pay: PayInfo;
}

export function pdfModelFromInvoice(
  i: Invoice,
  from: InvoicePdfModel['from'],
  pay: PayInfo,
): InvoicePdfModel {
  return {
    number: i.number,
    periodStart: i.periodStart,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    status: i.status,
    vatPercent: i.vatPercent,
    subtotal: i.subtotal,
    vat: i.vat,
    total: i.total,
    notes: i.notes,
    lines: i.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitCents: l.unitCents,
      amountCents: l.amountCents,
    })),
    from,
    billTo: { name: i.clientName, email: i.clientEmail },
    pay,
  };
}

export function pdfModelFromPortal(i: PortalInvoice, clientName: string): InvoicePdfModel {
  return {
    number: i.number,
    periodStart: i.periodStart,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    status: i.status,
    vatPercent: i.vatPercent,
    subtotal: i.subtotal,
    vat: i.vat,
    total: i.total,
    notes: i.notes,
    lines: i.lines,
    from: { name: i.trainerName, address: i.trainerAddress, email: i.trainerEmail, phone: i.trainerPhone },
    billTo: { name: clientName, email: '' },
    pay: i.pay,
  };
}

type RGB = [number, number, number];
const INK: RGB = [22, 33, 43];
const MUTED: RGB = [86, 101, 116];
const LINE: RGB = [198, 207, 216];
const TINT: RGB = [243, 246, 248];

const money = (c: number) => pdfSafe(rand(c).replace(/\u00a0/g, ' '));

export function buildInvoicePdf(m: InvoicePdfModel): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false });
  const W = 210;
  const M = 16;
  const R = W - M;
  let y = 22;
  const text = (s: string, x: number, yy: number, o?: { align?: 'left' | 'right' }) =>
    doc.text(pdfSafe(s), x, yy, o);
  const wrap = (s: string, w: number): string[] => doc.splitTextToSize(pdfSafe(s), w) as string[];

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  text(m.status === 'void' ? 'INVOICE (CANCELLED)' : 'INVOICE', M, y);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  text(m.number, R, y - 6, { align: 'right' });
  text(`Issued ${fmtDate(m.issuedOn)}`, R, y, { align: 'right' });
  text(`Due ${fmtDate(m.dueOn)}`, R, y + 5, { align: 'right' });
  if (m.status === 'paid') {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    text(INVOICE_STATUS_LABEL.paid.toUpperCase(), R, y + 11, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  }

  y += 16;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  text('FROM', M, y);
  text('BILL TO', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const from = [m.from.name, ...wrap(m.from.address, 80), m.from.phone, m.from.email].filter(Boolean);
  const to = [m.billTo.name, m.billTo.email].filter(Boolean);
  from.forEach((l, i) => text(l, M, y + 6 + i * 5));
  to.forEach((l, i) => text(l, 110, y + 6 + i * 5));
  y += 6 + Math.max(from.length, to.length) * 5 + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  text(`Training sessions for ${monthLabel(m.periodStart)}`, M, y);
  y += 6;

  // table header
  doc.setFillColor(...TINT);
  doc.rect(M, y, R - M, 7, 'F');
  doc.setFontSize(9);
  text('DESCRIPTION', M + 2, y + 5);
  text('QTY', 120, y + 5, { align: 'right' });
  text('PRICE', 150, y + 5, { align: 'right' });
  text('AMOUNT', R - 2, y + 5, { align: 'right' });
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const l of m.lines) {
    const d = wrap(l.description, 88);
    if (y + d.length * 5 + 6 > 270) {
      doc.addPage();
      y = 22;
    }
    d.forEach((ln, i) => text(ln, M + 2, y + 5 + i * 5));
    text(String(l.quantity), 120, y + 5, { align: 'right' });
    text(money(l.unitCents), 150, y + 5, { align: 'right' });
    text(money(l.amountCents), R - 2, y + 5, { align: 'right' });
    y += d.length * 5 + 3;
    doc.setDrawColor(...LINE);
    doc.line(M, y, R, y);
  }

  y += 8;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    text(label, 140, y, { align: 'right' });
    text(value, R - 2, y, { align: 'right' });
    y += 6;
  };
  row('Subtotal', money(m.subtotal));
  if (m.vatPercent > 0) row(`VAT (${m.vatPercent}%)`, money(m.vat));
  doc.setFontSize(12);
  row('Total due', money(m.total), true);
  doc.setFontSize(10);

  y += 6;
  const block = (title: string, body: string) => {
    if (!body.trim()) return;
    const ls = wrap(body, R - M);
    if (y + 6 + ls.length * 5 > 275) {
      doc.addPage();
      y = 22;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    text(title, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    ls.forEach((l, i) => text(l, M, y + 5 + i * 5));
    y += 5 + ls.length * 5 + 5;
  };
  if (m.status !== 'paid' && m.status !== 'void') {
    block(
      'HOW TO PAY',
      [
        m.pay.bankDetails,
        m.pay.bankDetails ? `Use ${m.number} as the payment reference.` : '',
        m.pay.paymentLink ? `Pay online: ${m.pay.paymentLink}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  block('SESSIONS', m.notes.replace(/^Sessions:\s*/, ''));
  block('TERMS', m.pay.terms);

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  text(`${m.number}  -  ${m.from.name}`, M, 290);
  return doc;
}

export function saveInvoicePdf(m: InvoicePdfModel): void {
  buildInvoicePdf(m).save(`${m.number}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_'));
}
