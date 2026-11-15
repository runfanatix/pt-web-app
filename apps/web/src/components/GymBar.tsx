type Props = { name: string; branch: string; address: string };

export function GymBar({ name, branch, address }: Props) {
  return (
    <div className="gymbar" role="region" aria-label="Gym location">
      <label className="gympick">
        Gym
        <select defaultValue="current" aria-label="Select gym">
          <option value="current">
            {name} {branch}
          </option>
        </select>
      </label>
      <span className="gaddr">{address}</span>
      <span className="gstat" role="status">
        Layout saved
      </span>
    </div>
  );
}
