/**
 * POPIA privacy notice and consent wording for trainers' clients, plus the rules that decide what a client's
 * consent records allow. The wording is the owner's draft (docs/07-privacy-popia.md): it is a DRAFT until an
 * attorney has reviewed it (Part E of the draft), and `NOTICE_IS_DRAFT` stays true until then.
 *
 * Pure: no storage, no UI.
 */

/** Flip to false once an attorney has approved the wording. While true the notice shows a draft banner. */
export const NOTICE_IS_DRAFT = true;
export const NOTICE_VERSION = '1.0-draft';
/** Effective date of the notice: a placeholder until the wording is approved. */
export const NOTICE_EFFECTIVE = '[DATE]';
/** Bump when the consent screens' wording changes (kept on every consent record). */
export const CONSENT_WORDING_VERSION = '1.0-draft';

/** The platform's own details. `companyName` is a placeholder until the platform company is set up. */
export const PLATFORM = {
  appName: 'PT Planner',
  companyName: '[PLATFORM COMPANY]',
  hostingPlace: 'London, United Kingdom',
} as const;

/** Years client records are kept after the last session. Placeholder: the attorney confirms the period. */
export const RETENTION_YEARS = 5;

/* ---------------------------------------------------------------- the trainer's details */

export interface TrainerProfile {
  businessName: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  informationOfficerName: string;
  informationOfficerEmail: string;
  paymentProvider: string;
  messagingProvider: string;
  studioName: string;
}

export const emptyProfile = (): TrainerProfile => ({
  businessName: '',
  address: '',
  contactEmail: '',
  contactPhone: '',
  informationOfficerName: '',
  informationOfficerEmail: '',
  paymentProvider: '',
  messagingProvider: '',
  studioName: '',
});

/** Details a client-facing notice cannot go out without. */
const REQUIRED_FIELDS: { key: keyof TrainerProfile; label: string }[] = [
  { key: 'businessName', label: 'Business or trainer name' },
  { key: 'address', label: 'Physical address' },
  { key: 'contactEmail', label: 'Contact email' },
  { key: 'informationOfficerName', label: 'Information Officer name' },
  { key: 'informationOfficerEmail', label: 'Information Officer email' },
];

/** Labels of the required details the trainer has not filled in yet. */
export function missingProfileFields(p: TrainerProfile): string[] {
  return REQUIRED_FIELDS.filter((f) => !p[f.key].trim()).map((f) => f.label);
}

const orPlaceholder = (value: string, placeholder: string): string => value.trim() || `[${placeholder}]`;

/* ---------------------------------------------------------------- Part A: the privacy notice */

export type NoticeBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: [string, string]; rows: [string, string][] };

export interface NoticeSection {
  heading: string;
  blocks: NoticeBlock[];
}

export interface NoticeOptions {
  /** Show the attorney-to-confirm notes. Defaults to NOTICE_IS_DRAFT. */
  draft?: boolean;
  retentionYears?: number;
}

/** The privacy notice, filled in with the trainer's details. Unfilled details show as [PLACEHOLDERS]. */
export function noticeSections(p: TrainerProfile, opts: NoticeOptions = {}): NoticeSection[] {
  const draft = opts.draft ?? NOTICE_IS_DRAFT;
  const years = opts.retentionYears ?? RETENTION_YEARS;
  const name = orPlaceholder(p.businessName, 'BUSINESS / TRAINER NAME');
  const app = PLATFORM.appName;
  const email = orPlaceholder(p.contactEmail, 'EMAIL');
  const phone = p.contactPhone.trim();
  const officer = orPlaceholder(p.informationOfficerName, 'INFORMATION OFFICER NAME');
  const officerEmail = orPlaceholder(p.informationOfficerEmail, 'INFORMATION OFFICER EMAIL');

  const recipients = [
    `${app} and its hosting provider, which store and process it for us.`,
    ...(p.paymentProvider.trim() ? [`${p.paymentProvider.trim()}, to process payments.`] : []),
    ...(p.messagingProvider.trim()
      ? [`${p.messagingProvider.trim()}, to send reminders and messages you have asked for.`]
      : []),
    'Your doctor or biokineticist, only if you ask us to or consent.',
    ...(p.studioName.trim() ? [`${p.studioName.trim()}, only if you ask us to or consent.`] : []),
    'Authorities, if the law requires us to.',
  ];

  return [
    {
      heading: '1. Who we are',
      blocks: [
        {
          kind: 'p',
          text: `${name} ("we", "us") is the responsible party for your personal information. Our address is ${orPlaceholder(p.address, 'PHYSICAL ADDRESS')}. You can reach us at ${email}${phone ? ` or ${phone}` : ''}. Our Information Officer is ${officer}, at ${officerEmail}.`,
        },
        {
          kind: 'p',
          text: `We use the ${app} platform, provided by ${PLATFORM.companyName}, to run our training business. ${app} stores and processes your information on our behalf and only on our instructions.`,
        },
      ],
    },
    {
      heading: '2. What we collect',
      blocks: [
        {
          kind: 'ul',
          items: [
            'About you: name, email, phone number, date of birth or age, and an emergency contact.',
            'Health information: medical history, conditions, injuries, medication, any medical clearance from your doctor or biokineticist, and answers to our health questionnaire.',
            'Training information: body measurements, goals, programmes, session notes, attendance and progress.',
            'Booking and payment information: your bookings, invoices and payment status. Card details are handled by our payment provider, not stored by us.',
            'Technical information: log-in details and basic device and usage data needed to keep the app working and secure.',
            'Optional: progress photos, but only if you choose to add them.',
          ],
        },
        {
          kind: 'p',
          text: 'Most of this comes directly from you. Some comes from your doctor or biokineticist, but only if you ask us to request it or you give it to us.',
        },
      ],
    },
    {
      heading: '3. Why we use it',
      blocks: [
        {
          kind: 'table',
          head: ['Purpose', 'Our basis under POPIA'],
          rows: [
            [
              'Assess whether you can train safely, and design, adjust and track your programme',
              'Your consent, because health information is special personal information',
            ],
            [
              'Run your account, book sessions, send session reminders, invoice you',
              'Needed to carry out our agreement with you',
            ],
            [
              'Keep records we are legally required to keep, and protect our rights if there is a dispute',
              'Legal obligation, or establishing or defending a legal right',
            ],
            [
              'Keep the app secure and working',
              'Our legitimate interest, which does not override your privacy',
            ],
            [
              'Send you news, offers or tips',
              'Your separate, optional consent only (you choose this when you sign up)',
            ],
          ],
        },
        {
          kind: 'p',
          text: 'We will not use your information for anything unrelated to these purposes without telling you first and, where the law requires it, asking for your consent.',
        },
      ],
    },
    {
      heading: '4. Do you have to give it to us?',
      blocks: [
        {
          kind: 'p',
          text: 'Giving us your information is voluntary. But we cannot train you safely without your health information, and we cannot book or bill you without your contact and booking details. If you decline, we may be unable to offer you training.',
        },
      ],
    },
    {
      heading: '5. Who we share it with',
      blocks: [
        { kind: 'p', text: 'We do not sell your information. We share it only with:' },
        { kind: 'ul', items: recipients },
        {
          kind: 'p',
          text: 'Everyone who handles your information for us must keep it confidential and secure.',
        },
      ],
    },
    {
      heading: '6. Storing your information outside South Africa',
      blocks: [
        {
          kind: 'p',
          text: `Our database is hosted on secure servers in ${PLATFORM.hostingPlace}. This means your information is transferred outside South Africa. We have taken steps to make sure it stays protected to a standard similar to POPIA, including a written data processing agreement with our hosting provider, and we ask for your consent to this in the app.${draft ? ' [ATTORNEY TO CONFIRM WORDING.]' : ''}`,
        },
      ],
    },
    {
      heading: '7. How long we keep it',
      blocks: [
        {
          kind: 'p',
          text: `We keep your information while you are our client and for ${years} years after your last session, unless the law requires a different period. After that we delete it or remove anything that identifies you.${draft ? ' [ATTORNEY TO CONFIRM PERIOD.]' : ''}`,
        },
      ],
    },
    {
      heading: '8. How we protect it',
      blocks: [
        {
          kind: 'p',
          text: 'We use access controls so that only we, and you, can see your records; encryption in transit and at rest; and regular backups. If your information is ever accessed without permission, we will tell you and the Information Regulator as soon as reasonably possible.',
        },
      ],
    },
    {
      heading: '9. Your rights',
      blocks: [
        { kind: 'p', text: 'You can ask us at any time to:' },
        {
          kind: 'ul',
          items: [
            'tell you what information we hold about you, and give you a copy;',
            'correct or delete information that is wrong, out of date, excessive or unlawfully held;',
            'stop using your information for a purpose you object to;',
            'withdraw any consent you have given. This does not affect what we did before you withdrew, and withdrawing health consent may mean we can no longer train you safely.',
          ],
        },
        {
          kind: 'p',
          text: `Write to us at ${email}, or use the Privacy and consent page in the app. We will respond within a reasonable time.`,
        },
        {
          kind: 'p',
          text: 'If you are unhappy with how we handle your information, you may complain to the Information Regulator of South Africa. Current contact details are on inforegulator.org.za.',
        },
      ],
    },
    {
      heading: '10. Under 18',
      blocks: [
        {
          kind: 'p',
          text: 'Our services are for adults. If a person under 18 trains with us, a parent or legal guardian must read this notice and give consent on their behalf.',
        },
      ],
    },
    {
      heading: '11. Changes',
      blocks: [
        {
          kind: 'p',
          text: 'If we change this notice, we will update the version and date above and tell you in the app before the change takes effect.',
        },
      ],
    },
  ];
}

/** The notice as plain text: what is stored as proof of what a client read. */
export function noticeText(p: TrainerProfile, opts: NoticeOptions = {}): string {
  const title = `Privacy Notice for ${orPlaceholder(p.businessName, 'BUSINESS / TRAINER NAME')}\nVersion ${NOTICE_VERSION}`;
  const body = noticeSections(p, opts)
    .map((s) => {
      const blocks = s.blocks
        .map((b) => {
          if (b.kind === 'p') return b.text;
          if (b.kind === 'ul') return b.items.map((i) => `- ${i}`).join('\n');
          return b.rows.map(([a, c]) => `- ${a}: ${c}`).join('\n');
        })
        .join('\n');
      return `${s.heading}\n${blocks}`;
    })
    .join('\n\n');
  return `${title}\n\n${body}`;
}

/* ---------------------------------------------------------------- Parts B and C: consent screens */

export type ConsentType =
  'privacy-notice' | 'health-information' | 'hosting-abroad' | 'guardian' | 'sharing' | 'marketing';

/** Needed to train a client at all. A guardian's consent is also required for a minor. */
export const REQUIRED_CONSENTS: ConsentType[] = ['privacy-notice', 'health-information', 'hosting-abroad'];

export interface ConsentScreen {
  type: ConsentType;
  title: string;
  /** Text shown above the tick box. */
  intro: string;
  /** The exact sentence the client ticks. Stored with the consent as proof. */
  checkbox: string;
  footnote?: string;
  required: boolean;
}

export interface ConsentVars {
  trainer: string;
  email: string;
  /** For sharing consents: who and why. */
  recipient?: string;
  purpose?: string;
  /** For a minor: the child's name. */
  child?: string;
}

/** The questionnaire notice shown at the top of any health question, at the moment it is asked. */
export const healthQuestionnaireNotice = (trainer: string): string =>
  `We ask these questions only to train you safely. Your answers are confidential, are seen only by ${trainer}, and are never sold or used for marketing.`;

/** The footer for every marketing message. */
export const marketingFooter = (v: { trainer: string; address: string }): string =>
  `You are receiving this because you agreed to hear from ${v.trainer}. To stop these messages, reply STOP. ${v.trainer}, ${v.address}.`;

export function consentScreen(type: ConsentType, v: ConsentVars): ConsentScreen {
  const t = v.trainer;
  switch (type) {
    case 'privacy-notice':
      return {
        type,
        title: 'Before we start',
        intro: `${t} will collect your contact details, health information, training records and booking and payment details to train you and run your account. Your information is stored by ${PLATFORM.appName}. You can read how we use and protect it, and your rights, in our Privacy Notice.`,
        checkbox: 'I have read the Privacy Notice.',
        required: true,
      };
    case 'health-information':
      return {
        type,
        title: 'Your health information',
        intro: `To train you safely, ${t} needs to ask about your medical history, conditions, injuries, medication and any medical clearance from your doctor or biokineticist.`,
        checkbox: `I consent to ${t} collecting and using my health information to assess whether I can train safely and to design, adjust and track my training programme.`,
        footnote: `Giving this consent is voluntary. If you decline, ${t} may not be able to train you safely. You can withdraw this consent at any time on the Privacy and consent page in the app or by emailing ${v.email}. Withdrawing does not affect what was done before you withdrew.`,
        required: true,
      };
    case 'hosting-abroad':
      return {
        type,
        title: 'Storing your information outside South Africa',
        intro: 'Your information is stored on servers outside South Africa.',
        checkbox: `I understand that ${PLATFORM.appName} stores my information on secure servers in ${PLATFORM.hostingPlace}, and I consent to this.`,
        required: true,
      };
    case 'guardian':
      return {
        type,
        title: 'Under 18',
        intro: `I am the parent or legal guardian of ${v.child ?? "[CHILD'S NAME]"}. I have read the Privacy Notice and I consent, on their behalf, to the collection and use of their information as described in the screens above.`,
        checkbox: 'I confirm that I am the parent or legal guardian and I give this consent.',
        required: true,
      };
    case 'sharing':
      return {
        type,
        title: 'Sharing with your doctor or biokineticist (optional)',
        intro:
          'Ask this again, with the person’s name filled in, each time a new person is added. One tick never covers "anyone".',
        checkbox: `I consent to ${t} sharing my relevant health and training information with ${v.recipient ?? '[DOCTOR / BIOKINETICIST NAME]'} for the purpose of ${v.purpose ?? '[PURPOSE, e.g. medical clearance or coordinating my care]'}. I understand I can withdraw this at any time.`,
        required: false,
      };
    case 'marketing':
      return {
        type,
        title: `News and offers from ${t}`,
        intro:
          'This is optional. You will still receive messages about your sessions, bookings and invoices either way.',
        checkbox: `Yes, ${t} may send me news, tips and offers about training services by email, SMS or WhatsApp. I can unsubscribe at any time.`,
        required: false,
      };
  }
}

/** The onboarding screens, in order. The guardian screen appears only for a minor. Marketing is last and optional. */
export function onboardingScreens(v: ConsentVars, minor: boolean): ConsentScreen[] {
  const order: ConsentType[] = [
    'privacy-notice',
    'health-information',
    'hosting-abroad',
    ...(minor ? (['guardian'] as const) : []),
    'marketing',
  ];
  return order.map((type) => consentScreen(type, v));
}

/* ---------------------------------------------------------------- what the records allow */

export interface ConsentRecord {
  purpose: string;
  /** e.g. the person data is shared with; '' for the other types. */
  detail: string;
  granted: boolean;
  /** ISO timestamp. */
  grantedAt: string;
  noticeVersion: string;
  wording: string;
}

export const consentKey = (purpose: string, detail = ''): string => `${purpose}|${detail}`;

/** The current state of each consent: its latest record (later timestamps win; a tie goes to the later row). */
export function currentConsents(records: ConsentRecord[]): Map<string, ConsentRecord> {
  const out = new Map<string, ConsentRecord>();
  records.forEach((r) => {
    const k = consentKey(r.purpose, r.detail);
    const prev = out.get(k);
    if (!prev || Date.parse(r.grantedAt) >= Date.parse(prev.grantedAt)) out.set(k, r);
  });
  return out;
}

export function isGranted(records: ConsentRecord[], purpose: ConsentType, detail = ''): boolean {
  return currentConsents(records).get(consentKey(purpose, detail))?.granted === true;
}

export interface OnboardingStatus {
  complete: boolean;
  missing: ConsentType[];
}

/** Which required consents are still missing. A minor also needs the guardian's consent. */
export function onboardingStatus(records: ConsentRecord[], minor: boolean): OnboardingStatus {
  const needed: ConsentType[] = [...REQUIRED_CONSENTS, ...(minor ? (['guardian'] as const) : [])];
  const missing = needed.filter((t) => !isGranted(records, t));
  return { complete: missing.length === 0, missing };
}

export type HealthAccess = 'allowed' | 'not-asked' | 'withdrawn';

/**
 * Whether health information may be collected or shown. Before consent exists it is blocked; after withdrawal
 * the records are locked (kept, not deleted) and the trainer is alerted.
 */
export function healthAccess(records: ConsentRecord[]): HealthAccess {
  const c = currentConsents(records).get(consentKey('health-information'));
  if (!c) return 'not-asked';
  return c.granted ? 'allowed' : 'withdrawn';
}

/** Is the client under 18 on `today`? An unknown date of birth counts as an adult (the trainer is not asked to guess). */
export function isMinor(dateOfBirth: string | null | undefined, today: Date = new Date()): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(`${dateOfBirth}T12:00:00`);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteen = new Date(dob);
  eighteen.setFullYear(dob.getFullYear() + 18);
  return today < eighteen;
}

/** The date a client's record is due for deletion or de-identification: `years` after the last activity. */
export function retentionDate(lastActivityIso: string, years: number = RETENTION_YEARS): string {
  const d = new Date(`${lastActivityIso}T12:00:00`);
  d.setFullYear(d.getFullYear() + years);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const isRetentionDue = (
  retentionUntil: string | null | undefined,
  today: Date = new Date(),
): boolean => !!retentionUntil && new Date(`${retentionUntil}T12:00:00`) <= today;
