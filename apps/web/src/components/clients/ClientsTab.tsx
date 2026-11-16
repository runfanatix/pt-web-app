import type { InviteApi } from '../../data/invites.ts';
import { useEffect, useState } from 'react';
import {
  ClientSchema,
  healthAccess,
  isMinor,
  isRetentionDue,
  missingProfileFields,
  onboardingScreens,
  onboardingStatus,
  type Client,
  type ClientRecord,
  type ProgrammeRecord,
  type TrainerProfile,
} from '@pt/core';
import type { ClientsApi, DataRequest, ProfileApi } from '../../data/clients.ts';
import type { ShareApi } from '../../data/share.ts';
import { BusinessDetails } from './BusinessDetails.tsx';
import type { ShareContext } from './shareContext.ts';
import { ClientDetail } from './ClientDetail.tsx';
import { ConsentWizard } from './ConsentWizard.tsx';
import { NoticeView } from './NoticeView.tsx';

interface Props {
  clients: ClientRecord[] | null;
  error: string;
  api: ClientsApi | null;
  profile: TrainerProfile | null;
  profileApi: ProfileApi | null;
  onProfileSaved: (p: TrainerProfile) => void;
  onChanged: () => Promise<void>;
  onOpenProgramme: (p: ProgrammeRecord, client: { id: string; name: string }) => void;
  say: (msg: string) => void;
  shareApi?: ShareApi | null;
  inviteApi?: InviteApi | null;
  shareContext?: ShareContext | null;
}

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'consent'; client: Client }
  | { kind: 'detail'; id: string }
  | { kind: 'notice' };

export function ClientsTab({
  clients,
  error,
  api,
  profile,
  profileApi,
  onProfileSaved,
  onChanged,
  onOpenProgramme,
  say,
  shareApi = null,
  inviteApi = null,
  shareContext = null,
}: Props) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [requests, setRequests] = useState<DataRequest[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!api || view.kind !== 'list') return;
    let live = true;
    api.requests().then(
      (r) => live && setRequests(r),
      () => live && setRequests([]),
    );
    return () => {
      live = false;
    };
  }, [api, view.kind, clients]);

  if (!api || !profileApi || !profile || clients === null) {
    return <p className="hint">{error || 'Loading clients…'}</p>;
  }
  const missing = missingProfileFields(profile);
  const trainer = profile.businessName.trim() || 'your trainer';

  if (view.kind === 'notice')
    return <NoticeView profile={profile} onClose={() => setView({ kind: 'list' })} />;

  if (view.kind === 'new') {
    return (
      <NewClient
        profile={profile}
        onCancel={() => setView({ kind: 'list' })}
        onContinue={(client) => setView({ kind: 'consent', client })}
      />
    );
  }

  if (view.kind === 'consent') {
    const minor = isMinor(view.client.dateOfBirth);
    return (
      <ConsentWizard
        screens={onboardingScreens({ trainer, email: profile.contactEmail, child: view.client.name }, minor)}
        profile={profile}
        clientName={view.client.name}
        onCancel={() => setView({ kind: 'new' })}
        onDone={(consents) =>
          void (async () => {
            try {
              const id = await api.create(view.client, consents);
              await onChanged();
              say(`${view.client.name} was added.`);
              setView({ kind: 'detail', id });
            } catch (err) {
              say(`Could not add the client: ${err instanceof Error ? err.message : String(err)}`);
              setView({ kind: 'list' });
            }
          })()
        }
      />
    );
  }

  if (view.kind === 'detail') {
    const record = clients.find((r) => r.client.id === view.id);
    if (!record) {
      return (
        <div className="stack">
          <p className="empty">That client no longer exists.</p>
          <button type="button" className="btn" onClick={() => setView({ kind: 'list' })}>
            Back to clients
          </button>
        </div>
      );
    }
    return (
      <ClientDetail
        record={record}
        profile={profile}
        api={api}
        onBack={() => setView({ kind: 'list' })}
        onChanged={onChanged}
        onOpenProgramme={onOpenProgramme}
        say={say}
        shareApi={shareApi}
        inviteApi={inviteApi}
        shareContext={shareContext}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = clients.filter((r) => !q || r.client.name.toLowerCase().includes(q));
  return (
    <div className="stack">
      <h2>Clients</h2>
      <p className="sub">
        Each profile holds contact and emergency details, subscription, goals, the programmes you assign and
        their consent. Client records are private to you.
      </p>

      {missing.length > 0 && (
        <p className="callout warn" role="alert">
          Before you add a client, fill in your business details ({missing.join(', ')}) so the privacy notice
          your client reads is complete.{' '}
          <button type="button" className="link" onClick={() => setShowDetails(true)}>
            Fill them in
          </button>
        </p>
      )}

      <div className="btnrow">
        <button
          type="button"
          className="btn primary"
          disabled={missing.length > 0}
          onClick={() => setView({ kind: 'new' })}
        >
          Add client
        </button>
        <button type="button" className="btn" onClick={() => setView({ kind: 'notice' })}>
          Privacy notice
        </button>
        <button
          type="button"
          className="btn"
          aria-expanded={showDetails}
          onClick={() => setShowDetails(!showDetails)}
        >
          Your business details
        </button>
      </div>

      {showDetails && (
        <BusinessDetails
          profile={profile}
          api={profileApi}
          onSaved={onProfileSaved}
          onViewNotice={() => setView({ kind: 'notice' })}
        />
      )}

      {clients.length > 6 && (
        <label>
          Search clients
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      {clients.length === 0 ? (
        <p className="empty">
          No clients yet. Add your first client to keep their contact details, subscription, goals, programmes
          and consent in one place.
        </p>
      ) : shown.length === 0 ? (
        <p className="empty">No clients match.</p>
      ) : (
        <ul className="rows" aria-label="Clients">
          {shown.map((r) => {
            const consent = onboardingStatus(r.consents, isMinor(r.client.dateOfBirth));
            const health = healthAccess(r.consents);
            const flags = [
              !consent.complete ? 'consent pending' : '',
              health === 'withdrawn' ? 'health locked' : '',
              isRetentionDue(r.client.retentionUntil) ? 'keep-until date passed' : '',
            ].filter(Boolean);
            return (
              <li key={r.client.id}>
                <button
                  type="button"
                  className="pick"
                  onClick={() => setView({ kind: 'detail', id: r.client.id })}
                >
                  <span className="txt">
                    <span>{r.client.name}</span>
                    <span className="sub">
                      {r.client.subStatus} · {r.programmes.length} programme
                      {r.programmes.length === 1 ? '' : 's'}
                      {flags.length ? ` · ${flags.join(', ')}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>Privacy requests</h3>
      {requests === null ? (
        <p className="sub">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="empty">No requests yet. Copies, withdrawals and deletions are logged here.</p>
      ) : (
        <ul className="rows" aria-label="Privacy requests">
          {requests.map((r) => (
            <li key={r.id}>
              <div className="txt">
                <span>
                  {r.kind} · {r.clientName || 'a client'}
                </span>
                <span className="sub">
                  {r.receivedAt.slice(0, 10)} ·{' '}
                  {r.completedAt ? `done ${r.completedAt.slice(0, 10)}` : 'open'}{' '}
                  {r.outcome ? `· ${r.outcome}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who is the new client: a name and date of birth, before any consent screen is shown. */
function NewClient({
  profile,
  onCancel,
  onContinue,
}: {
  profile: TrainerProfile;
  onCancel: () => void;
  onContinue: (c: Client) => void;
}) {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [guardian, setGuardian] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const minor = isMinor(dob || null);
  const trainer = profile.businessName.trim() || 'your trainer';

  function next() {
    const parsed = ClientSchema.safeParse({
      id: 'new',
      name,
      dateOfBirth: dob || null,
      guardianName: guardian,
    });
    const problems = parsed.success
      ? []
      : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (minor && !guardian.trim())
      problems.push('A parent or guardian name is needed for a client under 18.');
    setErrors(problems);
    if (parsed.success && !problems.length) onContinue(parsed.data);
  }

  return (
    <section className="card" aria-label="New client">
      <h3>Add a client</h3>
      <p className="sub">
        Next, {trainer}&apos;s privacy notice and consent screens are shown to the client. Hand them the phone
        then. No health questions are asked until they have agreed.
      </p>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Date of birth (needed to know if a parent or guardian must consent)
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </label>
      {minor && (
        <label>
          Parent or legal guardian (name)
          <input type="text" value={guardian} onChange={(e) => setGuardian(e.target.value)} />
        </label>
      )}
      {errors.length > 0 && (
        <ul className="callout warn" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="btnrow">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={next}>
          Continue to consent
        </button>
      </div>
    </section>
  );
}
