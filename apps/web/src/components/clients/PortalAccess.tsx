import { useCallback, useEffect, useState } from 'react';
import { fmtDate, inviteStatus, type InviteStatus } from '@pt/core';
import type { InviteApi, PortalAccount, PortalInvite } from '../../data/invites.ts';
import { copyText } from '../../lib/clipboard.ts';
import { portalLink } from '../../lib/links.ts';
import { ConfirmButton } from '../ConfirmButton.tsx';

const STATUS_TEXT: Record<InviteStatus, string> = {
  none: 'Not invited',
  invited: 'Invited: waiting for them to sign in',
  active: 'Active: they can sign in to see their programmes',
  off: 'Switched off',
  expired: 'The invitation expired',
};

/**
 * The trainer's side of the client portal for one client: invite them by email, see whether they have signed in,
 * and switch their access off. The client signs in with an emailed link; nothing about them is shared until then.
 */
export function PortalAccess({
  api,
  clientId,
  clientName,
  email,
  say,
}: {
  api: InviteApi;
  clientId: string;
  clientName: string;
  email: string;
  say: (m: string) => void;
}) {
  const [data, setData] = useState<{ invites: PortalInvite[]; accounts: PortalAccount[] } | null>(null);
  const [to, setTo] = useState(email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setData(await api.status(clientId));
      setError('');
    } catch (err) {
      setError(`Could not load portal access: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api, clientId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => setTo(email), [email]);

  async function invite() {
    setBusy(true);
    setError('');
    try {
      const id = await api.create(clientId, to);
      const sent = await api.send(id);
      await refresh();
      if (sent) say(`Invitation emailed to ${to.trim().toLowerCase()}.`);
      else {
        const copied = await copyText(portalLink());
        say(
          `Invitation saved, but the email could not be sent${copied ? '. The portal link is copied: send it to them yourself' : ''}.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      say(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = data ? inviteStatus(data.invites, data.accounts) : 'none';
  const open = data?.invites.find(
    (i) => !i.acceptedAt && !i.revokedAt && Date.parse(i.expiresAt) > Date.now(),
  );
  const account = data?.accounts.find((a) => !a.revokedAt);

  return (
    <section className="share" aria-label="Client portal">
      <h3>Client portal</h3>
      <p className="sub">
        Invite {clientName} so they can sign in on their own phone (with an emailed link, no password) and see
        their programmes, the gym plan and their privacy choices.
      </p>
      <p role="status">
        <strong>{STATUS_TEXT[status]}</strong>
        {account ? ` · since ${fmtDate(account.createdAt.slice(0, 10))}` : ''}
        {open ? ` · sent to ${open.email}` : ''}
      </p>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {status !== 'active' && (
        <div className="fields">
          <label className="wide">
            Their email address
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
      <div className="btnrow">
        {status !== 'active' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !to.trim()}
            onClick={() => void invite()}
          >
            {status === 'invited' ? 'Send the invitation again' : 'Invite to the portal'}
          </button>
        )}
        {open && (
          <ConfirmButton
            aria-label="Cancel the invitation"
            disabled={busy}
            onConfirm={() => void run(() => api.cancel(open.id), 'Invitation cancelled.')}
          >
            Cancel the invitation
          </ConfirmButton>
        )}
        {account && (
          <ConfirmButton
            aria-label="Switch off portal access"
            disabled={busy}
            onConfirm={() => void run(() => api.switchOff(account.id), 'Portal access switched off.')}
          >
            Switch off access
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}
