import { MUSCLES } from '@pt/core';
import { TYPE_LETTERS } from './FloorPlan.tsx';

interface Floor {
  id: string;
  name: string;
}

/** Floor tabs: shown only when the gym has more than one floor. */
export function FloorTabs({
  floors,
  floorId,
  counts = {},
  onChange,
}: {
  floors: Floor[];
  floorId: string;
  /** Exercises in the session on each floor, shown as a badge. */
  counts?: Record<string, number>;
  onChange: (id: string) => void;
}) {
  if (floors.length < 2) return null;
  return (
    <div className="chips floorbar" role="group" aria-label="Floors">
      <span className="lab">Floor</span>
      {floors.map((f) => (
        <button
          key={f.id}
          type="button"
          className="chip"
          aria-pressed={floorId === f.id}
          onClick={() => onChange(f.id)}
        >
          {f.name || 'Floor'}
          {counts[f.id] ? (
            <span className="fcount" title="Exercises on this floor">
              {counts[f.id]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Muscle-focus chips: pick a muscle and machines that do not train it are dimmed on the plan. */
export function MuscleChips({ filter, onChange }: { filter: string; onChange: (m: string) => void }) {
  return (
    <div className="chips" role="group" aria-label="Muscle focus">
      <span className="lab">Muscle focus</span>
      <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => onChange('all')}>
        All
      </button>
      {MUSCLES.map((m) => (
        <button
          key={m}
          type="button"
          className="chip"
          aria-pressed={filter === m}
          onClick={() => onChange(m)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

const RUN_LEGEND = [
  ['ready', 'In the routine'],
  ['now', 'Current machine'],
  ['next', 'Still to do'],
  ['done', 'Completed'],
] as const;

/** Machine kinds in the plan view; progress colours in the live run view. */
export function Legend({ run = false }: { run?: boolean }) {
  return (
    <ul className="legend" aria-label="Legend">
      {run ? (
        <>
          {RUN_LEGEND.map(([k, label]) => (
            <li key={k}>
              <span className={`sw sw-${k}`} />
              {label}
            </li>
          ))}
          <li>Numbers show the step order</li>
        </>
      ) : (
        Object.values(TYPE_LETTERS).map((t) => (
          <li key={t.letter}>
            <span className="dot">{t.letter}</span>
            {t.name}
          </li>
        ))
      )}
    </ul>
  );
}
