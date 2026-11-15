import { useContext, useState } from 'react';
import { ModelsContext } from '../../data/catalogueApi.ts';
import {
  ClientSchema,
  buildClientExport,
  consentScreen,
  currentConsents,
  healthAccess,
  healthQuestionnaireNotice,
  isGranted,
  isMinor,
  isRetentionDue,
  onboardingScreens,
  onboardingStatus,
  type Client,
  type ClientRecord,
  type ConsentType,
  type ProgrammeRecord,
  type TrainerProfile,
} from '@pt/core';
import type { ClientsApi, ConsentInput } from '../../data/clients.ts';
import { copyText } from '../../lib/clipboard.ts';
import { ConfirmButton } from '../ConfirmButton.tsx';
import { buildShare } from '../../lib/shareModel.ts';
import type { ShareApi } from '../../data/share.ts';
import { ConsentWizard } from './ConsentWizard.tsx';
import { SharePanel } from './SharePanel.tsx';
import type { ShareContext } from './shareContext.ts';
import { NoticeView } from './NoticeView.tsx';

interface Props {
  record: ClientRecord;
  profile: TrainerProfile;
  api: ClientsApi;
  onBack: () => void;
  /** Reload the client list after a change. */
  onChanged: () => Promise<void>;
  onOpenProgramme: (p: ProgrammeRecord, client: { id: string; name: string }) => void;
  say: (msg: string) => void;
  shareApi?: ShareApi | null;
  shareContext?: ShareContext | null;
}

const SUBSCRIPTIONS = ['active', 'trial', 'paused', 'expired'] as const;
const CONSENT_LABEL: Record<string, string> = {
  'privacy-notice': 'Privacy notice read',
  'health-information': 'Health information',
  'hosting-abroad': 'Storing information outside South Africa',
  guardian: 'Parent or guardian consent',
  sharing: 'Sharing with',
  marketing: 'News and offers',
};

export function ClientDetail({
  record,
  profile,
  api,
  onBack,
  onChanged,
  onOpenProgramme,
  say,
  shareApi = null,
  shareContext = null,
}: Props) {
  const models = useContext(ModelsContext);
  const [draft, setDraft] = useState<Client>(record.client);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [notice, setNotice] = useState(false);
  const [exportText, setExportText] = useState('');
  const [shareTo, setShareTo] = useState({ person: '', purpose: '', ticked: false });
  const [marketingTick, setMarketingTick] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);

  const c = record.client;
  const minor = isMinor(c.dateOfBirth);
  const status = onboardingStatus(record.consents, minor);
  const health = healthAccess(record.consents);
  const trainer = profile.businessName.trim() || 'your trainer';
  const vars = { trainer, email: profile.contactEmail, child: c.name };
  const current = [...currentConsents(record.consents).values()].sort((a, b) =>
    a.purpose.localeCompare(b.purpose),
  );
  const set = <K extends keyof Client>(key: K, value: Client[K]) => setDraft({ ...draft, [key]: value });

  async function run(action: () => Promise<void>, done?: string) {
    try {
      await action();
      await onChanged();
      if (done) say(done);
    } catch (err) {
      say(`Could not do that: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function save() {
    // Locked health fields keep their stored values: they are never overwritten while consent is missing.
    const toSave = health === 'allowed' ? draft : { ...draft, goals: c.goals, privateNotes: c.privateNotes };
    const parsed = ClientSchema.safeParse(toSave);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'client'}: ${i.message}`));
      return;
    }
    setErrors([]);
    setSaving(true);
    await run(() => api.update(parsed.data), 'Saved.');
    setSaving(false);
  }

  async function recordConsents(consents: ConsentInput[], thenLog?: 'consent-withdrawal') {
    await run(async () => {
      await api.recordConsents(c.id, consents);
      if (thenLog) {
        await api.logRequest({
          clientId: c.id,
          clientName: c.name,
          kind: thenLog,
          outcome: `Consent withdrawn: ${consents.map((k) => k.purpose + (k.detail ? ` (${k.detail})` : '')).join(', ')}.`,
        });
      }
    }, 'Recorded.');
  }

  async function exportData() {
    await run(async () => {
      const [runs, consents] = await Promise.all([api.clientRuns(c.id), api.consentHistory(c.id)]);
      const out = buildClientExport(record, {
        runs,
        consents,
        trainerName: profile.businessName,
        generatedOn: new Date().toISOString().slice(0, 10),
      });
      setExportText(out.text);
      const copied = await copyText(out.text);
      await api.logRequest({
        clientId: c.id,
        clientName: c.name,
        kind: 'access',
        outcome: 'A readable copy of their information was prepared.',
      });
      say(
        copied
          ? 'A readable copy was made and copied.'
          : 'A readable copy was made. Copy it from the box below.',
      );
    });
  }

  if (wizard) {
    const missingScreens = onboardingScreens(vars, minor).filter(
      (s) => status.missing.includes(s.type) && s.type !== 'marketing',
    );
    return (
      <ConsentWizard
        screens={missingScreens}
        profile={profile}
        clientName={c.name}
        onCancel={() => setWizard(false)}
        onDone={(consents) => {
          setWizard(false);
          void recordConsents(consents);
        }}
      />
    );
  }
  if (notice) return <NoticeView profile={profile} onClose={() => setNotice(false)} />;

  const sharingWording = consentScreen('sharing', {
    ...vars,
    recipient: shareTo.person.trim(),
    purpose: shareTo.purpose.trim(),
  }).checkbox;
  const marketingScreen = consentScreen('marketing', vars);
  const retentionDue = isRetentionDue(c.retentionUntil);

  return (
    <div className="stack">
      <div className="cardhead">
        <button type="button" className="btn sm" onClick={onBack}>
          ← Clients
        </button>
        <h2>{c.name}</h2>
      </div>

      {!status.complete && (
        <p className="callout warn" role="alert">
          Consent not complete: {status.missing.map((m) => CONSENT_LABEL[m] ?? m).join(', ')}.{' '}
          <button type="button" className="link" onClick={() => setWizard(true)}>
            Record consent now
          </button>
        </p>
      )}
      {health === 'withdrawn' && (
        <p className="callout warn" role="alert">
          Health consent was withdrawn. Health records are locked: kept, not deleted, and hidden here.
          Training that needs health information should stop until consent is given again.
        </p>
      )}
      {retentionDue && (
        <p className="callout warn" role="alert">
          This record is past its keep-until date ({c.retentionUntil}). Delete it or remove what identifies
          the client.
        </p>
      )}

      <section className="share" aria-label="Profile">
        <h3>Profile</h3>
        <div className="meta">
          <label className="full">
            Name
            <input type="text" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            Date of birth
            <input
              type="date"
              value={draft.dateOfBirth ?? ''}
              onChange={(e) => set('dateOfBirth', e.target.value || null)}
            />
          </label>
          <label>
            Parent or guardian {minor ? '(required: under 18)' : '(if under 18)'}
            <input
              type="text"
              value={draft.guardianName}
              onChange={(e) => set('guardianName', e.target.value)}
            />
          </label>
          <label>
            WhatsApp
            <input type="tel" value={draft.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label>
            Emergency contact
            <input
              type="text"
              value={draft.emergencyName}
              onChange={(e) => set('emergencyName', e.target.value)}
            />
          </label>
          <label>
            Emergency phone
            <input
              type="tel"
              value={draft.emergencyPhone}
              onChange={(e) => set('emergencyPhone', e.target.value)}
            />
          </label>
          <label>
            Relationship
            <input
              type="text"
              value={draft.emergencyRelation}
              onChange={(e) => set('emergencyRelation', e.target.value)}
            />
          </label>
          <label>
            Plan
            <input type="text" value={draft.plan} onChange={(e) => set('plan', e.target.value)} />
          </label>
          <label>
            Subscription
            <select
              value={draft.subStatus}
              onChange={(e) => set('subStatus', e.target.value as Client['subStatus'])}
            >
              {SUBSCRIPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sessions per week
            <input
              type="number"
              min={0}
              max={14}
              value={draft.perWeek}
              onChange={(e) =>
                set('perWeek', Math.max(0, Math.min(14, Math.round(Number(e.target.value)) || 0)))
              }
            />
          </label>
          <label>
            Sessions left
            <input
              type="number"
              value={draft.sessionsLeft}
              onChange={(e) => set('sessionsLeft', Math.round(Number(e.target.value)) || 0)}
            />
          </label>
          <label>
            Renewal date
            <input
              type="date"
              value={draft.renewal ?? ''}
              onChange={(e) => set('renewal', e.target.value || null)}
            />
          </label>
        </div>

        <h4>Health and goals</h4>
        {health === 'allowed' ? (
          <>
            <p className="sub">{healthQuestionnaireNotice(trainer)}</p>
            <label>
              Goals
              <textarea rows={2} value={draft.goals} onChange={(e) => set('goals', e.target.value)} />
            </label>
            <label>
              Private notes (health information, only you can see these)
              <textarea
                rows={3}
                value={draft.privateNotes}
                onChange={(e) => set('privateNotes', e.target.value)}
              />
            </label>
          </>
        ) : health === 'not-asked' ? (
          <p className="callout warn" role="note">
            Health questions are blocked until the client&apos;s health consent is recorded. Use &ldquo;Record
            consent now&rdquo; above.
          </p>
        ) : (
          <p className="callout warn" role="note">
            Locked: health consent was withdrawn.
          </p>
        )}
        {errors.length > 0 && (
          <ul className="callout warn" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="btnrow">
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            Save profile
          </button>
        </div>
        <p className="sub">Keep until {c.retentionUntil ?? 'not set'} (five years after the last session).</p>
      </section>

      <section className="share" aria-label="Programmes">
        <h3>Programmes ({record.programmes.length})</h3>
        {record.programmes.length === 0 ? (
          <p className="empty">
            No programmes yet. Build a routine on the plan and assign it from the Session tab.
          </p>
        ) : (
          <ul className="rows">
            {record.programmes.map((p) => (
              <li key={p.id}>
                <div className="txt">
                  <span>{p.title}</span>
                  <span className="sub">
                    {p.items.length} exercise{p.items.length === 1 ? '' : 's'} · assigned{' '}
                    {p.assignedAt.slice(0, 10)}
                  </span>
                </div>
                <div className="btnrow">
                  <button
                    type="button"
                    className="btn sm primary"
                    aria-label={`Open ${p.title} in the session`}
                    onClick={() => onOpenProgramme(p, { id: c.id, name: c.name })}
                  >
                    Open
                  </button>
                  {shareApi && shareContext && (
                    <button
                      type="button"
                      className="btn sm"
                      aria-expanded={sharing === p.id}
                      aria-label={`Share ${p.title}`}
                      onClick={() => setSharing(sharing === p.id ? null : p.id)}
                    >
                      Share
                    </button>
                  )}
                  <ConfirmButton
                    aria-label={`Delete programme ${p.title}`}
                    onConfirm={() => void run(() => api.removeProgramme(p.id), 'Programme deleted.')}
                  >
                    Delete
                  </ConfirmButton>
                </div>
                {sharing === p.id && shareApi && shareContext && (
                  <div className="full-row">
                    <SharePanel
                      programmeId={p.id}
                      title={p.title}
                      api={shareApi}
                      pdf={
                        buildShare({
                          title: p.title,
                          client: c.name,
                          coach: '',
                          date: p.assignedAt.slice(0, 10),
                          notes: p.notes,
                          gym: p.gymId === shareContext.gymId ? shareContext.gymLine : '',
                          items: p.items,
                          layout: p.gymId === shareContext.gymId ? shareContext.layout : null,
                          library: shareContext.library,
                          models,
                        }).pdf
                      }
                      whatsapp={c.whatsapp}
                      email={c.email}
                      say={say}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="share" aria-label="Privacy and consent">
        <h3>Privacy and consent</h3>
        <button type="button" className="link" onClick={() => setNotice(true)}>
          View the privacy notice
        </button>
        {current.length === 0 ? (
          <p className="empty">No consent recorded yet.</p>
        ) : (
          <ul className="rows" aria-label="Consents">
            {current.map((k) => (
              <li key={`${k.purpose}|${k.detail}`}>
                <div className="txt">
                  <span>
                    {CONSENT_LABEL[k.purpose] ?? k.purpose}
                    {k.detail ? `: ${k.detail}` : ''}
                  </span>
                  <span className="sub">
                    {k.granted ? 'Agreed' : 'Not agreed or withdrawn'} · {k.grantedAt.slice(0, 10)} · wording{' '}
                    {k.noticeVersion}
                  </span>
                </div>
                {k.granted && (
                  <ConfirmButton
                    aria-label={`Withdraw ${CONSENT_LABEL[k.purpose] ?? k.purpose}${k.detail ? ` ${k.detail}` : ''}`}
                    onConfirm={() =>
                      void recordConsents(
                        [
                          {
                            purpose: k.purpose as ConsentType,
                            detail: k.detail,
                            granted: false,
                            wording: 'Withdrawn at the client’s request.',
                          },
                        ],
                        'consent-withdrawal',
                      )
                    }
                  >
                    Withdraw
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {!isGranted(record.consents, 'marketing') && (
          <fieldset className="fs">
            <legend>News and offers (optional)</legend>
            <label className="chk">
              <input
                type="checkbox"
                checked={marketingTick}
                onChange={(e) => setMarketingTick(e.target.checked)}
              />
              <span>{marketingScreen.checkbox}</span>
            </label>
            <div className="btnrow">
              <button
                type="button"
                className="btn"
                disabled={!marketingTick}
                onClick={() =>
                  void recordConsents([
                    { purpose: 'marketing', granted: true, wording: marketingScreen.checkbox },
                  ]).then(() => setMarketingTick(false))
                }
              >
                Record opt-in
              </button>
            </div>
          </fieldset>
        )}

        <fieldset className="fs">
          <legend>Share health information with a person (optional)</legend>
          <div className="meta">
            <label>
              Doctor or biokineticist
              <input
                type="text"
                value={shareTo.person}
                onChange={(e) => setShareTo({ ...shareTo, person: e.target.value })}
              />
            </label>
            <label>
              Purpose
              <input
                type="text"
                placeholder="e.g. medical clearance"
                value={shareTo.purpose}
                onChange={(e) => setShareTo({ ...shareTo, purpose: e.target.value })}
              />
            </label>
          </div>
          <label className="chk">
            <input
              type="checkbox"
              checked={shareTo.ticked}
              onChange={(e) => setShareTo({ ...shareTo, ticked: e.target.checked })}
            />
            <span>{sharingWording}</span>
          </label>
          <div className="btnrow">
            <button
              type="button"
              className="btn"
              disabled={!shareTo.ticked || !shareTo.person.trim() || !shareTo.purpose.trim()}
              onClick={() =>
                void recordConsents([
                  {
                    purpose: 'sharing',
                    detail: shareTo.person.trim(),
                    granted: true,
                    wording: sharingWording,
                  },
                ]).then(() => setShareTo({ person: '', purpose: '', ticked: false }))
              }
            >
              Record consent for this person
            </button>
          </div>
        </fieldset>

        <h4>Their information</h4>
        <div className="btnrow">
          <button type="button" className="btn" onClick={() => void exportData()}>
            Make a readable copy
          </button>
          <ConfirmButton
            aria-label={`Delete ${c.name} and all their information`}
            onConfirm={() =>
              void (async () => {
                try {
                  await api.erase(c);
                  await onChanged();
                  say(`${c.name} and all their information were deleted.`);
                  onBack();
                } catch (err) {
                  say(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
                }
              })()
            }
          >
            Delete client and all their information
          </ConfirmButton>
        </div>
        {exportText && (
          <textarea
            readOnly
            rows={8}
            aria-label="Readable copy of the client's information"
            value={exportText}
          />
        )}
      </section>
    </div>
  );
}
