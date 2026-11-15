import { useState } from 'react';
import { isMinor, onboardingStatus, snapsOf, type ClientRecord, type SessionItem } from '@pt/core';
import type { ClientsApi } from '../../data/clients.ts';

interface Props {
  clients: ClientRecord[];
  items: SessionItem[];
  title: string;
  notes: string;
  gymId: string;
  api: ClientsApi;
  /** The client the session is for, ticked to start with. */
  selectedId: string;
  onAssigned: () => Promise<void>;
}

/** Saves the routine as a programme on each ticked client. */
export function AssignPanel({ clients, items, title, notes, gymId, api, selectedId, onAssigned }: Props) {
  const [ticked, setTicked] = useState<Record<string, boolean>>(selectedId ? { [selectedId]: true } : {});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = clients.filter((r) => ticked[r.client.id]).map((r) => r.client.id);

  async function assign() {
    if (!items.length) return setStatus('Add at least one exercise first.');
    if (!chosen.length) return setStatus('Tick at least one client.');
    setBusy(true);
    try {
      const made = await api.assign({
        clientIds: chosen,
        gymId,
        title: title.trim() || 'Programme',
        notes,
        items: snapsOf(items),
      });
      await onAssigned();
      setStatus(`Assigned to ${made} client${made === 1 ? '' : 's'}.`);
      setTicked({});
    } catch (err) {
      setStatus(`Could not assign: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="share" aria-label="Assign to clients">
      <h3>Assign to clients</h3>
      {clients.length === 0 ? (
        <p className="sub">No client profiles yet. Add one in the Clients tab.</p>
      ) : (
        <fieldset className="fs">
          <legend>Assign this programme to</legend>
          <div className="checks">
            {clients.map((r) => {
              const pending = !onboardingStatus(r.consents, isMinor(r.client.dateOfBirth)).complete;
              return (
                <label key={r.client.id} className="chk">
                  <input
                    type="checkbox"
                    checked={!!ticked[r.client.id]}
                    onChange={(e) => setTicked({ ...ticked, [r.client.id]: e.target.checked })}
                  />
                  <span>
                    {r.client.name}
                    {pending ? ' (consent pending)' : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <div className="btnrow">
        <button
          type="button"
          className="btn primary"
          disabled={busy || clients.length === 0}
          onClick={() => void assign()}
        >
          Assign to selected clients
        </button>
      </div>
      <p role="status" aria-live="polite" className="sub">
        {status}
      </p>
    </section>
  );
}
