import { useCallback, useEffect, useState } from 'react';
import { publicLink } from '../../lib/links.ts';
import { linkStatus, type ShareApi, type ShareLink } from '../../data/share.ts';
import { copyText } from '../../lib/clipboard.ts';
import type { PdfModel } from '../../lib/pdf.ts';
import { ConfirmButton } from '../ConfirmButton.tsx';
import { SendActions } from '../SendActions.tsx';

interface Props {
  programmeId: string;
  title: string;
  api: ShareApi;
  /** The message and PDF for this programme. */
  pdf: PdfModel;
  whatsapp: string;
  email: string;
  say: (msg: string) => void;
}

const EXPIRY = [
  { label: 'Works for 90 days', days: 90 },
  { label: 'Works for 30 days', days: 30 },
  { label: 'Works for 7 days', days: 7 },
  { label: 'Never expires', days: 0 },
];

/** Share one programme: a link the client opens without logging in (revocable), plus message and PDF. */
export function SharePanel({ programmeId, title, api, pdf, whatsapp, email, say }: Props) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLinks(await api.list(programmeId));
    } catch (err) {
      say(`Could not load links: ${err instanceof Error ? err.message : String(err)}`);
      setLinks([]);
    }
  }, [api, programmeId, say]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    setBusy(true);
    try {
      await api.create(programmeId, days || null);
      await refresh();
      say('Link created.');
    } catch (err) {
      say(`Could not create the link: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(l: ShareLink) {
    try {
      await api.revoke(l.token);
      await refresh();
      say('Link switched off. It no longer opens.');
    } catch (err) {
      say(`Could not switch it off: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const active = (links ?? []).filter((l) => linkStatus(l) === 'active');
  const newest = active[0];
  const url = newest ? publicLink(newest.token) : undefined;

  return (
    <section className="share" aria-label={`Share ${title}`}>
      <h4>Share &ldquo;{title}&rdquo;</h4>
      <p className="sub">
        The link shows this programme and the gym plan only: never contact details, notes or anything else
        about the client. You can switch it off at any time.
      </p>
      <div className="addrow">
        <label>
          Link lifetime
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY.map((o) => (
              <option key={o.label} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          Create a link
        </button>
      </div>

      {links === null ? (
        <p className="sub">Loading…</p>
      ) : links.length === 0 ? (
        <p className="empty">No links yet.</p>
      ) : (
        <ul className="rows" aria-label="Links">
          {links.map((l) => {
            const s = linkStatus(l);
            const href = publicLink(l.token);
            return (
              <li key={l.token}>
                <div className="txt">
                  <span>
                    {s === 'active' ? 'Active' : s === 'revoked' ? 'Switched off' : 'Expired'} · made{' '}
                    {l.createdAt.slice(0, 10)}
                    {l.expiresAt
                      ? ` · ${s === 'expired' ? 'expired' : 'expires'} ${l.expiresAt.slice(0, 10)}`
                      : ' · no expiry'}
                  </span>
                  <span className="sub">…{l.token.slice(-8)}</span>
                </div>
                {s === 'active' && (
                  <div className="btnrow">
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Copy link ending ${l.token.slice(-8)}`}
                      onClick={() =>
                        void copyText(href).then((ok) =>
                          say(ok ? 'Link copied.' : 'Could not copy the link.'),
                        )
                      }
                    >
                      Copy link
                    </button>
                    <ConfirmButton
                      aria-label={`Switch off link ending ${l.token.slice(-8)}`}
                      onConfirm={() => void revoke(l)}
                    >
                      Switch off
                    </ConfirmButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {url && <input type="text" readOnly aria-label="Client link" value={url} />}
      <SendActions pdf={pdf} link={url} whatsapp={whatsapp} email={email} />
    </section>
  );
}
