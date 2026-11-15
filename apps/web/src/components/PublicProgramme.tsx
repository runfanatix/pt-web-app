import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateSeconds, fmtDate, itemsPerFloor, pdfFileName, type SharedProgramme } from '@pt/core';
import { fetchSharedProgramme } from '../data/share.ts';
import { savePdf } from '../lib/pdf.ts';
import { FloorPlan, TYPE_LETTERS } from './FloorPlan.tsx';
import { FloorTabs } from './PlanControls.tsx';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; programme: SharedProgramme };

/**
 * What a client sees when they open their link. No sign-in, no navigation into the rest of the app: the programme,
 * the gym plan with the route, and a PDF button. The data comes from one database function that returns nothing private.
 */
export function PublicProgramme({ client, token }: { client: SupabaseClient; token: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [floorId, setFloorId] = useState<string | null>(null);
  const [selEq, setSelEq] = useState<string | null>(null);
  const [selZone, setSelZone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchSharedProgramme(client, token).then(
      (programme) => live && setState(programme ? { status: 'ready', programme } : { status: 'missing' }),
      (err: unknown) =>
        live && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [client, token]);

  if (state.status === 'loading') {
    return (
      <div className="wrap">
        <p className="hint" role="status">
          Loading your programme…
        </p>
      </div>
    );
  }
  if (state.status === 'missing') {
    return (
      <div className="wrap">
        <p className="eyebrow">Training programme</p>
        <h1>This link is no longer available</h1>
        <p className="lede">It may have been replaced or switched off. Ask your trainer for a new one.</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="wrap">
        <p className="eyebrow">Training programme</p>
        <h1>Something went wrong</h1>
        <p className="lede" role="alert">
          {state.message}
        </p>
      </div>
    );
  }

  const p = state.programme;
  const layout = p.layout;
  const floor = layout ? (layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!) : null;
  const equipById = new Map((layout?.equipment ?? []).map((e) => [e.id, e]));
  const zoneName = new Map((layout?.zones ?? []).map((z) => [z.id, z.name]));
  const floorName = new Map((layout?.floors ?? []).map((f) => [f.id, f.name]));
  const multiFloor = (layout?.floors.length ?? 0) > 1;
  const where = (eid: string) => {
    const e = equipById.get(eid);
    return e
      ? {
          machine: e.name,
          zone: (multiFloor ? `${floorName.get(e.floor) ?? ''} · ` : '') + (zoneName.get(e.zone) ?? ''),
        }
      : null;
  };
  const planned = Math.round(estimateSeconds(p.items) / 60);

  function pdf() {
    savePdf(
      {
        title: p.title,
        client: '',
        coach: '',
        date: p.assignedOn,
        notes: p.notes,
        gym: p.gymLine,
        plannedSecs: estimateSeconds(p.items),
        layout,
        actual: null,
        items: p.items.map((it, i) => {
          const w = where(it.eid);
          return {
            eid: it.eid,
            exercise: it.exercise,
            machine: w?.machine ?? '',
            zone: w?.zone ?? '',
            sets: it.sets,
            reps: it.reps,
            rest: it.rest,
            note: it.note,
            cue: p.cues[i] ?? '',
            ms: 0,
            done: false,
          };
        }),
      },
      pdfFileName({ client: '', date: p.assignedOn }, 'programme', new Date().toISOString().slice(0, 10)),
    );
  }

  return (
    <div className="wrap public">
      <header className="top">
        <div>
          <p className="eyebrow">
            {[p.trainerName, p.gymLine].filter(Boolean).join(' · ') || 'Training programme'}
          </p>
          <h1>{p.title}</h1>
          <p className="lede">
            {p.items.length} exercise{p.items.length === 1 ? '' : 's'}, about {planned} min ·{' '}
            {fmtDate(p.assignedOn)}
          </p>
        </div>
        <div className="topright">
          <button type="button" className="btn primary" onClick={pdf}>
            Save as PDF
          </button>
        </div>
      </header>

      {p.notes.trim() && (
        <section className="share" aria-label="Notes from your trainer">
          <h3>Notes from your trainer</h3>
          <p>{p.notes}</p>
        </section>
      )}

      <main className="grid">
        <section className="mapcol" aria-label="Gym floor map">
          {layout && floor ? (
            <>
              <FloorTabs
                floors={layout.floors}
                floorId={floor.id}
                counts={itemsPerFloor(p.items, equipById)}
                onChange={(id) => {
                  setFloorId(id);
                  setSelEq(null);
                }}
              />
              <div className="mapscroll">
                <FloorPlan
                  layout={layout}
                  floorId={floor.id}
                  filter="all"
                  selZone={selZone}
                  selEq={selEq}
                  items={p.items}
                  onSelectZone={setSelZone}
                  onSelectEq={setSelEq}
                />
              </div>
              <ul className="legend" aria-label="Legend">
                {Object.values(TYPE_LETTERS).map((t) => (
                  <li key={t.letter}>
                    <span className="dot">{t.letter}</span>
                    {t.name}
                  </li>
                ))}
                <li>Numbers show the order, the red line the route</li>
              </ul>
            </>
          ) : (
            <p className="empty">There is no gym plan for this programme.</p>
          )}
        </section>

        <section className="panel" aria-label="Your exercises">
          <div className="panel-body stack">
            <h2>Your exercises</h2>
            <ol className="slist" aria-label="Exercises">
              {p.items.map((it, i) => {
                const w = where(it.eid);
                return (
                  <li key={it.uid} className="sitem">
                    <div className="shead">
                      <span className="num">{i + 1}</span>
                      <div className="who">
                        <strong>{it.exercise}</strong>
                        {w && (
                          <span className="sub">
                            {w.machine} · {w.zone}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="rx">
                      {it.sets} x {it.reps}
                      {it.rest ? ` · rest ${it.rest} s` : ''}
                    </p>
                    {it.note && <p className="cuetext">{it.note}</p>}
                    {p.cues[i] && <p className="cuetext">Cue: {p.cues[i]}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      </main>
      <p className="sub footer-note">Shared by {p.trainerName || 'your trainer'}.</p>
    </div>
  );
}
