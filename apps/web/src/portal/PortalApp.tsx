import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BRAND,
  REQUEST_KINDS,
  consentLabel,
  fmtDate,
  isCoreConsent,
  type PortalMembership,
  type PortalOverview,
  type SharedProgramme,
} from '@pt/core';
import { useAuth } from '../auth/AuthProvider.tsx';
import { createPortalApi, sendSignInLink, type PortalApi } from '../data/portal.ts';
import { ConfirmButton } from '../components/ConfirmButton.tsx';
import { ProgrammeView } from '../components/PublicProgramme.tsx';
import { portalLink } from '../lib/links.ts';

/** The brand mark and name: a placeholder until there is a real logo. */
function Brand() {
  return (
    <div className="brand">
      <span className="brandmark" aria-hidden="true">
        {BRAND.mark}
      </span>
      <span>
        <strong>{BRAND.productName}</strong> <span className="sub">{BRAND.portalName}</span>
      </span>
    </div>
  );
}

/** Asks for an email address and sends the one-time sign-in link. No password. */
function PortalSignIn({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter your email address.');
    setState('sending');
    try {
      await sendSignInLink(client, email, portalLink());
      setState('sent');
    } catch (err) {
      setState('form');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="wrap narrow">
      <Brand />
      <h1>Sign in</h1>
      <p className="lede">{BRAND.tagline}</p>
      {state === 'sent' ? (
        <div role="status" className="card">
          <h3>Check your email</h3>
          <p>
            We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to come straight
            back here. The link works once.
          </p>
          <p className="sub">
            Use the email address your trainer invited. Nothing arrived? Check your spam folder, or{' '}
            <button type="button" className="link" onClick={() => setState('form')}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="stack" noValidate>
          <label>
            Your email address
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="err">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          <p className="sub">No password needed. Your trainer must have invited this email address first.</p>
        </form>
      )}
    </div>
  );
}

type Tab = 'programmes' | 'privacy';

function PrivacyCard({
  m,
  api,
  onChanged,
  say,
}: {
  m: PortalMembership;
  api: PortalApi;
  onChanged: () => Promise<void>;
  say: (s: string) => void;
}) {
  const [note, setNote] = useState('');
  const granted = m.consents.filter((c) => c.granted);
  const withdrawn = m.consents.filter((c) => !c.granted);
  return (
    <section className="card" aria-label={`Privacy at ${m.trainerName}`}>
      <h3>{m.trainerName}</h3>
      <h4>What you have agreed to</h4>
      {granted.length ? (
        <ul className="rows">
          {granted.map((c) => (
            <li key={`${c.purpose}|${c.detail}`}>
              <div className="txt">
                <span>{consentLabel(c.purpose, c.detail)}</span>
                {isCoreConsent(c.purpose) && (
                  <span className="sub">
                    If you withdraw this, your trainer can no longer keep or use your health information.
                  </span>
                )}
              </div>
              <ConfirmButton
                aria-label={`Withdraw: ${consentLabel(c.purpose, c.detail)}`}
                onConfirm={() =>
                  void api
                    .withdraw(m.clientId, c.purpose, c.detail)
                    .then(onChanged)
                    .then(() => say('Withdrawn. Your trainer has been told.'))
                    .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
                }
              >
                Withdraw
              </ConfirmButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub">You have not agreed to anything at this trainer at the moment.</p>
      )}
      {withdrawn.length > 0 && (
        <>
          <h4>Withdrawn</h4>
          <ul className="rows">
            {withdrawn.map((c) => (
              <li key={`${c.purpose}|${c.detail}`}>
                <span>{consentLabel(c.purpose, c.detail)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Ask your trainer to…</h4>
      <label>
        Anything your trainer should know (optional)
        <textarea rows={2} maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="btnrow">
        {REQUEST_KINDS.map((r) => (
          <button
            key={r.kind}
            type="button"
            className="btn sm"
            onClick={() =>
              void api
                .request(m.clientId, r.kind, note)
                .then((ok) => {
                  if (ok) setNote('');
                  say(ok ? 'Sent. Your trainer will follow up.' : 'That could not be sent.');
                })
                .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
            }
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="sub">
        Your trainer must answer within a reasonable time.
        {m.trainer.officerEmail
          ? ` Their Information Officer is ${m.trainer.officerName || 'named'} (${m.trainer.officerEmail}).`
          : ''}
      </p>
    </section>
  );
}

function ContactLine({ m }: { m: PortalMembership }) {
  const bits = [m.trainer.contactPhone, m.trainer.contactEmail, m.trainer.address].filter(Boolean);
  return bits.length ? <p className="sub">{bits.join(' · ')}</p> : null;
}

/** Everything a signed-in client sees: their programmes and privacy choices, grouped by trainer. */
function PortalHome({ client }: { client: SupabaseClient }) {
  const { session, signOut } = useAuth();
  const api = useMemo(() => createPortalApi(client), [client]);
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('programmes');
  const [open, setOpen] = useState<SharedProgramme | null>(null);
  const [opening, setOpening] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setOverview(await api.overview());
      setError('');
    } catch (err) {
      setError(`Could not load your programmes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function openProgramme(id: string) {
    setOpening(id);
    try {
      const p = await api.programme(id);
      if (p) setOpen(p);
      else setMsg('That programme is no longer available.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening('');
    }
  }

  if (open)
    return (
      <ProgrammeView p={open} back={{ label: '← Back to my programmes', onClick: () => setOpen(null) }} />
    );

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <Brand />
          <p className="eyebrow">{overview?.email || session?.user.email || ''}</p>
          <h1>My training</h1>
        </div>
        <div className="topright">
          <button type="button" className="btn sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {!overview && !error && (
        <p className="hint" role="status">
          Loading your programmes…
        </p>
      )}

      {overview && overview.memberships.length === 0 && (
        <section className="card" aria-label="No trainer yet">
          <h3>Nothing here yet</h3>
          <p>
            No trainer has invited <strong>{overview.email || 'this email address'}</strong> yet. Ask your
            trainer to invite this exact address, then come back and refresh.
          </p>
          <button type="button" className="btn" onClick={() => void load()}>
            Check again
          </button>
        </section>
      )}

      {overview && overview.memberships.length > 0 && (
        <>
          <div className="seg" role="tablist" aria-label="Portal sections">
            {(
              [
                ['programmes', 'My programmes'],
                ['privacy', 'My privacy'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <main className="stack">
            {overview.memberships.map((m) =>
              tab === 'programmes' ? (
                <section key={m.clientId} className="card" aria-label={`Programmes from ${m.trainerName}`}>
                  <h3>{m.trainerName}</h3>
                  <ContactLine m={m} />
                  {m.programmes.length ? (
                    <ul className="rows" aria-label={`Programmes from ${m.trainerName}`}>
                      {m.programmes.map((p) => (
                        <li key={p.id}>
                          <div className="txt">
                            <span>{p.title}</span>
                            <span className="sub">
                              {`${fmtDate(p.assignedOn)} · ${p.exercises} exercise${p.exercises === 1 ? '' : 's'}${p.gym ? ` · ${p.gym}` : ''}`}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn sm primary"
                            aria-label={`Open ${p.title}`}
                            disabled={opening === p.id}
                            onClick={() => void openProgramme(p.id)}
                          >
                            {opening === p.id ? 'Opening…' : 'Open'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="sub">{m.trainerName} has not given you a programme yet.</p>
                  )}
                </section>
              ) : (
                <PrivacyCard key={m.clientId} m={m} api={api} onChanged={load} say={setMsg} />
              ),
            )}
          </main>
        </>
      )}
      <p role="status" aria-live="polite">
        {msg}
      </p>
    </div>
  );
}

/** The client portal at /portal: sign in with an emailed link, then see your own programmes and privacy choices. */
export function PortalApp({ client }: { client: SupabaseClient }) {
  const { session } = useAuth();
  if (session === undefined)
    return (
      <div className="wrap">
        <p className="hint" role="status">
          Loading…
        </p>
      </div>
    );
  return session ? <PortalHome client={client} /> : <PortalSignIn client={client} />;
}
