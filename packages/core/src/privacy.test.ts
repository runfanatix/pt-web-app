import { describe, expect, it } from 'vitest';
import {
  CONSENT_WORDING_VERSION,
  NOTICE_VERSION,
  PLATFORM,
  consentScreen,
  currentConsents,
  emptyProfile,
  healthAccess,
  healthQuestionnaireNotice,
  isGranted,
  isMinor,
  isRetentionDue,
  marketingFooter,
  missingProfileFields,
  noticeSections,
  noticeText,
  onboardingScreens,
  onboardingStatus,
  retentionDate,
  type ConsentRecord,
  type TrainerProfile,
} from './privacy.ts';

const profile: TrainerProfile = {
  businessName: 'Alice Fitness',
  address: '1 Main Rd, Bedfordview',
  contactEmail: 'alice@example.com',
  contactPhone: '082 000 0000',
  informationOfficerName: 'Alice Smith',
  informationOfficerEmail: 'io@example.com',
  paymentProvider: '',
  messagingProvider: '',
  studioName: '',
};
const text = (p: TrainerProfile, draft = true) => JSON.stringify(noticeSections(p, { draft }));

describe('privacy notice', () => {
  it('has the eleven sections of the draft, in order', () => {
    expect(noticeSections(profile).map((s) => s.heading)).toEqual([
      '1. Who we are',
      '2. What we collect',
      '3. Why we use it',
      '4. Do you have to give it to us?',
      '5. Who we share it with',
      '6. Storing your information outside South Africa',
      '7. How long we keep it',
      '8. How we protect it',
      '9. Your rights',
      '10. Under 18',
      '11. Changes',
    ]);
  });

  it("fills in the trainer's details, and shows [PLACEHOLDERS] for anything missing", () => {
    const filled = text(profile);
    expect(filled).toContain('Alice Fitness');
    expect(filled).toContain('1 Main Rd, Bedfordview');
    expect(filled).toContain('alice@example.com or 082 000 0000');
    expect(filled).toContain('Alice Smith');
    const blank = text(emptyProfile());
    expect(blank).toContain('[BUSINESS / TRAINER NAME]');
    expect(blank).toContain('[PHYSICAL ADDRESS]');
    expect(blank).toContain('[EMAIL]');
    expect(blank).toContain('[INFORMATION OFFICER NAME]');
  });

  it('omits the phone number and the providers a trainer does not use, and lists those they do', () => {
    const base = noticeSections(profile).find((s) => s.heading.startsWith('5.'))!;
    const list = (base.blocks.find((b) => b.kind === 'ul') as { items: string[] }).items;
    expect(list).toHaveLength(3); // the platform, the doctor or biokineticist, and authorities: nothing optional
    expect(text({ ...profile, contactPhone: '' })).not.toContain(' or 082');
    const withAll = noticeSections({
      ...profile,
      paymentProvider: 'PayFast',
      messagingProvider: 'Twilio',
      studioName: 'Virgin Active Bedfordview',
    }).find((s) => s.heading.startsWith('5.'))!;
    const items = (withAll.blocks.find((b) => b.kind === 'ul') as { items: string[] }).items;
    expect(items).toContain('PayFast, to process payments.');
    expect(items).toContain('Twilio, to send reminders and messages you have asked for.');
    expect(items).toContain('Virgin Active Bedfordview, only if you ask us to or consent.');
  });

  it('names London as the hosting place, and shows the attorney notes only while a draft', () => {
    expect(PLATFORM.hostingPlace).toBe('London, United Kingdom');
    expect(text(profile, true)).toContain('London, United Kingdom');
    expect(text(profile, true)).toContain('[ATTORNEY TO CONFIRM WORDING.]');
    expect(text(profile, true)).toContain('[ATTORNEY TO CONFIRM PERIOD.]');
    expect(text(profile, false)).not.toContain('ATTORNEY');
  });

  it('says how long records are kept, and never sells information', () => {
    expect(text(profile)).toContain('for 5 years after your last session');
    expect(text(profile)).toContain('We do not sell your information.');
    expect(JSON.stringify(noticeSections(profile, { retentionYears: 7 }))).toContain('for 7 years');
  });

  it('plain text carries the title, version and every section for the stored proof', () => {
    const t = noticeText(profile);
    expect(t.startsWith('Privacy Notice for Alice Fitness\nVersion ' + NOTICE_VERSION)).toBe(true);
    expect(t).toContain('9. Your rights');
    expect(t).toContain('- Assess whether you can train safely');
  });

  it('says which details the trainer must still fill in', () => {
    expect(missingProfileFields(emptyProfile())).toEqual([
      'Business or trainer name',
      'Physical address',
      'Contact email',
      'Information Officer name',
      'Information Officer email',
    ]);
    expect(missingProfileFields(profile)).toEqual([]);
    expect(missingProfileFields({ ...profile, address: '   ' })).toEqual(['Physical address']);
  });
});

describe('consent screens', () => {
  const v = { trainer: 'Alice Fitness', email: 'alice@example.com' };

  it('are shown in order: privacy, health, hosting, [guardian for a minor], marketing', () => {
    expect(onboardingScreens(v, false).map((s) => s.type)).toEqual([
      'privacy-notice',
      'health-information',
      'hosting-abroad',
      'marketing',
    ]);
    expect(onboardingScreens(v, true).map((s) => s.type)).toEqual([
      'privacy-notice',
      'health-information',
      'hosting-abroad',
      'guardian',
      'marketing',
    ]);
  });

  it('privacy, health, hosting and guardian are required; sharing and marketing are optional', () => {
    const req = (t: Parameters<typeof consentScreen>[0]) => consentScreen(t, v).required;
    expect(
      ['privacy-notice', 'health-information', 'hosting-abroad', 'guardian'].map((t) => req(t as never)),
    ).toEqual([true, true, true, true]);
    expect(req('sharing')).toBe(false);
    expect(req('marketing')).toBe(false);
  });

  it('health consent names the trainer, says it is voluntary, and how to withdraw', () => {
    const s = consentScreen('health-information', v);
    expect(s.checkbox).toBe(
      'I consent to Alice Fitness collecting and using my health information to assess whether I can train safely and to design, adjust and track my training programme.',
    );
    expect(s.footnote).toContain('Giving this consent is voluntary.');
    expect(s.footnote).toContain('Privacy and consent page');
    expect(s.footnote).toContain('alice@example.com');
  });

  it('hosting consent names London', () => {
    expect(consentScreen('hosting-abroad', v).checkbox).toContain('London, United Kingdom');
  });

  it('sharing consent names the person and the purpose each time', () => {
    const s = consentScreen('sharing', { ...v, recipient: 'Dr Smith', purpose: 'medical clearance' });
    expect(s.checkbox).toContain('with Dr Smith for the purpose of medical clearance');
    expect(s.checkbox).toContain('I can withdraw this at any time');
  });

  it('the guardian consent names the child; marketing is on its own screen and never says it is required', () => {
    expect(consentScreen('guardian', { ...v, child: 'Sam' }).intro).toContain('guardian of Sam');
    const m = consentScreen('marketing', v);
    expect(m.checkbox).toContain('may send me news, tips and offers');
    expect(m.intro).toContain('optional');
    expect(m.required).toBe(false);
  });

  it('has the questionnaire notice and the marketing footer', () => {
    expect(healthQuestionnaireNotice('Alice Fitness')).toContain(
      'seen only by Alice Fitness, and are never sold or used for marketing',
    );
    expect(marketingFooter({ trainer: 'Alice Fitness', address: '1 Main Rd' })).toContain('reply STOP');
    expect(CONSENT_WORDING_VERSION).toBe(NOTICE_VERSION);
  });
});

describe('what the consent records allow', () => {
  const rec = (purpose: string, granted: boolean, at: string, detail = ''): ConsentRecord => ({
    purpose,
    detail,
    granted,
    grantedAt: at,
    noticeVersion: '1.0-draft',
    wording: 'x',
  });
  const all = [
    rec('privacy-notice', true, '2026-11-01T10:00:00Z'),
    rec('health-information', true, '2026-11-01T10:01:00Z'),
    rec('hosting-abroad', true, '2026-11-01T10:02:00Z'),
  ];

  it('the latest record wins, so a withdrawal (a new row) overrides an earlier grant', () => {
    const withdrawn = [...all, rec('health-information', false, '2026-11-05T09:00:00Z')];
    expect(isGranted(all, 'health-information')).toBe(true);
    expect(isGranted(withdrawn, 'health-information')).toBe(false);
    const regranted = [...withdrawn, rec('health-information', true, '2026-11-09T09:00:00Z')];
    expect(isGranted(regranted, 'health-information')).toBe(true);
    expect(currentConsents(regranted).size).toBe(3);
  });

  it('sharing consents are tracked per person, never one tick for anyone', () => {
    const records = [...all, rec('sharing', true, '2026-11-02T10:00:00Z', 'Dr Smith')];
    expect(isGranted(records, 'sharing', 'Dr Smith')).toBe(true);
    expect(isGranted(records, 'sharing', 'Dr Jones')).toBe(false);
    expect(isGranted(records, 'sharing')).toBe(false);
  });

  it('onboarding is complete only with privacy, health and hosting (plus the guardian for a minor)', () => {
    expect(onboardingStatus([], false)).toEqual({
      complete: false,
      missing: ['privacy-notice', 'health-information', 'hosting-abroad'],
    });
    expect(onboardingStatus(all, false).complete).toBe(true);
    expect(onboardingStatus(all, true)).toEqual({ complete: false, missing: ['guardian'] });
    expect(onboardingStatus([...all, rec('guardian', true, '2026-11-01T10:03:00Z')], true).complete).toBe(
      true,
    );
    expect(
      onboardingStatus([...all, rec('privacy-notice', false, '2026-11-03T00:00:00Z')], false).missing,
    ).toEqual(['privacy-notice']);
  });

  it('health information is blocked before consent and locked after it is withdrawn', () => {
    expect(healthAccess([])).toBe('not-asked');
    expect(healthAccess(all)).toBe('allowed');
    expect(healthAccess([...all, rec('health-information', false, '2026-11-05T09:00:00Z')])).toBe(
      'withdrawn',
    );
  });

  it('marketing defaults to no: no record means not granted', () => {
    expect(isGranted(all, 'marketing')).toBe(false);
    expect(isGranted([...all, rec('marketing', true, '2026-11-02T00:00:00Z')], 'marketing')).toBe(true);
  });
});

describe('minors and retention', () => {
  it('a client is a minor until their 18th birthday; no date of birth counts as an adult', () => {
    const today = new Date('2026-11-15T12:00:00');
    expect(isMinor('2008-11-16', today)).toBe(true); // turns 18 tomorrow
    expect(isMinor('2008-11-15', today)).toBe(false); // turns 18 today
    expect(isMinor('2012-05-01', today)).toBe(true);
    expect(isMinor('1990-01-01', today)).toBe(false);
    expect(isMinor(null, today)).toBe(false);
    expect(isMinor('garbage', today)).toBe(false);
  });

  it('retention is five years after the last activity, and becomes due on that day', () => {
    expect(retentionDate('2026-11-15')).toBe('2031-11-15');
    expect(retentionDate('2026-11-15', 7)).toBe('2033-11-15');
    expect(isRetentionDue('2031-11-15', new Date('2031-11-14T12:00:00'))).toBe(false);
    expect(isRetentionDue('2031-11-15', new Date('2031-11-15T12:00:00'))).toBe(true);
    expect(isRetentionDue(null)).toBe(false);
  });
});
