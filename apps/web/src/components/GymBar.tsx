import type { GymSummary } from '@pt/core';

interface Props {
  gyms: GymSummary[];
  gymId: string;
  onChange: (id: string) => void;
  /** Switching gym is not allowed during a live run. */
  disabled?: boolean;
  /** Layout editing: unsaved changes can be saved or discarded here. */
  edit?: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void } | null;
}

export function GymBar({ gyms, gymId, onChange, disabled = false, edit = null }: Props) {
  const gym = gyms.find((g) => g.id === gymId);
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
    </div>
  );
}
