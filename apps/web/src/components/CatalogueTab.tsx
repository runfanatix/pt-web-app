import { useEffect, useState } from 'react';
import {
  EQUIPMENT_TYPES,
  MUSCLES,
  searchModels,
  type Catalogue,
  type CatalogueItem,
  type ModelInput,
  type Spec,
} from '@pt/core';
import type { CatalogueApi } from '../data/catalogueApi.ts';
import { ConfirmButton } from './ConfirmButton.tsx';
import { TYPE_LETTERS } from './FloorPlan.tsx';

const SUGGESTED = ['Technogym', 'Eleiko', 'Life Fitness', 'Matrix', 'Hammer Strength', 'Precor', 'Cybex'];

const blank = (): ModelInput => ({ model: '', code: '', kind: 'machine', muscles: [], specs: [], notes: '' });

interface Props {
  catalogue: Catalogue | null;
  error: string;
  api: CatalogueApi | null;
  onChanged: () => Promise<void>;
}

/**
 * The equipment catalogue: manufacturers and the models they make, typed in by hand. A machine on the plan can then
 * be tagged with its real maker and model, so a routine names the actual machine.
 */
export function CatalogueTab({ catalogue, error, api, onChanged }: Props) {
  const [makerId, setMakerId] = useState('');
  const [newMaker, setNewMaker] = useState('');
  const [rename, setRename] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: ModelInput } | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const makers = catalogue?.manufacturers ?? [];
  const maker = makers.find((m) => m.id === makerId) ?? makers[0];
  const models = catalogue && maker ? searchModels(catalogue, query, maker.id) : [];

  useEffect(() => {
    let live = true;
    api?.usage().then(
      (u) => live && setUsage(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, catalogue]);
  useEffect(() => setRename(maker?.name ?? ''), [maker?.id, maker?.name]);

  async function run(fn: () => Promise<void>, fail: string) {
    setBusy(true);
    try {
      await fn();
      setMsg('');
    } catch (err) {
      setMsg(`${fail}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!api) return <p className="hint">The catalogue is not available yet.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!catalogue) return <p className="hint">Loading the catalogue…</p>;

  const machinesUsing = (items: CatalogueItem[]) => items.reduce((n, i) => n + (usage[i.id] ?? 0), 0);
  const makerModels = maker ? catalogue.items.filter((i) => i.manufacturerId === maker.id) : [];

  async function addMaker(name: string) {
    const n = name.trim();
    if (!n) return setMsg('Give the manufacturer a name first.');
    await run(async () => {
      const id = await api!.addManufacturer(n);
      await onChanged();
      setMakerId(id);
      setNewMaker('');
    }, 'Could not add the manufacturer');
  }

  async function saveModel() {
    if (!editing || !maker) return;
    if (!editing.draft.model.trim()) return setMsg('Give the model a name first.');
    const d = {
      ...editing.draft,
      model: editing.draft.model.trim(),
      code: editing.draft.code.trim(),
      specs: editing.draft.specs.filter((s) => s.label.trim()),
    };
    await run(async () => {
      if (editing.id) await api!.updateModel(editing.id, d);
      else await api!.addModel(maker.id, d);
      await onChanged();
      setEditing(null);
    }, 'Could not save the model');
  }

  const setDraft = (patch: Partial<ModelInput>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const setSpec = (i: number, patch: Partial<Spec>) =>
    setDraft({ specs: editing!.draft.specs.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  return (
    <div className="stack">
      <h2>Equipment catalogue</h2>
      <p className="sub">
        Add the manufacturers whose equipment is in your gyms, then the models they make. In Edit layout you
        can tag each machine on the plan with its real maker and model, so your routines name the actual
        machine.
      </p>

      <section className="card" aria-label="Manufacturers">
        <h3>Manufacturers</h3>
        {makers.length > 0 && (
          <div className="chips" role="group" aria-label="Pick a manufacturer">
            {makers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={m.id === maker?.id}
                onClick={() => {
                  setMakerId(m.id);
                  setEditing(null);
                  setQuery('');
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="fields">
          <label className="wide">
            Add a manufacturer
            <input
              type="text"
              maxLength={60}
              value={newMaker}
              placeholder="e.g. Technogym"
              onChange={(e) => setNewMaker(e.target.value)}
            />
          </label>
        </div>
        <div className="btnrow">
          <button type="button" className="btn" disabled={busy} onClick={() => void addMaker(newMaker)}>
            Add manufacturer
          </button>
        </div>
        {SUGGESTED.filter((s) => !makers.some((m) => m.name.toLowerCase() === s.toLowerCase())).length >
          0 && (
          <>
            <p className="sub">Or start from a common one:</p>
            <div className="chips">
              {SUGGESTED.filter((s) => !makers.some((m) => m.name.toLowerCase() === s.toLowerCase())).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => void addMaker(s)}
                  >
                    {`+ ${s}`}
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </section>

      {maker && (
        <section className="card" aria-label={`${maker.name} models`}>
          <h3>{maker.name}</h3>
          {maker.shared ? (
            <p className="sub">
              A shared manufacturer: you can add your own models to it, but not change it.
            </p>
          ) : (
            <>
              <div className="fields">
                <label className="wide">
                  Manufacturer name
                  <input
                    type="text"
                    maxLength={60}
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    onBlur={() => {
                      const n = rename.trim();
                      if (!n) return setRename(maker.name);
                      if (n !== maker.name)
                        void run(async () => {
                          await api.renameManufacturer(maker.id, n);
                          await onChanged();
                        }, 'Could not rename');
                    }}
                  />
                </label>
              </div>
              <div className="btnrow">
                <ConfirmButton
                  aria-label={`Delete ${maker.name}`}
                  disabled={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await api.removeManufacturer(maker.id);
                      setMakerId('');
                      await onChanged();
                    }, 'Could not delete')
                  }
                >
                  {`Delete ${maker.name} and its ${makerModels.length} model${makerModels.length === 1 ? '' : 's'}`}
                </ConfirmButton>
              </div>
              {machinesUsing(makerModels) > 0 && (
                <p className="sub">
                  {`${machinesUsing(makerModels)} machine${machinesUsing(makerModels) === 1 ? '' : 's'} on your plans use these models. They keep their names and lose only the model link.`}
                </p>
              )}
            </>
          )}

          <h4>{`Models (${makerModels.length})`}</h4>
          {makerModels.length > 6 && (
            <input
              type="text"
              aria-label="Search models"
              placeholder="Search models or codes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {models.length ? (
            <ul className="rows">
              {models.map((i) => (
                <li key={i.id}>
                  <span className="dot">{(TYPE_LETTERS[i.kind] ?? TYPE_LETTERS.space!).letter}</span>
                  <div className="txt">
                    <span>
                      {i.model} {i.code && <span className="tag">{i.code}</span>}
                    </span>
                    <span className="sub">
                      {[
                        (TYPE_LETTERS[i.kind] ?? TYPE_LETTERS.space!).name,
                        i.muscles.join(', '),
                        usage[i.id] ? `${usage[i.id]} on your plans` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {!i.shared && (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Edit ${i.model}`}
                      onClick={() => {
                        setEditing({
                          id: i.id,
                          draft: {
                            model: i.model,
                            code: i.code,
                            kind: i.kind,
                            muscles: [...i.muscles],
                            specs: i.specs.map((s) => ({ ...s })),
                            notes: i.notes,
                          },
                        });
                      }}
                    >
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub">
              {makerModels.length
                ? 'No model matches that search.'
                : 'No models yet. Add the first one below.'}
            </p>
          )}
          {!editing && (
            <div className="btnrow">
              <button type="button" className="btn" onClick={() => setEditing({ id: null, draft: blank() })}>
                Add a model
              </button>
            </div>
          )}
        </section>
      )}

      {editing && maker && (
        <section className="card" aria-label={editing.id ? 'Edit model' : 'New model'}>
          <h3>{editing.id ? 'Edit model' : `New ${maker.name} model`}</h3>
          <div className="fields">
            <label className="wide">
              Model name
              <input
                type="text"
                maxLength={80}
                value={editing.draft.model}
                placeholder="e.g. Selection Pin Loaded Chest Press"
                onChange={(e) => setDraft({ model: e.target.value })}
              />
            </label>
            <label>
              Item code
              <input
                type="text"
                maxLength={40}
                value={editing.draft.code}
                onChange={(e) => setDraft({ code: e.target.value })}
              />
            </label>
            <label>
              Kind
              <select
                value={editing.draft.kind}
                onChange={(e) => setDraft({ kind: e.target.value as ModelInput['kind'] })}
              >
                {EQUIPMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LETTERS[t]?.name ?? t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h4>Muscles it trains</h4>
          <div className="chips" role="group" aria-label="Muscles it trains">
            {MUSCLES.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={editing.draft.muscles.includes(m)}
                onClick={() =>
                  setDraft({
                    muscles: editing.draft.muscles.includes(m)
                      ? editing.draft.muscles.filter((x) => x !== m)
                      : [...editing.draft.muscles, m],
                  })
                }
              >
                {m}
              </button>
            ))}
          </div>
          <h4>Specifications</h4>
          <p className="sub">
            Anything worth knowing: weight stack, load range, dimensions, resistance type.
          </p>
          {editing.draft.specs.map((s, i) => (
            <div className="fields" key={i}>
              <label>
                {`Specification ${i + 1} name`}
                <input
                  type="text"
                  maxLength={40}
                  value={s.label}
                  placeholder="e.g. Weight stack"
                  onChange={(e) => setSpec(i, { label: e.target.value })}
                />
              </label>
              <label>
                {`Specification ${i + 1} value`}
                <input
                  type="text"
                  maxLength={80}
                  value={s.value}
                  placeholder="e.g. 100 kg"
                  onChange={(e) => setSpec(i, { value: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn sm"
                aria-label={`Remove specification ${i + 1}`}
                onClick={() => setDraft({ specs: editing.draft.specs.filter((_, k) => k !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          {editing.draft.specs.length < 30 && (
            <div className="btnrow">
              <button
                type="button"
                className="btn sm"
                onClick={() => setDraft({ specs: [...editing.draft.specs, { label: '', value: '' }] })}
              >
                Add a specification
              </button>
            </div>
          )}
          <div className="fields">
            <label className="wide">
              Notes
              <textarea
                rows={2}
                maxLength={1000}
                value={editing.draft.notes}
                onChange={(e) => setDraft({ notes: e.target.value })}
              />
            </label>
          </div>
          <div className="btnrow">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveModel()}>
              Save model
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing.id && (
              <ConfirmButton
                aria-label="Delete model"
                disabled={busy}
                onConfirm={() =>
                  void run(async () => {
                    await api.removeModel(editing.id!);
                    await onChanged();
                    setEditing(null);
                  }, 'Could not delete')
                }
              >
                {usage[editing.id]
                  ? `Delete model (${usage[editing.id]} machine${usage[editing.id] === 1 ? '' : 's'} use it)`
                  : 'Delete model'}
              </ConfirmButton>
            )}
          </div>
        </section>
      )}
      <p role="status" aria-live="polite">
        {msg}
      </p>
    </div>
  );
}
