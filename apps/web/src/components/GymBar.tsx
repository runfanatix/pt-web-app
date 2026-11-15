import type { GymSummary } from '@pt/core';

interface Props {
  gyms: GymSummary[];
  gymId: string;
  onChange: (id: string) => void;
}

export function GymBar({ gyms, gymId, onChange }: Props) {
  const gym = gyms.find((g) => g.id === gymId);
  return (
    <div className="gymbar" role="region" aria-label="Gym location">
      <label className="gympick">
        Gym
        <select value={gymId} aria-label="Select gym" onChange={(e) => onChange(e.target.value)}>
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
