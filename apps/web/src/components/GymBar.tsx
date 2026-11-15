import type { GymSummary } from '@pt/core';

interface Props {
  gyms: GymSummary[];
  gymId: string;
  onChange: (id: string) => void;
  /** Switching gym is not allowed during a live run. */
  disabled?: boolean;
}

export function GymBar({ gyms, gymId, onChange, disabled = false }: Props) {
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
      <span className="gstat" role="status">
        Layout saved
      </span>
    </div>
  );
}
