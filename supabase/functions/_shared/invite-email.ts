/**
 * The email a client gets when their trainer invites them to the portal. Plain TypeScript with no imports, so the
 * Edge Function (Deno) and the unit tests (Node) both use it. The wording is a placeholder until there is a brand.
 */
export interface InviteEmailInput {
  trainerName: string;
  clientName: string;
  portalUrl: string;
  productName: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inviteEmail(i: InviteEmailInput): { subject: string; text: string; html: string } {
  const first = i.clientName.trim().split(/\s+/)[0] || 'there';
  const trainer = i.trainerName.trim() || 'Your trainer';
  const subject = `${trainer} has invited you to ${i.productName}`;
  const text = [
    `Hi ${first},`,
    '',
    `${trainer} has set up a place for you to see your training programmes, your gym plan and your privacy choices.`,
    '',
    'To open it, go to the link below and enter this email address. We will email you a one-time sign-in link: no password needed.',
    '',
    i.portalUrl,
    '',
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2330;line-height:1.5;max-width:520px;margin:0 auto;padding:16px">
<p>Hi ${esc(first)},</p>
<p>${esc(trainer)} has set up a place for you to see your training programmes, your gym plan and your privacy choices.</p>
<p>Open it with the button below and enter this email address. We will email you a one-time sign-in link: no password needed.</p>
<p><a href="${esc(i.portalUrl)}" style="display:inline-block;background:#1c2330;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Open my ${esc(i.productName)}</a></p>
<p style="color:#6b7280;font-size:13px">If the button does not work, copy this link into your browser:<br>${esc(i.portalUrl)}</p>
<p style="color:#6b7280;font-size:13px">If you were not expecting this, you can ignore this email.</p>
</body></html>`;
  return { subject, text, html };
}
