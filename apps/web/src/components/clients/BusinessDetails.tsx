import { useState } from 'react';
import { missingProfileFields, type TrainerProfile } from '@pt/core';
import type { ProfileApi } from '../../data/clients.ts';

interface Props {
  profile: TrainerProfile;
  api: ProfileApi;
  onSaved: (p: TrainerProfile) => void;
  onViewNotice: () => void;
}

const FIELDS: { key: keyof TrainerProfile; label: string; hint?: string; type?: string }[] = [
  { key: 'businessName', label: 'Business or trainer name' },
  { key: 'address', label: 'Physical address' },
  { key: 'contactEmail', label: 'Contact email', type: 'email' },
  { key: 'contactPhone', label: 'Contact phone (optional)', type: 'tel' },
  { key: 'informationOfficerName', label: 'Information Officer name', hint: 'Usually the business owner.' },
  { key: 'informationOfficerEmail', label: 'Information Officer email', type: 'email' },
  {
    key: 'paymentProvider',
    label: 'Payment provider (optional)',
    hint: 'Listed in the notice only if you use one.',
  },
  { key: 'messagingProvider', label: 'Email or SMS provider (optional)' },
  {
    key: 'studioName',
    label: 'Gym or studio name (optional)',
    hint: 'Listed in the notice only if you fill it in.',
  },
];

/** The trainer's details that fill in the privacy notice. Clients cannot be onboarded until the required ones are set. */
export function BusinessDetails({ profile, api, onSaved, onViewNotice }: Props) {
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const missing = missingProfileFields(draft);

  async function save() {
    setBusy(true);
    try {
      await api.save(draft);
      onSaved(draft);
      setStatus('Saved.');
    } catch (err) {
      setStatus(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="share" aria-label="Your business details">
      <h3>Your business details</h3>
      <p className="sub">
        These fill in the privacy notice your clients read: who is responsible for their information and how
        to reach you.
      </p>
      {missing.length > 0 && (
        <p className="callout warn" role="note">
          Still needed before you can add clients: {missing.join(', ')}.
        </p>
      )}
      <div className="meta">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.key === 'businessName' || f.key === 'address' ? 'full' : undefined}>
            {f.label}
            <input
              type={f.type ?? 'text'}
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
            {f.hint && <span className="sub">{f.hint}</span>}
          </label>
        ))}
      </div>
      <div className="btnrow">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save details
        </button>
        <button type="button" className="btn" onClick={onViewNotice}>
          View the privacy notice
        </button>
      </div>
      <p role="status" aria-live="polite" className="sub">
        {status}
      </p>
    </section>
  );
}
