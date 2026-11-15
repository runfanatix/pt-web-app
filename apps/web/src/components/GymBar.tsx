import type { GymSummary } from '@pt/core';

interface Props {
  gyms: GymSummary[];
  gymId: string;
  onChange: (id: string) => void;
  /** Switching gym is not allowed during a live run. */
  disabled?: boolean;
  /** Layout editing: unsaved changes can be saved or discarded here. */
  /** Switching gym needs an answer: unsaved layout changes, or exercises with no matching machine. */
  ask?: {
    target: string;
    dirty: boolean;
    moved: number;
    dropped: number;
    onGo: (how: 'save' | 'discard' | '') => void;
    onCancel: () => void;
  } | null;
  edit?: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void } | null;
}

export function GymBar({ gyms, gymId, onChange, disabled = false, edit = null, ask = null }: Props) {
  const gym = gyms.find((g) => g.id === gymId);
  const title = gym ? [gym.name, gym.branch].filter(Boolean).join(' ') : '';
  return (
    <div className="gymbar" role="region" aria-label="Gym location">
      <label className="gympick">
        Gym
        <select
          value={gymId}
          aria-label="Select gym"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {gyms.map((g) => (
            <option key={g.id} value={g.id}>
              {[g.name, g.branch].filter(Boolean).join(' ')}
            </option>
          ))}
          <option value="__manage">Add or manage gyms...</option>
        </select>
      </label>
      <span className="gaddr">{gym?.address}</span>
      <span className={edit?.dirty ? 'gstat dirty' : 'gstat'} role="status">
        {edit?.saving ? 'Saving…' : edit?.dirty ? 'Unsaved layout changes' : 'Layout saved'}
      </span>
      {edit?.dirty && (
        <>
          <button type="button" className="btn sm" disabled={edit.saving} onClick={edit.onSave}>
            Save layout
          </button>
          <button type="button" className="btn sm" disabled={edit.saving} onClick={edit.onDiscard}>
            Discard changes
          </button>
        </>
      )}
      {ask && (
        <div className="gask" role="alert">
          <p>
            {ask.dirty ? `You have unsaved layout changes to “${title}”. ` : ''}
            {ask.moved
              ? `${ask.moved} exercise${ask.moved === 1 ? '' : 's'} will move to matching machines at “${ask.target}”. `
              : ''}
            {ask.dropped
              ? `${ask.dropped} exercise${ask.dropped === 1 ? ' has' : 's have'} no matching machine there and will be removed from the session. `
              : ''}
            {`Switch to “${ask.target}”?`}
          </p>
          <div className="btnrow">
            {ask.dirty ? (
              <>
                <button type="button" className="btn sm primary" onClick={() => ask.onGo('save')}>
                  Save layout and switch
                </button>
                <button type="button" className="btn sm" onClick={() => ask.onGo('discard')}>
                  Discard changes and switch
                </button>
              </>
            ) : (
              <button type="button" className="btn sm primary" onClick={() => ask.onGo('')}>
                Switch
              </button>
            )}
            <button type="button" className="btn sm" onClick={ask.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
