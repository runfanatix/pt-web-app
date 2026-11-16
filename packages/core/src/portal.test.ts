import { describe, expect, it } from 'vitest';
import { inviteEmail } from '../../../supabase/functions/_shared/invite-email.ts';
import { consentLabel, inviteStatus, isCoreConsent, parsePortalOverview } from './index.ts';

const raw = {
  email: 'dan@example.com',
  memberships: [
    {
      client_id: 'c1',
      client_name: 'Dan Dillon',
      trainer: {
        business_name: '',
        display_name: 'alice',
        address: '1 Main Rd',
        contact_email: 'a@x.com',
        contact_phone: '',
        information_officer_name: 'Alice',
        information_officer_email: 'io@x.com',
      },
      programmes: [
        { id: 'p1', title: 'Starter', assigned_at: '2026-11-10T08:00:00Z', gym: null, exercises: '5' },
      ],
      consents: [
        {
          purpose: 'marketing',
          detail: '',
          granted: false,
          at: '2026-11-10T08:00:00Z',
          notice_version: '1.0',
        },
      ],
    },
  ],
};

describe('the portal overview', () => {
  it('reads what the database returns, with plain defaults', () => {
    const o = parsePortalOverview(raw);
    expect(o.email).toBe('dan@example.com');
    expect(o.memberships[0]).toMatchObject({ clientId: 'c1', trainerName: 'alice' });
    expect(o.memberships[0]!.programmes[0]).toEqual({
      id: 'p1',
      title: 'Starter',
      assignedOn: '2026-11-10',
      gym: '',
      exercises: 5,
    });
    expect(o.memberships[0]!.consents[0]).toMatchObject({ purpose: 'marketing', granted: false });
  });

  it('null (not signed in) is an empty overview, and rubbish is refused', () => {
    expect(parsePortalOverview(null)).toEqual({ email: '', memberships: [] });
    expect(() => parsePortalOverview({ memberships: 'no' })).toThrow();
  });

  it('describes consents in plain words and knows which are core', () => {
    expect(consentLabel('marketing')).toBe('News and offers from my trainer');
    expect(consentLabel('sharing', 'Dr Smith')).toBe('Sharing my information with Dr Smith');
    expect(consentLabel('something-new')).toBe('something-new');
    expect(isCoreConsent('health-information')).toBe(true);
    expect(isCoreConsent('marketing')).toBe(false);
  });
});

describe('a trainer’s view of portal access', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  const open = { acceptedAt: null, revokedAt: null, expiresAt: '2026-12-01T00:00:00Z' };
  it('none, invited, active, off, expired', () => {
    expect(inviteStatus([], [], now)).toBe('none');
    expect(inviteStatus([open], [], now)).toBe('invited');
    expect(inviteStatus([{ ...open, acceptedAt: 'x' }], [{ revokedAt: null }], now)).toBe('active');
    expect(inviteStatus([{ ...open, acceptedAt: 'x' }], [{ revokedAt: 'x' }], now)).toBe('off');
    expect(inviteStatus([{ ...open, revokedAt: 'x' }], [], now)).toBe('off');
    expect(inviteStatus([{ ...open, expiresAt: '2026-11-01T00:00:00Z' }], [], now)).toBe('expired');
  });
});

describe('the invitation email', () => {
  const mail = inviteEmail({
    trainerName: 'Alice <Fitness>',
    clientName: 'Dan Dillon',
    portalUrl: 'https://app.example/portal',
    productName: 'PT Planner',
  });
  it('greets by first name, names the trainer, and has the link in text and html', () => {
    expect(mail.subject).toBe('Alice <Fitness> has invited you to PT Planner');
    expect(mail.text).toContain('Hi Dan,');
    expect(mail.text).toContain('https://app.example/portal');
    expect(mail.html).toContain('href="https://app.example/portal"');
  });
  it('escapes anything that could break the html', () => {
    expect(mail.html).toContain('Alice &lt;Fitness&gt;');
    expect(mail.html).not.toContain('<Fitness>');
  });
  it('copes with an empty name', () => {
    expect(inviteEmail({ trainerName: '', clientName: '', portalUrl: 'u', productName: 'P' }).text).toContain(
      'Hi there,',
    );
  });
});
