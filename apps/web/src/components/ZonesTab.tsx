import { LEVEL_NAMES, exercisesFor, rxText, type Layout, type LibraryExercise } from '@pt/core';
import { TYPE_LETTERS } from './FloorPlan.tsx';

type Equip = Layout['equipment'][number];

interface Props {
  layout: Layout;
  library: LibraryExercise[];
  floorId: string;
  selEq: string | null;
  onSelectEq: (id: string | null) => void;
  onAdd: (eid: string, x: LibraryExercise) => void;
}

/**
 * The plan's list view: pick a machine here and add its exercises, with no map interaction needed. Handy on
 * a phone and for keyboard and screen-reader users.
 */
export function ZonesTab({ layout, library, floorId, selEq, onSelectEq, onAdd }: Props) {
  const selected = selEq ? layout.equipment.find((e) => e.id === selEq) : undefined;
  const zones = layout.zones.filter((z) => z.floor === floorId);
  const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));
  const floorName = new Map(layout.floors.map((f) => [f.id, f.name]));
  const place = (e: Equip) =>
    (layout.floors.length > 1 ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? '');

  return (
    <div className="stack">
      {selected && (
        <div className="card">
          <div className="cardhead">
            <span className="dot">{(TYPE_LETTERS[selected.type] ?? TYPE_LETTERS.space!).letter}</span>
            <div>
              <h3>{selected.name}</h3>
              <p className="sub">
                {place(selected)} · {(TYPE_LETTERS[selected.type] ?? TYPE_LETTERS.space!).name}
              </p>
            </div>
            <button
              type="button"
              className="x"
              aria-label="Deselect machine"
              onClick={() => onSelectEq(null)}
            >
              ×
            </button>
          </div>
          <div className="tags">
            {selected.muscles.map((m) => (
              <span key={m} className="tag">
                {m}
              </span>
            ))}
          </div>
          {selected.notes && <p className="sub">{selected.notes}</p>}
          <h4>Linked exercises ({exercisesFor(library, selected.id).length})</h4>
          {exercisesFor(library, selected.id).length ? (
            <ul className="rows">
              {exercisesFor(library, selected.id).map((x) => (
                <li key={x.id}>
                  <div className="txt">
                    <span>{x.name}</span>
                    <span className="sub">
                      {rxText(x)} · {LEVEL_NAMES[x.level] ?? x.level}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn sm primary"
                    aria-label={`Add ${x.name} to session`}
                    onClick={() => onAdd(selected.id, x)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No exercises linked to this machine yet.</p>
          )}
        </div>
      )}

      <h3>Zones on this floor</h3>
      {zones.length === 0 ? (
        <p className="empty">No zones on this floor.</p>
      ) : (
        zones.map((z) => {
          const machines = layout.equipment.filter((e) => e.zone === z.id);
          return (
            <div key={z.id} className="egrp">
              <strong>
                {z.name} <span className="sub">({machines.length})</span>
              </strong>
              {machines.length ? (
                <div className="checks">
                  {machines.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="chip"
                      aria-pressed={selEq === e.id}
                      onClick={() => onSelectEq(selEq === e.id ? null : e.id)}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="sub">No equipment placed in this zone.</p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
