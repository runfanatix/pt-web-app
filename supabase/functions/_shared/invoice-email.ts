/**
 * The email a client gets with their monthly invoice. Plain TypeScript with no imports, so the Edge Function (Deno)
 * and the unit tests (Node) both use it. The wording is a placeholder until there is a brand.
 */
export interface InvoiceEmailInput {
  trainerName: string;
  clientName: string;
  number: string;
  /** "December 2026" */
  monthLabel: string;
  /** "R1 800,00" */
  total: string;
  /** "Tuesday 1 December 2026" */
  due: string;
  lines: { description: string; amount: string }[];
  bankDetails: string;
  paymentLink: string;
  terms: string;
  portalUrl: string;
  productName: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function invoiceEmail(i: InvoiceEmailInput): { subject: string; text: string; html: string } {
  const first = i.clientName.trim().split(/\s+/)[0] || 'there';
  const trainer = i.trainerName.trim() || 'Your trainer';
  const subject = `Invoice ${i.number} from ${trainer}: ${i.total} for ${i.monthLabel}`;
  const text = [
    `Hi ${first},`,
    '',
    `Here is your invoice for your ${i.monthLabel} sessions with ${trainer}.`,
    '',
    ...i.lines.map((l) => `${l.description}: ${l.amount}`),
    `Total due: ${i.total} by ${i.due}`,
    '',
    ...(i.paymentLink ? [`Pay online: ${i.paymentLink}`, ''] : []),
    ...(i.bankDetails
      ? ['Or pay by EFT:', i.bankDetails, `Use ${i.number} as the payment reference.`, '']
      : []),
    `You can also see and download your invoice at ${i.portalUrl}`,
    ...(i.terms ? ['', i.terms] : []),
    '',
    `Thank you, ${trainer}`,
  ].join('\n');
  const rows = i.lines
    .map(
      (l) =>
        `<tr><td style="padding:4px 0">${esc(l.description)}</td><td style="padding:4px 0;text-align:right">${esc(l.amount)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2330;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<p>Hi ${esc(first)},</p>
<p>Here is your invoice <b>${esc(i.number)}</b> for your ${esc(i.monthLabel)} sessions with ${esc(trainer)}.</p>
<table style="width:100%;border-collapse:collapse;border-top:1px solid #ccd;border-bottom:1px solid #ccd">${rows}
<tr><td style="padding:8px 0"><b>Total due by ${esc(i.due)}</b></td><td style="padding:8px 0;text-align:right"><b>${esc(i.total)}</b></td></tr></table>
${i.paymentLink ? `<p><a href="${esc(i.paymentLink)}" style="display:inline-block;background:#1c2330;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Pay online</a></p>` : ''}
${i.bankDetails ? `<p><b>Pay by EFT</b><br>${esc(i.bankDetails).replace(/\n/g, '<br>')}<br>Reference: ${esc(i.number)}</p>` : ''}
<p style="color:#6b7280;font-size:13px">You can also see and download this invoice at <a href="${esc(i.portalUrl)}">${esc(i.portalUrl)}</a>.</p>
${i.terms ? `<p style="color:#6b7280;font-size:13px">${esc(i.terms)}</p>` : ''}
<p>Thank you,<br>${esc(trainer)}</p>
</body></html>`;
  return { subject, text, html };
}
