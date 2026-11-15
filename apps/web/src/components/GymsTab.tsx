import { useEffect, useState } from 'react';
import { gymTitle, type GymSummary } from '@pt/core';
import type { GymMeta, GymsApi } from '../data/gymsApi.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

type Counts = Record<string, { floors: number; zones: number; equipment: number }>;

interface Props {
  gyms: GymSummary[];
  openId: string;
  /** The open gym has unsaved layout changes. */
  dirty: boolean;
  api: GymsApi | null;
  /** Make a gym and open it. `copy` starts from the plan as it is on screen. */
  onCreate: (meta: GymMeta, start: 'blank' | 'copy') => Promise<void>;
  onDuplicate: (id: string) => Promise<string | null>;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
  disabled: boolean;
  say: (m: string) => void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The Gyms tab: every gym with its own saved plan; open, edit details, duplicate, delete, add. */
export function GymsTab(p: Props) {
  const { gyms, api } = p;
  const [counts, setCounts] = useState<Counts>({});
  const [editId, setEditId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [address, setAddress] = useState('');
  const [start, setStart] = useState<'blank' | 'copy'>('blank');
  const editing = gyms.find((g) => g.id === editId) ?? gyms.find((g) => g.id === p.openId) ?? gyms[0];

  useEffect(() => {
    let live = true;
    api?.counts().then(
      (c) => live && setCounts(c),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, gyms]);

  async function run(fn: () => Promise<void>, fail: string) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setMsg(`${fail}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save(k: keyof GymMeta, raw: string) {
    if (!editing || !api) return;
    const v = raw.trim();
    if (v === editing[k]) return;
    if (k === 'name' && !v) return setMsg('A gym needs a name.');
    await run(async () => {
      await api.update(editing.id, { [k]: v });
      await p.onChanged();
      setMsg('Saved.');
    }, 'Could not save');
  }

  const open = gyms.find((g) => g.id === p.openId);
  const field = (k: keyof GymMeta, label: string, area = false) =>
    editing && (
      <label key={`${editing.id}-${k}`} className="wide">
        {label}
        {area ? (
          <textarea
            rows={2}
            maxLength={1000}
            defaultValue={editing[k]}
            onBlur={(e) => void save(k, e.target.value)}
          />
        ) : (
          <input
            type="text"
            maxLength={k === 'address' ? 160 : k === 'phone' ? 40 : 60}
            defaultValue={editing[k]}
            onBlur={(e) => void save(k, e.target.value)}
          />
        )}
      </label>
    );

  return (
    <div className="stack">
      <h2>Gym locations</h2>
      <p className="sub">
        Each gym keeps its own saved floor plan: floors, zones, equipment and the exercises linked to each
        machine. Open the gym where you are training, then plan and run the session there.
      </p>
      <ul className="rows gyms">
        {gyms.map((g) => {
          const c = counts[g.id];
          const on = g.id === p.openId;
          return (
            <li key={g.id} className={on ? 'on' : undefined}>
              <div className="txt">
                <span>
                  {gymTitle(g)} {on && <span className="tag">Open now</span>}
                </span>
                <span className="sub">{g.address || 'No address yet'}</span>
                {c && (
                  <span className="sub">
                    {`${plural(c.floors, 'floor')} · ${plural(c.zones, 'zone')} · ${c.equipment} equipment`}
                    {on && p.dirty ? ' · unsaved changes' : ''}
                  </span>
                )}
              </div>
              {!on && (
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={p.disabled}
                  aria-label={`Open ${gymTitle(g)}`}
                  onClick={() => p.onOpen(g.id)}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="btn sm"
                aria-label={`Details for ${gymTitle(g)}`}
                onClick={() => setEditId(g.id)}
              >
                {editing?.id === g.id ? 'Editing' : 'Details'}
              </button>
            </li>
          );
        })}
      </ul>

      {editing && api && (
        <section className="card" aria-label="Gym details">
          <h3>{gymTitle(editing)}</h3>
          <div className="fields">
            {field('name', 'Gym name')}
            {field('branch', 'Branch or location')}
            {field('address', 'Address')}
            {field('phone', 'Phone (optional)')}
            {field('notes', 'Notes (opening hours, access, parking)', true)}
          </div>
          {editing.id === p.openId && (
            <p className="sub">
              {p.dirty
                ? 'Layout: you have unsaved changes. Save them in the bar above the plan, or discard them.'
                : 'Layout: saved. Edit the floor plan in Edit layout, then press Save layout to keep your changes.'}
            </p>
          )}
          <div className="btnrow">
            <button
              type="button"
              className="btn sm"
              disabled={busy || p.disabled}
              onClick={() =>
                void run(async () => {
                  const id = await p.onDuplicate(editing.id);
                  if (id) setEditId(id);
                }, 'Could not duplicate')
              }
            >
              Duplicate this gym
            </button>
            {gyms.length > 1 && editing.id !== p.openId && (
              <ConfirmButton
                aria-label="Delete this gym"
                disabled={busy}
                onConfirm={() =>
                  void run(async () => {
                    await api.remove(editing.id);
                    setEditId('');
                    await p.onChanged();
                    setMsg(`Deleted "${gymTitle(editing)}".`);
                  }, 'Could not delete')
                }
              >
                Delete this gym
              </ConfirmButton>
            )}
          </div>
          {editing.id === p.openId && gyms.length > 1 && (
            <p className="sub">To delete this gym, open a different one first.</p>
          )}
          {gyms.length > 1 && editing.id !== p.openId && (
            <p className="sub">
              Deleting a gym deletes its floor plan, machines and saved templates. Finished workouts and
              client programmes are kept.
            </p>
          )}
        </section>
      )}

      <section className="card" aria-label="Add a gym">
        <h3>Add a gym</h3>
        <div className="fields">
          <label className="wide">
            Gym name
            <input type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Branch or location
            <input type="text" maxLength={60} value={branch} onChange={(e) => setBranch(e.target.value)} />
          </label>
          <label>
            Address
            <input type="text" maxLength={160} value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="wide">
            Start the floor plan from
            <select value={start} onChange={(e) => setStart(e.target.value as 'blank' | 'copy')}>
              <option value="blank">A blank floor plan (draw it from scratch)</option>
              <option value="copy">{`A copy of ${open ? gymTitle(open) : 'the open gym'} as it is on screen now`}</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy || p.disabled || !api}
          onClick={() => {
            if (!name.trim()) return setMsg('Give the gym a name first.');
            void run(async () => {
              await p.onCreate(
                { name: name.trim(), branch: branch.trim(), address: address.trim(), phone: '', notes: '' },
                start,
              );
              setName('');
              setBranch('');
              setAddress('');
              setStart('blank');
              setMsg('');
            }, 'Could not create the gym');
          }}
        >
          Create and open
        </button>
      </section>
      <p role="status" aria-live="polite">
        {msg}
      </p>
    </div>
  );
}
