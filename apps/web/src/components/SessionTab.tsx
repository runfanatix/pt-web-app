import { useId, type KeyboardEvent } from 'react';
import {
  estimateSeconds,
  exercisesFor,
  routePlaces,
  type Layout,
  type LibraryExercise,
  type SessionItem,
  type SessionMeta,
} from '@pt/core';
import type { Action } from '../session/sessionState.ts';
import { ITEM_NOTES, NOTE_PRESETS, REPS_OPTIONS } from '../session/presets.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

type Equip = Layout['equipment'][number];

interface Props {
  meta: SessionMeta;
  items: SessionItem[];
  layout: Layout;
  library: LibraryExercise[];
  dispatch: (a: Action) => void;
  /** Rendered below the summary: save and load templates. */
  children?: React.ReactNode;
}

export function SessionTab({ meta, items, layout, library, dispatch, children }: Props) {
  const uid = useId();
  const equipById = new Map(layout.equipment.map((e) => [e.id, e]));
  const floorName = new Map(layout.floors.map((f) => [f.id, f.name]));
  const zoneName = new Map(layout.zones.map((z) => [z.id, z.name]));
  const place = (e: Equip) =>
    (layout.floors.length > 1 ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? '');
  const route = routePlaces(items, equipById, place);
  const libById = new Map(library.map((x) => [x.id, x]));
  const setMeta = (patch: Partial<SessionMeta>) => dispatch({ type: 'meta', patch });

  return (
    <div className="stack">
      <h2>Session</h2>

      <div className="meta">
        <label className="full">
          Guest name shown on the PDF (optional)
          <input
            type="text"
            value={meta.client}
            placeholder="e.g. Sam"
            onChange={(e) => setMeta({ client: e.target.value })}
          />
        </label>
        <label className="full">
          Session name
          <input
            type="text"
            value={meta.title}
            placeholder="e.g. Full-body strength"
            onChange={(e) => setMeta({ title: e.target.value })}
          />
        </label>
        <label>
          Coach
          <input type="text" value={meta.coach} onChange={(e) => setMeta({ coach: e.target.value })} />
        </label>
        <label>
          Date
          <input type="date" value={meta.date} onChange={(e) => setMeta({ date: e.target.value })} />
        </label>
        <label className="full">
          Add a note from the list
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setMeta({ notes: meta.notes ? `${meta.notes}\n${e.target.value}` : e.target.value });
            }}
          >
            <option value="">Choose a note…</option>
            {NOTE_PRESETS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Notes for the client
          <textarea
            rows={2}
            value={meta.notes}
            placeholder="Pick notes from the list above, or type your own"
            onChange={(e) => setMeta({ notes: e.target.value })}
          />
        </label>
      </div>

      {items.length === 0 ? (
        <p className="empty">
          No exercises yet. Click a machine on the map and choose an exercise from its pop-up.
        </p>
      ) : (
        <>
          <p className="sub">
            Use the arrows to reorder (or focus the grip and press the up or down arrow). The route on the map
            follows the order.
          </p>
          <ol className="slist" aria-label="Exercises in this session">
            {items.map((it, i) => {
              const e = equipById.get(it.eid);
              const linked = e ? exercisesFor(library, e.id) : [];
              const cue = it.xid ? libById.get(it.xid)?.cue : '';
              const listId = `${uid}-ex-${it.uid}`;
              const gripKey = (ev: KeyboardEvent) => {
                if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                  ev.preventDefault();
                  dispatch({ type: 'move', uid: it.uid, by: ev.key === 'ArrowUp' ? -1 : 1 });
                }
              };
              return (
                <li key={it.uid} className="sitem">
                  <div className="shead">
                    <button
                      type="button"
                      className="grip"
                      aria-label={`Reorder ${it.exercise || 'exercise'}. Press the up or down arrow key.`}
                      onKeyDown={gripKey}
                    >
                      ⋮⋮
                    </button>
                    <span className="num">{i + 1}</span>
                    <div className="who">
                      <strong>{e ? e.name : 'Removed equipment'}</strong>
                      <span className="sub">{e ? place(e) : ''}</span>
                    </div>
                    <div className="mv">
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Move ${it.exercise || 'exercise'} up`}
                        disabled={i === 0}
                        onClick={() => dispatch({ type: 'move', uid: it.uid, by: -1 })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Move ${it.exercise || 'exercise'} down`}
                        disabled={i === items.length - 1}
                        onClick={() => dispatch({ type: 'move', uid: it.uid, by: 1 })}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label={`Remove ${it.exercise || 'exercise'}`}
                        onClick={() => dispatch({ type: 'remove', uid: it.uid })}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="fields">
                    <label className="wide">
                      Exercise
                      <input
                        type="text"
                        list={listId}
                        value={it.exercise}
                        onChange={(ev) => {
                          // The library link follows the name: picking a linked exercise keeps its cue and remap data.
                          const match = linked.find((x) => x.name === ev.target.value);
                          dispatch({
                            type: 'update',
                            uid: it.uid,
                            patch: { exercise: ev.target.value, xid: match ? match.id : null },
                          });
                        }}
                      />
                      <datalist id={listId}>
                        {linked.map((x) => (
                          <option key={x.id} value={x.name} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Sets
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={it.sets}
                        onChange={(ev) =>
                          dispatch({
                            type: 'update',
                            uid: it.uid,
                            patch: { sets: Math.max(1, Math.round(Number(ev.target.value)) || 1) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Reps or time
                      <input
                        type="text"
                        list={`${uid}-reps`}
                        value={it.reps}
                        onChange={(ev) =>
                          dispatch({ type: 'update', uid: it.uid, patch: { reps: ev.target.value } })
                        }
                      />
                    </label>
                    <label>
                      Rest (s)
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={5}
                        value={it.rest}
                        onChange={(ev) =>
                          dispatch({
                            type: 'update',
                            uid: it.uid,
                            patch: { rest: Math.max(0, Number(ev.target.value) || 0) },
                          })
                        }
                      />
                    </label>
                    <label className="wide">
                      Coach note (optional)
                      <input
                        type="text"
                        list={`${uid}-notes`}
                        value={it.note}
                        onChange={(ev) =>
                          dispatch({ type: 'update', uid: it.uid, patch: { note: ev.target.value } })
                        }
                      />
                    </label>
                  </div>
                  {cue ? <p className="cuetext">Cue: {cue}</p> : null}
                </li>
              );
            })}
          </ol>
          <datalist id={`${uid}-reps`}>
            {REPS_OPTIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <datalist id={`${uid}-notes`}>
            {ITEM_NOTES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </>
      )}

      <div className="summary" aria-label="Session summary">
        <div className="nums">
          <span>
            <b>{items.length}</b> exercises
          </span>
          <span>
            <b>{Math.round(estimateSeconds(items) / 60)}</b> min estimated
          </span>
          <span>
            <b>{Math.max(0, route.length - 1)}</b> zone changes
          </span>
        </div>
        <p className="route-text">
          {route.length
            ? `Floor route: ${route.join(' → ')}`
            : 'Add equipment to see the route around the floor.'}
        </p>
        <p className="route-text">
          Estimate assumes 45 s of work per set unless the reps field gives minutes, plus the rest time
          between sets.
        </p>
      </div>

      {children}

      {items.length > 0 && (
        <div className="btnrow">
          <ConfirmButton onConfirm={() => dispatch({ type: 'clear' })}>Clear session</ConfirmButton>
        </div>
      )}
    </div>
  );
}
