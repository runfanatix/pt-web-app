import { useMemo, useState } from 'react';
import {
  BULK_EXAMPLE,
  LEVELS,
  MUSCLES,
  blankExercise,
  exerciseProblems,
  exerciseToInput,
  filterLibrary,
  levelName,
  linkChanges,
  noFilter,
  planBulkImport,
  tidyExercise,
  type ExerciseInput,
  type Layout,
  type LibraryExercise,
  type LibraryFilter,
} from '@pt/core';
import type { LibraryApi } from '../data/libraryApi.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

interface Props {
  library: LibraryExercise[];
  layout: Layout | null;
  api: LibraryApi | null;
  /** The library changed: read it again. */
  onChanged: () => void;
  say: (m: string) => void;
}

interface Editing {
  id: string | null;
  builtIn: boolean;
  input: ExerciseInput;
  equipmentIds: string[];
  /** The links it had when the form was opened. */
  was: string[];
}

/**
 * The exercise library: every exercise, searchable, with the machines each can be done on. The trainer adds their own
 * (one at a time or many pasted at once) and links any exercise to the machines at the open gym. The exercises that
 * came with the app can be linked but not rewritten: the trainer can make their own copy to change one.
 */
export function LibraryTab({ library, layout, api, onChanged, say }: Props) {
  const [filter, setFilter] = useState<LibraryFilter>(noFilter());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [bulk, setBulk] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const machines = useMemo(() => layout?.equipment ?? [], [layout]);
  const zones = useMemo(() => {
    const floorName = new Map((layout?.floors ?? []).map((f) => [f.id, f.name]));
    const multi = (layout?.floors.length ?? 0) > 1;
    return (layout?.zones ?? [])
      .map((z) => ({
        id: z.id,
        label: (multi ? `${floorName.get(z.floor) ?? ''} · ` : '') + z.name,
        machines: machines.filter((e) => e.zone === z.id),
      }))
      .filter((z) => z.machines.length);
  }, [layout, machines]);
  const shown = useMemo(() => filterLibrary(library, filter), [library, filter]);

  if (!api) return <p className="hint">The library is not available yet.</p>;
  if (!layout) return <p className="hint">Waiting for the floor plan…</p>;

  function open(x: LibraryExercise) {
    setProblems([]);
    setEditing({
      id: x.id,
      builtIn: !!x.builtIn,
      input: exerciseToInput(x),
      equipmentIds: [...x.equipmentIds],
      was: [...x.equipmentIds],
    });
  }
  function openNew() {
    setProblems([]);
    setEditing({ id: null, builtIn: false, input: blankExercise(), equipmentIds: [], was: [] });
  }
  const set = (patch: Partial<ExerciseInput>) =>
    setEditing((e) => (e ? { ...e, input: { ...e.input, ...patch } } : e));

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      say(ok);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing) return;
    const input = tidyExercise(editing.input);
    const clash = library.find(
      (x) => x.id !== editing.id && x.name.toLowerCase() === input.name.toLowerCase(),
    );
    const found = editing.builtIn
      ? []
      : [
          ...exerciseProblems(editing.input),
          ...(clash ? [`An exercise called "${clash.name}" already exists.`] : []),
        ];
    if (found.length) return setProblems(found);
    setProblems([]);
    const { add, remove } = linkChanges(editing.was, editing.equipmentIds);
    await run(
      async () => {
        let id = editing.id;
        if (!id) id = await api!.create(input);
        else if (!editing.builtIn) await api!.update(id, input);
        await api!.addLinks(id, add);
        await api!.removeLinks(id, remove);
        setEditing(null);
      },
      editing.id ? `Saved "${input.name}".` : `Added "${input.name}".`,
    );
  }

  async function copyOfBuiltIn() {
    if (!editing) return;
    const base = tidyExercise(editing.input);
    let name = `${base.name} (mine)`;
    let n = 2;
    while (library.some((x) => x.name.toLowerCase() === name.toLowerCase()))
      name = `${base.name} (mine ${n++})`;
    await run(async () => {
      const id = await api!.create({ ...base, name });
      await api!.addLinks(id, editing.equipmentIds);
      setEditing(null);
    }, `Made your own copy: "${name}". Edit it from the list.`);
  }

  async function importMany() {
    const plan = planBulkImport(bulk, library, machines);
    if (!plan.adds.length && !plan.merges.length) {
      setBulkMsg(
        plan.skipped ? 'Nothing to add: those lines have no exercise name.' : 'Paste some lines first.',
      );
      return;
    }
    setBusy(true);
    try {
      const byId = new Map(library.map((x) => [x.id, x]));
      for (const a of plan.adds) {
        const id = await api!.create(tidyExercise(a.input));
        await api!.addLinks(id, a.equipmentIds);
      }
      for (const m of plan.merges) {
        await api!.addLinks(m.id, m.addEquipment);
        const x = byId.get(m.id);
        if (x && !x.builtIn && (m.addMuscles.length || m.cue))
          await api!.update(m.id, {
            ...exerciseToInput(x),
            muscles: [...x.muscles, ...m.addMuscles],
            cue: x.cue || m.cue,
          });
      }
      setBulkMsg(plan.message);
      setBulk('');
      onChanged();
    } catch (err) {
      setBulkMsg(`Could not add them all: ${err instanceof Error ? err.message : String(err)}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const e = editing;
    const lock = e.builtIn;
    return (
      <div className="stack">
        <div className="crumb">
          <button type="button" className="link" onClick={() => setEditing(null)}>
            Library
          </button>
          <span>/</span>
          <strong>{e.id ? e.input.name : 'New exercise'}</strong>
        </div>
        {lock && (
          <p className="sub" role="note">
            This exercise came with the app, so its details cannot be changed. You can still choose which
            machines it can be done on, or make your own copy to change it.
          </p>
        )}
        <div className="fields">
          <label className="wide">
            Name
            <input
              type="text"
              maxLength={80}
              value={e.input.name}
              disabled={lock}
              onChange={(ev) => set({ name: ev.target.value })}
            />
          </label>
          <label>
            Level
            <select
              value={e.input.level}
              disabled={lock}
              onChange={(ev) => set({ level: ev.target.value as ExerciseInput['level'] })}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {levelName(l)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Demo link (optional)
            <input
              type="text"
              inputMode="url"
              placeholder="https://"
              value={e.input.link}
              disabled={lock}
              onChange={(ev) => set({ link: ev.target.value })}
            />
          </label>
          <label>
            Sets
            <input
              type="number"
              min={1}
              max={99}
              value={e.input.sets}
              disabled={lock}
              onChange={(ev) => set({ sets: Number(ev.target.value) })}
            />
          </label>
          <label>
            Reps or time
            <input
              type="text"
              maxLength={40}
              value={e.input.reps}
              disabled={lock}
              onChange={(ev) => set({ reps: ev.target.value })}
            />
          </label>
          <label>
            Rest (s)
            <input
              type="number"
              min={0}
              step={5}
              value={e.input.rest}
              disabled={lock}
              onChange={(ev) => set({ rest: Number(ev.target.value) })}
            />
          </label>
        </div>
        <fieldset className="fs">
          <legend>Muscle focus</legend>
          <div className="checks">
            {MUSCLES.map((m) => (
              <label key={m} className="chk">
                <input
                  type="checkbox"
                  disabled={lock}
                  checked={e.input.muscles.includes(m)}
                  onChange={(ev) =>
                    set({
                      muscles: ev.target.checked
                        ? [...e.input.muscles, m]
                        : e.input.muscles.filter((x) => x !== m),
                    })
                  }
                />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Coaching cue
          <textarea
            rows={2}
            maxLength={1000}
            value={e.input.cue}
            disabled={lock}
            onChange={(ev) => set({ cue: ev.target.value })}
          />
        </label>
        <fieldset className="fs">
          <legend>Can be done on</legend>
          {zones.length ? (
            zones.map((z) => (
              <div key={z.id} className="egrp">
                <strong>{z.label}</strong>
                <div className="checks">
                  {z.machines.map((q) => (
                    <label key={q.id} className="chk">
                      <input
                        type="checkbox"
                        checked={e.equipmentIds.includes(q.id)}
                        onChange={(ev) =>
                          setEditing({
                            ...e,
                            equipmentIds: ev.target.checked
                              ? [...e.equipmentIds, q.id]
                              : e.equipmentIds.filter((x) => x !== q.id),
                          })
                        }
                      />
                      {q.name}
                    </label>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="sub">This gym has no machines yet. Add some in Edit layout.</p>
          )}
        </fieldset>
        {problems.length > 0 && (
          <div role="alert" className="err">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        <div className="btnrow">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {lock ? 'Save machines' : 'Save exercise'}
          </button>
          {lock && (
            <button type="button" className="btn" disabled={busy} onClick={() => void copyOfBuiltIn()}>
              Make my own copy
            </button>
          )}
          <button type="button" className="btn" onClick={() => setEditing(null)}>
            Cancel
          </button>
          {e.id && !lock && (
            <ConfirmButton
              aria-label="Delete exercise"
              disabled={busy}
              onConfirm={() =>
                void run(async () => {
                  await api.remove(e.id!);
                  setEditing(null);
                }, `Deleted "${e.input.name}".`)
              }
            >
              Delete
            </ConfirmButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2>Exercise library</h2>
      <p className="sub">
        {library.length} exercises. Link each one to as many machines as it suits: it then appears in that
        machine’s pop-up on the plan.
      </p>
      <div className="btnrow">
        <button type="button" className="btn primary" onClick={openNew}>
          New exercise
        </button>
      </div>
      <div className="fields">
        <label className="wide">
          Search
          <input
            type="text"
            placeholder="e.g. squat or glutes"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          />
        </label>
        <label>
          Muscle
          <select value={filter.muscle} onChange={(e) => setFilter({ ...filter, muscle: e.target.value })}>
            <option value="all">All muscles</option>
            {MUSCLES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Equipment
          <select
            value={filter.equipment}
            onChange={(e) => setFilter({ ...filter, equipment: e.target.value })}
          >
            <option value="all">All equipment</option>
            <option value="none">Not linked to any equipment</option>
            {zones.map((z) => (
              <optgroup key={z.id} label={z.label}>
                {z.machines.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {shown.length ? (
        <>
          <p className="sub">{`Showing ${shown.length} of ${library.length}`}</p>
          <ul className="rows" aria-label="Exercises">
            {shown.map((x) => (
              <li key={x.id}>
                <button type="button" className="pick" aria-label={`Open ${x.name}`} onClick={() => open(x)}>
                  <span className="txt">
                    <span>{x.name}</span>
                    <span className="sub">
                      {`${x.muscles.join(', ')} · ${levelName(x.level)} · ${x.equipmentIds.length} linked`}
                      {x.builtIn ? ' · came with the app' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">No exercises match. Clear the filters or create a new exercise.</p>
      )}
      <details className="card imp">
        <summary>Add many exercises at once</summary>
        <p className="sub">
          One per line, separated by |. Name | muscles | machines | level | sets | reps | rest (s) | cue. For
          example:
        </p>
        <pre className="paybox">{BULK_EXAMPLE}</pre>
        <label>
          Paste lines here
          <textarea rows={6} spellCheck={false} value={bulk} onChange={(e) => setBulk(e.target.value)} />
        </label>
        <div className="btnrow">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void importMany()}>
            Import
          </button>
        </div>
        <p role="status" aria-live="polite">
          {bulkMsg}
        </p>
      </details>
    </div>
  );
}
