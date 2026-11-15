import { useState } from 'react';
import { CONSENT_WORDING_VERSION, noticeText, type ConsentScreen, type TrainerProfile } from '@pt/core';
import type { ConsentInput } from '../../data/clients.ts';
import { NoticeView } from './NoticeView.tsx';

interface Props {
  /** The screens to show, in order (the caller decides which are still needed). */
  screens: ConsentScreen[];
  profile: TrainerProfile;
  /** The client's name: the person who is giving consent. */
  clientName: string;
  onDone: (consents: ConsentInput[]) => void;
  onCancel: () => void;
}

/**
 * One consent screen at a time, every box starting unticked. Hand the phone to the client to read and tick.
 * Required screens cannot be passed without a tick; optional ones record a "no" when left unticked, so the
 * client is not asked again.
 */
export function ConsentWizard({ screens, profile, clientName, onDone, onCancel }: Props) {
  const [index, setIndex] = useState(0);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [showNotice, setShowNotice] = useState(false);
  const screen = screens[index];
  if (!screen) return null;
  const last = index === screens.length - 1;
  const ticked = ticks[screen.type] === true;

  function finish() {
    onDone(
      screens.map((s) => ({
        purpose: s.type,
        granted: ticks[s.type] === true,
        // The notice is kept in full as proof of what the client read; other screens keep the sentence they ticked.
        wording: s.type === 'privacy-notice' ? `${s.checkbox}\n\n${noticeText(profile)}` : s.checkbox,
      })),
    );
  }

  if (showNotice) return <NoticeView profile={profile} onClose={() => setShowNotice(false)} />;

  return (
    <section className="card" aria-label="Consent">
      <p className="sub">
        Consent for {clientName} · screen {index + 1} of {screens.length} · wording {CONSENT_WORDING_VERSION}
      </p>
      <h3>{screen.title}</h3>
      <p>{screen.intro}</p>
      {screen.type === 'privacy-notice' && (
        <button type="button" className="link" onClick={() => setShowNotice(true)}>
          Read the Privacy Notice
        </button>
      )}
      <label className="chk">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicks({ ...ticks, [screen.type]: e.target.checked })}
        />
        <span>{screen.checkbox}</span>
      </label>
      {screen.footnote && <p className="sub">{screen.footnote}</p>}
      {!screen.required && <p className="sub">This is optional. You can leave it unticked.</p>}
      <div className="btnrow">
        <button type="button" className="btn" onClick={index === 0 ? onCancel : () => setIndex(index - 1)}>
          {index === 0 ? 'Cancel' : 'Back'}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={screen.required && !ticked}
          onClick={() => (last ? finish() : setIndex(index + 1))}
        >
          {last ? 'Finish' : 'Next'}
        </button>
      </div>
    </section>
  );
}
